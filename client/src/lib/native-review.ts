// Native in-app review wrapper — calls Apple's SKStoreReviewController on
// iOS native builds. Falls through silently on web / Android so the caller
// can apply the App Store / Play Store link-out fallback.
//
// IMPORTANT: SKStoreReviewController has an OS-level cap of 3 prompts per
// user per 365-day window. Apple enforces this — we don't see the result.
// Our own reviewPrompt.ts limits us to 3 prompts max anyway, so we'll
// never run into the Apple cap before hitting our own. Safe.
//
// Android equivalent (Google Play In-App Review API) exists but our Android
// build is a TWA (web wrapper), not a native APK — the plugin's Android
// path won't fire there. Web users continue to use the link-out.

import { Capacitor } from "@capacitor/core";

/**
 * Returns true if we successfully fired Apple's native star prompt.
 * Returns false on web, on Android TWA, or if the native call errored —
 * the caller should fall back to opening the App Store / Play Store URL.
 */
export async function requestNativeReview(): Promise<boolean> {
  // Capacitor.isNativePlatform() returns true ONLY in the wrapped iOS app
  // (or wrapped Android app). On web (Safari/Chrome/desktop), it's false.
  if (typeof Capacitor === "undefined" || !Capacitor.isNativePlatform()) {
    return false;
  }
  // Only iOS for now — Android is a TWA so this plugin's Android impl
  // wouldn't actually run inside it. Defensive double-check.
  if (Capacitor.getPlatform() !== "ios") {
    return false;
  }
  try {
    // Lazy import so the plugin code isn't bundled into the web build
    const mod = await import("@capacitor-community/in-app-review");
    const InAppReview = (mod as any).InAppReview;
    if (!InAppReview?.requestReview) return false;
    await InAppReview.requestReview();
    return true;
  } catch (err) {
    console.error("[native-review] requestReview failed:", err);
    return false;
  }
}
