// Premium-access policy helper.
//
// Single source of truth for "can this user use AI receipt scanning?"
//
// Two paths to access:
//   1. Paid: user.isPremium === true  → always allowed, counters untouched
//   2. Free quota: every non-paid user gets FREE_AI_SCAN_LIMIT successful scans,
//      enforced both per-user AND per-device (whichever runs out first).
//
// IMPORTANT — the counters are decremented ONLY on a successful parse, server-side.
// Never trust the client. Failed scans (parser returned null, network error, bad image)
// are recorded in ai_scan_audit but do NOT count against the free quota.
//
// All checks live here so a future policy change (e.g., 5 free scans, or per-month
// reset) is one constant or one branch — not a hunt through routes.ts.

import { db } from "./db";
import { users, deviceScanQuota, aiScanAudit } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import type { User } from "@shared/schema";

export const FREE_AI_SCAN_LIMIT = 3;

// ---------------------------------------------------------------------------
// Email normalization (abuse detection only — NEVER for login or display).
// Collapses common aliasing tricks to a canonical key so we can detect
// "same person, different alias" account recycling.
//
// Rules:
//   - lowercase + trim
//   - strip +alias suffix in the local-part (universal)
//   - strip dots in the local-part ONLY for Gmail / Googlemail (Gmail policy)
// ---------------------------------------------------------------------------
export function normalizeEmail(email: string): string {
  const lower = (email ?? "").trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 0) return lower;
  let local = lower.slice(0, at);
  const domain = lower.slice(at + 1);
  // Strip +alias for everyone
  const plusIdx = local.indexOf("+");
  if (plusIdx >= 0) local = local.slice(0, plusIdx);
  // Strip dots only for Gmail and its alias googlemail.com
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
  }
  return `${local}@${domain}`;
}

// ---------------------------------------------------------------------------
// Eligibility check — fast read, no writes.
// Returns enough info for the route to either proceed or return a paywall.
// ---------------------------------------------------------------------------
export type ScanEligibilityReason =
  | "paid"
  | "free_quota"
  | "user_quota_exhausted"
  | "device_quota_exhausted";

export interface ScanEligibility {
  allowed: boolean;
  reason: ScanEligibilityReason;
  freeRemaining: number; // 0..FREE_AI_SCAN_LIMIT — meaningful for free users only
  paid: boolean;
}

export async function checkScanEligibility(
  user: Pick<User, "id" | "isPremium" | "freeAiScansUsed" | "freeAiScansGranted">,
  deviceId: string | null,
): Promise<ScanEligibility> {
  if (user.isPremium) {
    return { allowed: true, reason: "paid", freeRemaining: 0, paid: true };
  }

  const userRemaining = Math.max(0, user.freeAiScansGranted - user.freeAiScansUsed);
  if (userRemaining <= 0) {
    return {
      allowed: false,
      reason: "user_quota_exhausted",
      freeRemaining: 0,
      paid: false,
    };
  }

  // Device cap — enforced only when we have a deviceId.
  // On web, the client should still send a stable localStorage UUID; on iOS, IDFV.
  // If no header arrives, we degrade gracefully to the per-user check only.
  if (deviceId) {
    const [row] = await db
      .select()
      .from(deviceScanQuota)
      .where(eq(deviceScanQuota.deviceId, deviceId));
    const deviceUsed = row?.scansUsed ?? 0;
    if (deviceUsed >= FREE_AI_SCAN_LIMIT) {
      return {
        allowed: false,
        reason: "device_quota_exhausted",
        freeRemaining: 0,
        paid: false,
      };
    }
    // Effective remaining = lower of the two ceilings.
    return {
      allowed: true,
      reason: "free_quota",
      freeRemaining: Math.min(userRemaining, FREE_AI_SCAN_LIMIT - deviceUsed),
      paid: false,
    };
  }

  return {
    allowed: true,
    reason: "free_quota",
    freeRemaining: userRemaining,
    paid: false,
  };
}

// ---------------------------------------------------------------------------
// Counter increment — call ONLY after a successful parseReceipt().
// Paid users: no-op. Counters are conditionally incremented (race-safe).
// ---------------------------------------------------------------------------
export async function incrementScanCounters(params: {
  user: Pick<User, "id" | "isPremium">;
  deviceId: string | null;
  platform: string | null;
}): Promise<void> {
  const { user, deviceId, platform } = params;
  if (user.isPremium) return;

  const now = new Date().toISOString();

  // Atomic conditional increment — refuses to overflow past granted.
  await db
    .update(users)
    .set({ freeAiScansUsed: sql`${users.freeAiScansUsed} + 1` })
    .where(
      sql`${users.id} = ${user.id} AND ${users.freeAiScansUsed} < ${users.freeAiScansGranted}`,
    );

  if (deviceId) {
    // Upsert + atomic increment on the device row.
    await db
      .insert(deviceScanQuota)
      .values({
        deviceId,
        scansUsed: 1,
        firstScanAt: now,
        lastScanAt: now,
        platform: platform ?? null,
      })
      .onConflictDoUpdate({
        target: deviceScanQuota.deviceId,
        set: {
          scansUsed: sql`${deviceScanQuota.scansUsed} + 1`,
          lastScanAt: now,
        },
      });
  }
}

// ---------------------------------------------------------------------------
// Commit a previously-recorded scan by its audit row ID.
//
// Used by the expense-create endpoints: when an expense is being saved that
// originated from an AI scan, we charge the user's free quota HERE (not at
// scan time). This means a user who scans, reviews, then cancels never spends
// a free scan — counter only ticks down when an expense actually gets created.
//
// Server-side dedup via the `countedAgainstFree` flag on the audit row:
// calling this twice with the same scanId is a no-op the second time (safe
// for the per-item flow which creates multiple expenses from one scan).
//
// Returns true if a commit happened, false if no-op (scanId invalid, wrong
// user, already counted, or scan was a failure / paid user).
// ---------------------------------------------------------------------------
export async function commitScanByScanId(params: {
  scanId: string;
  user: Pick<User, "id" | "isPremium">;
  deviceId: string | null;
  platform: string | null;
}): Promise<boolean> {
  const { scanId, user, deviceId, platform } = params;
  if (!scanId) return false;

  // Paid users: nothing to charge. Still mark the audit row as counted so we
  // never re-process if they downgrade. Cheap, safe.
  if (user.isPremium) {
    try {
      await db
        .update(aiScanAudit)
        .set({ countedAgainstFree: true })
        .where(
          sql`${aiScanAudit.id} = ${scanId} AND ${aiScanAudit.userId} = ${user.id} AND ${aiScanAudit.countedAgainstFree} = false`,
        );
    } catch (err) {
      console.error("commitScanByScanId paid-user audit update failed:", err);
    }
    return false;
  }

  try {
    // Atomic check-and-set: flip countedAgainstFree=true only if currently
    // false AND row belongs to this user AND the scan succeeded. RETURNING
    // tells us whether the update actually matched a row.
    const updated = await db
      .update(aiScanAudit)
      .set({ countedAgainstFree: true })
      .where(
        sql`${aiScanAudit.id} = ${scanId} AND ${aiScanAudit.userId} = ${user.id} AND ${aiScanAudit.countedAgainstFree} = false AND ${aiScanAudit.success} = true`,
      )
      .returning({ id: aiScanAudit.id });

    if (updated.length === 0) {
      // No matching uncounted row — invalid scanId / wrong user / already
      // committed / failure scan. No-op, no error.
      return false;
    }

    // Increment the user's counter + device counter, exactly mirroring the
    // logic that USED to live inside /api/scan-receipt post-success.
    await incrementScanCounters({ user, deviceId, platform });
    return true;
  } catch (err) {
    // Don't propagate — expense creation must not fail because counter
    // commit hit a transient issue. Fail-open: user effectively gets the
    // scan "back" (audit row stays uncounted, counter unchanged).
    console.error("commitScanByScanId failed:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Audit log — fire-and-forget. Records every attempt, success or failure.
// Used for forensic abuse detection and analytics. Never throws.
// ---------------------------------------------------------------------------
export async function recordScanAudit(params: {
  userId: string;
  normalizedEmail: string | null;
  deviceId: string | null;
  ip: string | null;
  success: boolean;
  countedAgainstFree: boolean;
  parseError?: string | null;
}): Promise<string | null> {
  try {
    const [row] = await db.insert(aiScanAudit).values({
      userId: params.userId,
      normalizedEmail: params.normalizedEmail,
      deviceId: params.deviceId,
      ip: params.ip,
      scannedAt: new Date().toISOString(),
      success: params.success,
      countedAgainstFree: params.countedAgainstFree,
      parseError: params.parseError ?? null,
    }).returning({ id: aiScanAudit.id });
    return row?.id ?? null;
  } catch (err) {
    console.error("Failed to write ai_scan_audit row:", err);
    // Swallow — audit failure must never block a real scan.
    return null;
  }
}
