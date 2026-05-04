/**
 * Platform detection helpers for the Spliiit web client.
 *
 * Distinguishes between:
 *  - Browser (web)              — both flags below are false
 *  - iOS Capacitor (native iOS) — use `isIosNative` from lib/iap.ts
 *  - Android TWA (PWABuilder)   — use `isInTWA` from this file
 *
 * Android TWA detection:
 *  1. document.referrer === "android-app://<package>/" on the FIRST load only.
 *     We cache the result to sessionStorage so subsequent navigations still
 *     know we're in a TWA (referrer becomes same-origin after first nav).
 *  2. Fallback: display-mode standalone + Android WebView UA token "; wv)".
 *
 * Use `isInTWA` to gate any UI that would violate Google Play's payment
 * policy: no upgrade buttons, no pricing, no Stripe links, no payment copy.
 * Until v2 ships proper Play Billing, the Android app must show the free
 * tier only — even if the underlying user is Premium (in that case features
 * unlock as normal because we read `user.isPremium` from the API; we just
 * never SHOW any way to purchase).
 */

const TWA_CACHE_KEY = "spliiit_is_twa";

function detectTWA(): boolean {
  if (typeof window === "undefined") return false;

  // 1. Cached value from a previous detection in this session
  try {
    if (sessionStorage.getItem(TWA_CACHE_KEY) === "true") return true;
  } catch {
    // sessionStorage can throw in some sandboxed contexts; fall through
  }

  // 2. First-load referrer check. TWAs launch with referrer set to the
  //    Android package URL. After the first navigation it's same-origin,
  //    which is why we cache.
  if (typeof document !== "undefined" && document.referrer.startsWith("android-app://")) {
    try { sessionStorage.setItem(TWA_CACHE_KEY, "true"); } catch { /* ignore */ }
    return true;
  }

  // 3. Fallback heuristic: standalone display + Android WebView UA.
  //    PWABuilder TWAs always launch in display-mode: standalone, and the
  //    "; wv)" token in the UA distinguishes a WebView from regular Chrome
  //    on Android. Combined, this is a strong TWA signal.
  try {
    const isStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches ?? false;
    const ua = navigator.userAgent || "";
    const isAndroidWebView = /Android/.test(ua) && /;\s*wv\)/.test(ua);
    if (isStandalone && isAndroidWebView) {
      try { sessionStorage.setItem(TWA_CACHE_KEY, "true"); } catch { /* ignore */ }
      return true;
    }
  } catch {
    // matchMedia / userAgent read failed — assume not a TWA
  }

  return false;
}

/** True if running inside the Spliiit Android TWA (Play Store install). */
export const isInTWA: boolean = detectTWA();

/**
 * True if upgrade / pricing / payment UI is allowed to render.
 *
 * - Web browser:   true
 * - iOS native:    true  (Apple IAP path)
 * - Android TWA:   false (Google Play policy compliance)
 */
export const canShowUpgradeUI: boolean = !isInTWA;
