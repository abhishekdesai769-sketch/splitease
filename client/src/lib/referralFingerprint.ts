/**
 * referralFingerprint.ts
 *
 * Custom deferred deep-link attribution — no Branch.io, no cost.
 *
 * Flow:
 *  1. User clicks a referral link on web → recordReferralClick() fires
 *     → POST /api/referral/click with fingerprint (IP hashed server-side)
 *
 *  2. User goes to App Store → installs native app → opens it for the first time
 *     → matchReferralClick() fires
 *     → POST /api/referral/match sends the same fingerprint
 *     → server matches IP within 48h → returns referral code
 *     → we store it in localStorage → existing signup flow picks it up
 */

const STORAGE_KEY = "spliiit_referral_code";

/**
 * Called on the web when ?ref=CODE is found in the URL.
 * Sends a fingerprint snapshot to the server so native installs can be attributed later.
 */
export async function recordReferralClick(referralCode: string): Promise<void> {
  try {
    await fetch("/api/referral/click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referralCode }),
    });
  } catch {
    // Non-blocking — if this fails, the web localStorage path still works
  }
}

/**
 * Called on native app first open (when no ref code is already in localStorage).
 * If the server finds a matching fingerprint from a recent click, stores the code
 * so the existing signup flow can attribute the referral.
 */
export async function matchReferralClick(): Promise<void> {
  // Only run if there's no code already (don't overwrite an explicit ?ref= param)
  if (localStorage.getItem(STORAGE_KEY)) return;

  try {
    const res = await fetch("/api/referral/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.referralCode) {
      localStorage.setItem(STORAGE_KEY, data.referralCode);
      console.log("[referral] 🎯 matched via fingerprint:", data.referralCode);
    }
  } catch {
    // Non-blocking — if this fails, user just won't get the referral credit (acceptable)
  }
}

/** Returns true when running inside the Capacitor native shell (iOS / Android). */
export function isNativeApp(): boolean {
  return !!(window as any).Capacitor?.isNative;
}
