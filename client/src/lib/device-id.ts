// Stable per-device identifier — used as X-Device-Id header on scan-receipt
// requests so the server can enforce the per-device free-scan cap (separate
// from the per-account cap).
//
// Implementation: localStorage UUID. Same identifier across all platforms.
//
// Why not native IDFV on iOS? Adding @capacitor/device adds a native dep that
// requires a fresh iOS build to land. localStorage gets us 95% of the abuse
// prevention with zero native changes. If we see real abuse (scammers clearing
// localStorage en masse), we can swap to IDFV later — the SERVER doesn't care
// which way the ID was generated, it just dedupes against device_scan_quota.

const KEY = "spliiit_device_id";

function generateUuid(): string {
  // crypto.randomUUID is available in modern browsers + iOS WKWebView + Android.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for very old environments (Capacitor sometimes lags on this).
  // Not cryptographically strong, but the ID's job is dedup, not security.
  return `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Returns a stable device identifier. Persists across reloads / app launches.
 * Cleared if the user wipes localStorage (rare but possible on web).
 */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = generateUuid();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // localStorage unavailable (private-mode quirks, mostly) — return a
    // session-only ID so the request still goes through. The user's
    // per-account counter still enforces the limit.
    return generateUuid();
  }
}

/**
 * Best-effort platform tag for analytics. "ios" / "android" / "web".
 * Not authoritative — server should not rely on this for security checks.
 */
export function getPlatformHint(): "ios" | "android" | "web" {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/android/i.test(ua)) return "android";
  return "web";
}
