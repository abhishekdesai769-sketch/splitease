/**
 * reviewPrompt.ts — Mandatory in-app rating gate
 *
 * Sep 2026 product decision: every user of the installed app (iOS Capacitor
 * or Android TWA) is asked to rate on EVERY app open — cold launch and every
 * return to the foreground — until they complete it. There is no skip, no
 * cooldown and no cap. ReviewPromptSheet owns the when/UI; this file owns
 * the "are we done with this user?" state and the store links.
 *
 * "Done" means one of:
 *   - 4-5 stars and they tapped through to the App Store / Play Store
 *   - 1-3 stars and they sent the in-app feedback note
 *
 * We cannot see whether a store review was actually posted — the tap-through
 * is the strongest signal available.
 *
 * Plain web (browser) users are never prompted: a store review needs the app
 * installed, so there's nothing for them to do.
 */

import { isIosNative } from "@/lib/iap";
import { isInTWA } from "@/lib/platform";

// v2 key: deliberately NOT the old "spliiit_rv_rated", which was also set by
// "Maybe later" — everyone gets asked under the new rules.
const K_DONE = "spliiit_rv2_done";

function get(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function set(key: string, val: string) {
  try { localStorage.setItem(key, val); } catch {}
}

/** Has the user completed the rating flow on this install? */
export function hasRated(): boolean {
  return get(K_DONE) === "1";
}

/** Called when the user taps through to the store (4-5★) or sends feedback (1-3★). */
export function markRated() {
  set(K_DONE, "1");
}

/** Is this the installed app (where a store review is possible)? */
export function isInstalledApp(): boolean {
  return isIosNative || isInTWA;
}

/** Should the gate be up right now? */
export function shouldShowReview(): boolean {
  return isInstalledApp() && !hasRated();
}

// ─── Platform + store link ────────────────────────────────────────────────────

export type StorePlatform = "ios" | "android";

export function getStorePlatform(): StorePlatform {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return /iPhone|iPad|iPod/i.test(ua) ? "ios" : "android";
}

export function getStoreLink(platform: StorePlatform): string {
  if (platform === "ios") {
    // App Store — direct to write-review page (Apple ID from App Store Connect)
    return "https://apps.apple.com/app/id6761338254?action=write-review";
  }
  // Google Play
  return "https://play.google.com/store/apps/details?id=ca.klarityit.spliiit";
}
