// server/auth-throttle.ts
//
// Per-EMAIL rate limit for auth endpoints. Complements the existing
// per-IP rateLimit middleware in middleware.ts.
//
// Why: the per-IP limiter is bypassable with IP rotation (Tor exit nodes,
// residential proxies, rotating mobile IPs). An attacker can credential-
// stuff or brute-force OTPs against ONE email by cycling IPs. Per-email
// blocking shuts that down — the email itself is the brake.
//
// Tradeoff: a legit user who fails password 10x in 1hr gets locked out
// for the rest of that hour. They can wait, or use the reset-password
// flow (which goes through send-otp — but the same email is tracked
// separately under "otp_sent" so a determined-user-stuck-in-loop scenario
// still has friction).
//
// Window + thresholds:
//   - login_failed: 10 failures in 1hr per email → block further attempts
//   - otp_sent:      5 sends in 1hr per email → block further sends
//
// Block returns retryAfterSec so the response can include a Retry-After
// header (clients honour it; humans see a clear "try in 47 minutes" msg).

import { db } from "./db";
import { authAttempts } from "@shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";

export type AuthAttemptKind = "login_failed" | "otp_sent";

interface Limits {
  windowMs: number;
  maxAttempts: number;
}

const LIMITS: Record<AuthAttemptKind, Limits> = {
  login_failed: { windowMs: 60 * 60 * 1000, maxAttempts: 10 },
  otp_sent:     { windowMs: 60 * 60 * 1000, maxAttempts: 5  },
};

/**
 * Record one auth attempt. Call AFTER the attempt happens (i.e., after
 * password verification fails, or after OTP email is queued).
 */
export async function recordAuthAttempt(
  normalizedEmail: string,
  kind: AuthAttemptKind,
  ip: string | null,
): Promise<void> {
  if (!normalizedEmail) return;
  try {
    await db.insert(authAttempts).values({
      normalizedEmail,
      kind,
      ip: ip || null,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    // Don't fail the auth flow over telemetry. Log and move on.
    console.error("[auth-throttle] failed to record attempt:", err);
  }
}

/**
 * Check whether further attempts of `kind` for `normalizedEmail` are
 * blocked. Returns { blocked: true, retryAfterSec } if the count in
 * the current window meets/exceeds maxAttempts. Otherwise blocked=false.
 *
 * Call BEFORE the attempt (i.e., before running password check or
 * sending the OTP).
 */
export async function isAuthBlocked(
  normalizedEmail: string,
  kind: AuthAttemptKind,
): Promise<{ blocked: boolean; retryAfterSec?: number }> {
  if (!normalizedEmail) return { blocked: false };
  const limits = LIMITS[kind];
  const windowStart = new Date(Date.now() - limits.windowMs).toISOString();

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(authAttempts)
    .where(
      and(
        eq(authAttempts.normalizedEmail, normalizedEmail),
        eq(authAttempts.kind, kind),
        gte(authAttempts.createdAt, windowStart),
      ),
    );

  if (count < limits.maxAttempts) return { blocked: false };

  // Find the oldest in-window attempt to compute the unblock time.
  // The block ends when the oldest attempt scrolls out of the window.
  const rows = await db
    .select({ createdAt: authAttempts.createdAt })
    .from(authAttempts)
    .where(
      and(
        eq(authAttempts.normalizedEmail, normalizedEmail),
        eq(authAttempts.kind, kind),
        gte(authAttempts.createdAt, windowStart),
      ),
    )
    .orderBy(authAttempts.createdAt)
    .limit(1);

  let retryAfterSec = Math.ceil(limits.windowMs / 1000);
  if (rows.length > 0) {
    const oldestMs = new Date(rows[0].createdAt).getTime();
    const unblockAt = oldestMs + limits.windowMs;
    retryAfterSec = Math.max(1, Math.ceil((unblockAt - Date.now()) / 1000));
  }
  return { blocked: true, retryAfterSec };
}

/**
 * Human-friendly retry-after message. "Try again in X minutes" beats
 * "Try again in 2847 seconds." Caller passes the seconds and we round.
 */
export function retryAfterMessage(sec: number): string {
  if (sec < 60) return `Try again in ${sec} seconds.`;
  const min = Math.ceil(sec / 60);
  if (min < 60) return `Try again in ${min} minute${min === 1 ? "" : "s"}.`;
  const hrs = Math.ceil(min / 60);
  return `Try again in ${hrs} hour${hrs === 1 ? "" : "s"}.`;
}
