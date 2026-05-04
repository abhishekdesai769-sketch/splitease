/**
 * iOS Push Notifications — Capacitor + APNs integration.
 *
 * Mirrors the pattern in lib/iap.ts (RevenueCat):
 *   - Only activates inside the native iOS Capacitor binary
 *   - Safe to import on web/Android — every function is a no-op there
 *   - Idempotent: setupListeners runs once per JS session; per-user
 *     registration runs whenever the logged-in user changes
 *
 * Lifecycle:
 *   App opens → AuthProvider sees user.id → initPushNotifications(userId)
 *     → first time: setupListeners + requestPermissions + register
 *     → subsequent: re-register existing token against the new userId
 *
 *   User logs out → AuthProvider calls deregisterPushToken()
 *     → DELETE /api/device-tokens/:token (server forgets this device for this user)
 *     → token kept in memory so next login re-registers without re-prompting
 *
 *   APNs returns invalid token → server auto-purges the row in device_tokens
 *
 * Permission UX note:
 *   We ask on first login. Apple recommends "primed" permission requests
 *   (explain value first) for higher grant rates. v1 keeps it simple; we
 *   can add a soft pre-prompt sheet in v2 if grant rate is low.
 */

import { isIosNative } from "./iap";
import { apiRequest } from "./queryClient";

// Lazily import the Capacitor plugin only on iOS to avoid bundle bloat on web.
type CapToken = { value: string };
type CapNotifAction = { notification: { data?: Record<string, any> } };

let _listenersSetup = false;
let _registeredToken: string | null = null;
let _currentUserId: string | null = null;

async function getPlugin() {
  // Dynamic import keeps the plugin out of the web bundle.
  // On non-iOS, isIosNative is false and we never reach here.
  const mod = await import("@capacitor/push-notifications");
  return mod.PushNotifications;
}

async function registerTokenWithServer(token: string): Promise<void> {
  try {
    await apiRequest("POST", "/api/device-tokens", {
      token,
      platform: "ios",
      bundleId: "ca.klarityit.spliiit",
      // TestFlight + App Store builds both use the production APNs endpoint.
      // Direct Xcode dev builds would need "sandbox" — we'll add that detection
      // in a later phase if/when it matters.
      environment: "production",
    });
    console.log("[push] registered with server:", token.slice(0, 8) + "…");
  } catch (err) {
    console.error("[push] register failed:", err);
  }
}

async function setupListeners(): Promise<void> {
  if (_listenersSetup) return;
  _listenersSetup = true;

  const PushNotifications = await getPlugin();

  // Token received from APNs after register() — this fires once on first
  // permission grant, and again on token refresh (rare).
  await PushNotifications.addListener("registration", async (token: CapToken) => {
    _registeredToken = token.value;
    if (_currentUserId) {
      await registerTokenWithServer(token.value);
    }
  });

  await PushNotifications.addListener("registrationError", (err: any) => {
    console.error("[push] APNs registration error:", err);
  });

  // User tapped a notification while the app was background/closed.
  // For v1 we just log; routing to the right screen can be added later
  // (e.g. tap "Sarah added an expense" → navigate to that group).
  await PushNotifications.addListener("pushNotificationActionPerformed", (action: CapNotifAction) => {
    console.log("[push] notification tapped:", action.notification?.data);
  });

  // Foreground notification received — by default iOS silences these.
  // capacitor.config.ts sets presentationOptions so they still show.
  await PushNotifications.addListener("pushNotificationReceived", (notif: any) => {
    console.log("[push] received in foreground:", notif?.title);
  });
}

/**
 * Initialize push notifications for the given user.
 * No-op on web/Android. Idempotent — safe to call on every user change.
 */
export async function initPushNotifications(userId: string): Promise<void> {
  if (!isIosNative || !userId) return;

  _currentUserId = userId;

  try {
    await setupListeners();

    // If we already have a token from a previous session (or different user),
    // re-register it under the current user. No permission prompt.
    if (_registeredToken) {
      await registerTokenWithServer(_registeredToken);
      return;
    }

    const PushNotifications = await getPlugin();

    // Ask permission. iOS shows the system alert on first call; subsequent
    // calls return the current decision without re-prompting.
    const permResult = await PushNotifications.requestPermissions();
    if (permResult.receive === "granted") {
      // This kicks off APNs registration. The 'registration' listener above
      // will fire with the device token a moment later.
      await PushNotifications.register();
    } else {
      console.log("[push] permission not granted:", permResult.receive);
    }
  } catch (err) {
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
