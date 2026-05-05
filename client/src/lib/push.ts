/**
 * iOS Push Notifications — Capacitor + APNs integration.
 *
 * Mirrors the pattern in lib/iap.ts (RevenueCat):
 *   - Only activates inside the native iOS Capacitor binary
 *   - Safe to import on web/Android — every function is a no-op there
 *   - Idempotent: setupListeners runs once per JS session; per-user
 *     registration runs whenever the logged-in user changes
 *
 * NOTE on imports:
 *   We use a STATIC import for @capacitor/push-notifications. Earlier we
 *   tried `await import(...)` to keep the plugin out of the web bundle,
 *   but the dynamic import was failing silently in the iOS WebView for
 *   reasons that were hard to debug remotely. Static import adds ~5KB to
 *   the bundle but is rock-solid. Cost is worth it.
 *
 * Diagnostic pings:
 *   This file POSTs to /api/_pushdebug at each step of init. The server
 *   logs these — visible in Render's Logs tab — so we can see exactly
 *   where the chain breaks if push isn't working. Remove these calls
 *   once push is confirmed reliable in production.
 */

import { PushNotifications } from "@capacitor/push-notifications";
import { isIosNative } from "./iap";
import { apiRequest } from "./queryClient";

type CapToken = { value: string };
type CapNotifAction = { notification: { data?: Record<string, any> } };

let _listenersSetup = false;
let _registeredToken: string | null = null;
let _currentUserId: string | null = null;

/**
 * Diagnostic ping — fire-and-forget GET to the server so each push.ts
 * step shows up in Render logs. Tagged with `step` so we can grep.
 * Never throws, never blocks. Remove once push is stable.
 */
function debugPing(step: string, extra?: Record<string, string | number | boolean>) {
  try {
    const params = new URLSearchParams({ step, ...(extra as Record<string, string>) });
    fetch(`/api/_pushdebug?${params.toString()}`, { credentials: "include" }).catch(() => {});
  } catch { /* never block real work on a debug ping */ }
}

async function registerTokenWithServer(token: string): Promise<void> {
  debugPing("register_token_with_server_start", { tokenPrefix: token.slice(0, 8) });
  try {
    await apiRequest("POST", "/api/device-tokens", {
      token,
      platform: "ios",
      bundleId: "ca.klarityit.spliiit",
      environment: "production",
    });
    debugPing("register_token_with_server_ok");
    console.log("[push] registered with server:", token.slice(0, 8) + "…");
  } catch (err: any) {
    debugPing("register_token_with_server_error", { msg: String(err?.message ?? err).slice(0, 120) });
    console.error("[push] register failed:", err);
  }
}

async function setupListeners(): Promise<void> {
  if (_listenersSetup) {
    debugPing("setup_listeners_skip_already_done");
    return;
  }
  _listenersSetup = true;

  debugPing("setup_listeners_start");

  await PushNotifications.addListener("registration", async (token: CapToken) => {
    debugPing("listener_registration_fired", { tokenPrefix: token.value.slice(0, 8) });
    _registeredToken = token.value;
    if (_currentUserId) {
      await registerTokenWithServer(token.value);
    }
  });

  await PushNotifications.addListener("registrationError", (err: any) => {
    debugPing("listener_registration_error", { msg: String(err?.error ?? err).slice(0, 120) });
    console.error("[push] APNs registration error:", err);
  });

  await PushNotifications.addListener("pushNotificationActionPerformed", (action: CapNotifAction) => {
    console.log("[push] notification tapped:", action.notification?.data);
  });

  await PushNotifications.addListener("pushNotificationReceived", (notif: any) => {
    console.log("[push] received in foreground:", notif?.title);
  });

  debugPing("setup_listeners_done");
}

/**
 * Initialize push notifications for the given user.
 * No-op on web/Android. Idempotent — safe to call on every user change.
 */
export async function initPushNotifications(userId: string): Promise<void> {
  // First diagnostic — runs unconditionally so we can see in Render logs
  // whether this function is being called at all + the platform context.
  debugPing("init_called", {
    isIosNative: String(isIosNative),
    hasUserId: String(!!userId),
  });

  if (!isIosNative || !userId) {
    debugPing("init_early_return", { reason: !isIosNative ? "not_ios" : "no_user_id" });
    return;
  }

  _currentUserId = userId;

  try {
    await setupListeners();

    if (_registeredToken) {
      debugPing("init_reusing_cached_token");
      await registerTokenWithServer(_registeredToken);
      return;
    }

    debugPing("request_permissions_call");
    const permResult = await PushNotifications.requestPermissions();
    debugPing("request_permissions_result", { receive: String(permResult.receive) });

    if (permResult.receive === "granted") {
      debugPing("calling_register");
      await PushNotifications.register();
      debugPing("register_call_completed");
    } else {
      debugPing("permission_not_granted", { receive: String(permResult.receive) });
      console.log("[push] permission not granted:", permResult.receive);
    }
  } catch (err: any) {
    debugPing("init_caught_error", { msg: String(err?.message ?? err).slice(0, 200) });
    console.error("[push] init failed:", err);
  }
}

/**
 * Deregister the current device token from the server.
 * Called on logout. Keeps the token in memory so the next login can
 * re-register without asking permission again.
 *
 * No-op on web/Android, or if no token has been registered yet.
 */
export async function deregisterPushToken(): Promise<void> {
  if (!isIosNative || !_registeredToken) {
    _currentUserId = null;
    return;
  }

  try {
    await apiRequest("DELETE", `/api/device-tokens/${encodeURIComponent(_registeredToken)}`);
    console.log("[push] deregistered from server");
  } catch (err) {
    console.error("[push] deregister failed:", err);
  }
  _currentUserId = null;
  // Note: we intentionally keep _registeredToken so the next login can
  // re-register the same device without re-prompting the user.
}
