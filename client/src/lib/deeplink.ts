/**
 * iOS Universal Links handler — Capacitor App plugin integration.
 *
 * Mirrors the lib/iap.ts and lib/push.ts pattern:
 *   - Activates ONLY inside the native iOS Capacitor binary
 *   - No-op on web/Android (iap.isIosNative gate)
 *   - Idempotent: setupDeepLinkListener runs once per JS session
 *
 * What this does:
 *   When a user taps an https://spliiit.klarityit.ca/... link in Mail / Messages /
 *   any other iOS app AND the Spliiit app is installed, iOS opens the Spliiit
 *   app instead of Safari (because of the Associated Domains entitlement +
 *   the AASA file at /.well-known/apple-app-site-association). Capacitor
 *   then fires an "appUrlOpen" event with the full URL. We parse the path
 *   and navigate the WebView there — preserving the user's logged-in session.
 *
 * Why window.location.href works:
 *   capacitor.config.ts has server.url = "https://spliiit.klarityit.ca", so the
 *   WebView is already on that origin. Setting window.location.href to a path
 *   navigates within the same origin → cookies persist → user stays logged in.
 *
 * Setup: call initDeepLinkHandling() once during app boot (see App.tsx).
 *
 * Android note: assetlinks.json + the TWA's intent filter handle Android App
 * Links automatically — no JS code path needed there. This file is iOS-only.
 */

import { App as CapApp } from "@capacitor/app";
import { isIosNative } from "./iap";

const ALLOWED_HOST = "spliiit.klarityit.ca";

let _initialized = false;

export async function initDeepLinkHandling(): Promise<void> {
  if (!isIosNative || _initialized) return;
  _initialized = true;

  try {
    await CapApp.addListener("appUrlOpen", (event: { url: string }) => {
      try {
        const url = new URL(event.url);

        // Defensive: only honor links from our own domain. Custom URL schemes
        // (e.g. "spliiit://...") or other hosts are ignored to avoid weird
        // navigation if someone crafts a hostile link.
        if (url.host !== ALLOWED_HOST) {
          console.log("[deeplink] ignoring non-Spliiit URL:", event.url);
          return;
        }

        const path = url.pathname + url.search + url.hash;

        // If we're already on this exact path, no need to navigate (avoids a
        // pointless reload when the user taps a link that matches the current
        // screen).
        const currentPath =
          window.location.pathname + window.location.search + window.location.hash;
        if (path === currentPath) {
          console.log("[deeplink] already on target path, skipping nav");
          return;
        }

        console.log("[deeplink] navigating to:", path);
        // window.location.href preserves cookies + session on same-origin nav.
        window.location.href = path;
      } catch (err) {
        console.error("[deeplink] failed to parse URL:", event.url, err);
      }
    });
    console.log("[deeplink] listener registered (iOS Universal Links)");
  } catch (err) {
    console.error("[deeplink] init failed:", err);
  }
}
