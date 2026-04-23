/**
 * reviewPrompt.ts — In-app review prompt logic
 *
 * 3 triggers (from GROWTH_BLUEPRINT.md):
 *   "expense_6"    — user adds their 6th expense (past Splitwise's daily cap)
 *   "receipt"      — user uploads their first receipt photo (Splitwise charges for this)
 *   "group"        — user creates a group with 3+ members
 *
 * Rules:
 *   - Each trigger fires at most ONCE ever (tracked in localStorage)
 *   - If user taps "Leave a Review" → never show again
 *   - If user taps "Maybe later" → wait 7 days before showing next trigger
 *   - If user taps "Already did" → never show again (same as rated)
 *   - Max 3 prompts total across all triggers before we give up
 */

export type ReviewTrigger = "expense_6" | "receipt" | "group";

// ─── Storage keys ──────────────────────────────────────────────────────────────

const K_RATED       = "spliiit_rv_rated";       // "1" = user left review
const K_DISMISSED   = "spliiit_rv_dismissed_at"; // ISO — last "maybe later"
const K_TOTAL       = "spliiit_rv_total";        // number of times shown
const K_EXPENSE_CT  = "spliiit_rv_expense_ct";  // running expense count for trigger
const K_FIRED       = (t: ReviewTrigger) => `spliiit_rv_fired_${t}`; // per-trigger flag

// ─── Logic ────────────────────────────────────────────────────────────────────

function get(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function set(key: string, val: string) {
  try { localStorage.setItem(key, val); } catch {}
}

/** Has the user already tapped "Leave a Review" or "Already did"? */
export function hasRated(): boolean {
  return get(K_RATED) === "1";
}

/** Has this specific trigger already fired? */
export function triggerFired(type: ReviewTrigger): boolean {
  return get(K_FIRED(type)) === "1";
}

/** Should we show the prompt right now? */
export function shouldShowReview(type: ReviewTrigger): boolean {
  if (hasRated()) return false;
  if (triggerFired(type)) return false;                   // this trigger already used
  if (parseInt(get(K_TOTAL) ?? "0") >= 3) return false;  // shown 3 times total — give up

  const dismissedAt = get(K_DISMISSED);
  if (dismissedAt) {
    const daysSince = (Date.now() - new Date(dismissedAt).getTime()) / 86_400_000;
    if (daysSince < 7) return false; // within 7-day cooldown after "maybe later"
  }

  return true;
}

/** Track expense count and return true when the 6th expense is reached. */
export function recordExpenseAndCheck(): boolean {
  if (triggerFired("expense_6") || hasRated()) return false;
  const count = parseInt(get(K_EXPENSE_CT) ?? "0") + 1;
  set(K_EXPENSE_CT, count.toString());
  return count === 6; // fires exactly once
}

/** Called when the prompt is shown. */
export function markShown(type: ReviewTrigger) {
  set(K_FIRED(type), "1");
  set(K_TOTAL, (parseInt(get(K_TOTAL) ?? "0") + 1).toString());
}

/** Called when user taps "Leave a Review" or "Already did ✓". */
export function markRated() {
  set(K_RATED, "1");
}

/** Called when user taps "Maybe later". */
export function markDismissed() {
  set(K_DISMISSED, new Date().toISOString());
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

// ─── Global trigger callback (set by ReviewPromptSheet on mount) ───────────────
// This avoids needing a React context — any module can call triggerReview().

let _onTrigger: ((type: ReviewTrigger) => void) | null = null;

export function registerReviewTrigger(fn: (type: ReviewTrigger) => void) {
  _onTrigger = fn;
}

export function unregisterReviewTrigger() {
  _onTrigger = null;
}

/**
 * Call this from anywhere after a triggering action succeeds.
 * Automatically checks all rules before showing the prompt.
 */
export function triggerReview(type: ReviewTrigger) {
  if (!shouldShowReview(type)) return;
  _onTrigger?.(type);
}
