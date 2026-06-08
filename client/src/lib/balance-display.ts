/**
 * balance-display — DISPLAY-LAYER helpers for rounding-remainder cleanup.
 *
 * Why this exists: floating-point equal splits (e.g. $50 / 3 = $16.666…)
 * leave sub-cent residuals in balance math. With many expenses across many
 * members, those residuals accumulate into 1–4 cent "phantom" balances
 * even after the user has fully settled with everyone. Showing
 * "You are owed $0.01" is confusing UX.
 *
 * This module is DISPLAY-ONLY. It does NOT modify the math in
 * lib/simplify.ts — that file remains the locked source of truth. We just
 * snap visually-presented amounts under SETTLED_THRESHOLD to 0 / hide them
 * so the user sees "All settled up" instead of phantom pennies.
 *
 * Threshold: 5¢. Generous enough to absorb accumulated rounding for groups
 * of up to ~50 members on typical expense amounts. Small enough that any
 * real un-settled balance ($0.05 and up) still shows.
 *
 * Industry parallel: Splitwise uses ~10¢, Tricount uses ~5¢. Spliiit at 5¢
 * is conservative.
 */

export const SETTLED_THRESHOLD = 0.05;

// ── Directional amount colors ──────────────────────────────────────────────
// Green = money coming TO you (you're owed / will receive).
// Red   = money going OUT (you owe / will pay).
// Used everywhere balances are shown so the direction is unmistakable —
// users were confused when "you're owed" amounts rendered in default
// (near-black) text. Tuned for contrast on both the cream light theme and
// the dark theme.
export const AMOUNT_IN_CLASS = "text-green-600 dark:text-green-400";   // owed to you
export const AMOUNT_OUT_CLASS = "text-destructive";                    // you owe

/** Returns the right color class for a signed balance amount.
 *  amount > 0 → green (incoming), amount < 0 → red (outgoing),
 *  amount === 0 → muted. */
export function amountColorClass(amount: number): string {
  if (amount > 0) return AMOUNT_IN_CLASS;
  if (amount < 0) return AMOUNT_OUT_CLASS;
  return "text-muted-foreground";
}

/**
 * Returns true if the amount is below the display threshold and should be
 * shown to the user as "settled" rather than as a literal cents value.
 * Sign-agnostic — same answer for +$0.01 and -$0.01.
 */
export function isEffectivelySettled(amount: number): boolean {
  return Math.abs(amount) < SETTLED_THRESHOLD;
}

/**
 * Snap a balance to 0 for display if it's effectively settled. Otherwise
 * returns the input unchanged. Use this at React render call sites — NOT
 * inside the balance-math functions in lib/simplify.ts.
 */
export function displayBalance(amount: number): number {
  return isEffectivelySettled(amount) ? 0 : amount;
}
