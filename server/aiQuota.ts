// server/aiQuota.ts
//
// AI Mode abuse prevention + cost observability.
//
// Three layers of protection:
//   1. Per-user daily quotas (text turns, image uploads, total attachments)
//   2. Per-user in-memory rate limit (catches bursts before they hit quota)
//   3. Per-conversation max-turn cap (stops runaway loops)
//   4. Global daily kill switch (env-var threshold; emergency stop)
//
// Plus: persistent per-user-per-day cost tracking in ai_usage_daily
// for admin observability and proactive alert emails.

import { db } from "./db";
import { aiUsageDaily, aiAlertsSent, aiMessages } from "@shared/schema";
import { eq, and, sql, gte, desc } from "drizzle-orm";
import { sendSupportEmail } from "./email";
import { ADMIN_EMAIL } from "./middleware";

// ─── Configuration ────────────────────────────────────────────────────────

/**
 * Per-user daily quotas. Premium-only feature so these only apply to Premium
 * users. Tuned so a normal power-user (5-10 turns/day) has plenty of headroom
 * but abuse (hundreds of API calls) gets stopped within ~$0.50/day spend.
 *
 * Numbers chosen via cost-math:
 *   - 50 text turns × $0.005 = $0.25
 *   - 10 image uploads × $0.02 = $0.20
 *   - Total worst case = ~$0.50/day per user = under our $1/month budget
 */
export const QUOTAS = {
  daily: {
    textTurns: 50,           // text-only or PDF-only turns
    imageAttachments: 10,    // expensive Claude vision calls
    totalAttachments: 20,    // images + PDFs combined
  },
  perMinute: {
    messages: 10,            // any message — burst protection
    attachmentUploads: 3,    // attachments are slow + expensive
  },
  perConversation: {
    maxTurns: 50,            // stops runaway loops; user starts new chat
  },
  // Cost estimation per action (cents). NOT actual Anthropic billing —
  // our internal estimate for admin observability + alert thresholds.
  costEstimateCents: {
    textTurn: 1,             // ~$0.005, rounded up to penny
    pdfAttachment: 1,        // pdf-parse fast path, just adds context to chat call
    imageAttachment: 2,      // ~$0.015-0.02 for Claude vision transcription
    transcriptionReplay: 1,  // when the verbatim context is re-fed in a turn
  },
  global: {
    // Daily-budget threshold across ALL users. When today's estimated total
    // spend crosses these, we trigger automated actions:
    //   - warningCents: send admin email (one per day per threshold)
    //   - killCents: set AI_MODE_DEGRADED flag (refuse new turns until reset)
    // Configurable via env vars for emergency adjustment.
    warningCents: parseInt(process.env.AI_MODE_DAILY_WARNING_CENTS || "1000", 10),  // $10/day default
    killCents: parseInt(process.env.AI_MODE_DAILY_KILL_CENTS || "3000", 10),        // $30/day default
  },
};

// ─── Global degraded state ────────────────────────────────────────────────

// In-memory flag — set true when global daily kill threshold trips OR when
// AI_MODE_DEGRADED env var is set at startup (manual emergency switch).
// Resets at UTC midnight (server time) via a small refresh on each turn.
let _globalDegraded = process.env.AI_MODE_DEGRADED === "true";
let _degradedDate = currentUtcDate();
let _degradedReason: string | null = null;

export function isGloballyDegraded(): { degraded: boolean; reason: string | null } {
  // Auto-reset at UTC midnight so a kill from yesterday doesn't carry over
  if (_degradedDate !== currentUtcDate()) {
    // Don't auto-reset if it was set via env var (manual)
    if (process.env.AI_MODE_DEGRADED !== "true") {
      _globalDegraded = false;
      _degradedReason = null;
    }
    _degradedDate = currentUtcDate();
  }
  return { degraded: _globalDegraded, reason: _degradedReason };
}

function triggerGlobalDegraded(reason: string) {
  _globalDegraded = true;
  _degradedReason = reason;
  _degradedDate = currentUtcDate();
}

// ─── Per-user rate limit (in-memory, keyed by userId not IP) ─────────────
//
// IP-based limits are broken for shared connections (NAT, dorms, offices).
// We key by user ID so two roommates on the same network don't share a quota.
// In-memory is fine for single-instance deployments (Render free/starter);
// for multi-instance you'd swap to Redis. Resets every 60s.

interface RateBucket {
  msgCount: number;
  attachCount: number;
  resetAt: number;
}
const _userRateMap = new Map<string, RateBucket>();

export function checkPerUserRate(
  userId: string,
  hasAttachment: boolean,
): { ok: true } | { ok: false; reason: string; retryAfterMs: number } {
  const now = Date.now();
  let bucket = _userRateMap.get(userId);
  if (!bucket || now > bucket.resetAt) {
    bucket = { msgCount: 0, attachCount: 0, resetAt: now + 60_000 };
    _userRateMap.set(userId, bucket);
  }

  if (bucket.msgCount >= QUOTAS.perMinute.messages) {
    return {
      ok: false,
      reason: `Slow down — max ${QUOTAS.perMinute.messages} messages per minute.`,
      retryAfterMs: bucket.resetAt - now,
    };
  }
  if (hasAttachment && bucket.attachCount >= QUOTAS.perMinute.attachmentUploads) {
    return {
      ok: false,
      reason: `Slow down — max ${QUOTAS.perMinute.attachmentUploads} attachment uploads per minute.`,
      retryAfterMs: bucket.resetAt - now,
    };
  }

  bucket.msgCount++;
  if (hasAttachment) bucket.attachCount++;
  return { ok: true };
}

// Periodic cleanup of stale buckets to prevent the map growing unbounded.
// Cheap — just iterate keys, drop expired ones. Runs lazily on each call
// every ~5 minutes since we wrote a new bucket.
let _lastCleanup = Date.now();
function cleanupRateMap() {
  const now = Date.now();
  if (now - _lastCleanup < 5 * 60_000) return;
  _lastCleanup = now;
  for (const [k, v] of _userRateMap.entries()) {
    if (now > v.resetAt) _userRateMap.delete(k);
  }
}

// ─── Daily quota checks ──────────────────────────────────────────────────

export interface DailyUsage {
  textTurns: number;
  attachmentTurns: number;
  imageAttachments: number;
  pdfAttachments: number;
  estimatedCostCents: number;
}

const EMPTY_USAGE: DailyUsage = {
  textTurns: 0,
  attachmentTurns: 0,
  imageAttachments: 0,
  pdfAttachments: 0,
  estimatedCostCents: 0,
};

export async function getTodaysUsage(userId: string): Promise<DailyUsage> {
  const today = currentUtcDate();
  const [row] = await db
    .select()
    .from(aiUsageDaily)
    .where(and(eq(aiUsageDaily.userId, userId), eq(aiUsageDaily.usageDate, today)))
    .limit(1);
  if (!row) return { ...EMPTY_USAGE };
  return {
    textTurns: row.textTurns,
    attachmentTurns: row.attachmentTurns,
    imageAttachments: row.imageAttachments,
    pdfAttachments: row.pdfAttachments,
    estimatedCostCents: row.estimatedCostCents,
  };
}

export interface QuotaCheckResult {
  ok: boolean;
  reason?: string;
  remainingTextTurns?: number;
  remainingImageUploads?: number;
}

/**
 * Before running an AI turn, check that the user is within their daily quotas.
 * Counts the about-to-happen turn against the relevant quota — if accepting
 * it would cross the cap, refuse.
 *
 * @param userId - the user about to send a turn
 * @param turn   - what kind of turn this is (affects which quotas apply)
 */
export async function checkDailyQuota(
  userId: string,
  turn: { hasAttachment: boolean; imageCount: number },
): Promise<QuotaCheckResult> {
  const u = await getTodaysUsage(userId);

  // Image attachments — the expensive one. Hard cap separately.
  if (turn.imageCount > 0 && u.imageAttachments + turn.imageCount > QUOTAS.daily.imageAttachments) {
    return {
      ok: false,
      reason: `You've hit your daily image-upload limit (${QUOTAS.daily.imageAttachments}/day). Resets at midnight UTC. Text-only AI Mode still works, or use the manual Add Expense form.`,
    };
  }

  // Total attachments (PDFs + images combined)
  if (turn.hasAttachment) {
    const totalSoFar = u.attachmentTurns;
    if (totalSoFar + 1 > QUOTAS.daily.totalAttachments) {
      return {
        ok: false,
        reason: `You've hit your daily attachment limit (${QUOTAS.daily.totalAttachments}/day). Resets at midnight UTC. Text-only AI Mode still works, or use the manual Add Expense form.`,
      };
    }
  }

  // Text turns (any kind of message counts here — keeps a coarse cap)
  if (u.textTurns + 1 > QUOTAS.daily.textTurns) {
    return {
      ok: false,
      reason: `You've hit your daily AI Mode limit (${QUOTAS.daily.textTurns} messages/day). Resets at midnight UTC. The manual Add Expense form is always available.`,
    };
  }

  return {
    ok: true,
    remainingTextTurns: QUOTAS.daily.textTurns - u.textTurns - 1,
    remainingImageUploads: QUOTAS.daily.imageAttachments - u.imageAttachments - turn.imageCount,
  };
}

// ─── Per-conversation turn cap ───────────────────────────────────────────

export async function checkConversationTurns(
  conversationId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId));
  if (count >= QUOTAS.perConversation.maxTurns * 2) {
    // *2 because each turn writes 1 user + 1 assistant message
    return {
      ok: false,
      reason: `This conversation has hit its message limit (${QUOTAS.perConversation.maxTurns} turns). Start a fresh AI Mode chat to continue.`,
    };
  }
  return { ok: true };
}

// ─── Increment usage after a successful turn ─────────────────────────────

export interface TurnCost {
  textTurn: boolean;
  hasAttachment: boolean;
  imageCount: number;
  pdfCount: number;
}

/**
 * Record a successful AI turn in ai_usage_daily — atomic UPSERT pattern via
 * Postgres ON CONFLICT DO UPDATE. Computes our internal cost estimate.
 * Also triggers global-spend checks (alerts + kill switch).
 */
export async function incrementUsage(userId: string, cost: TurnCost): Promise<void> {
  const today = currentUtcDate();
  const costCents =
    QUOTAS.costEstimateCents.textTurn +
    cost.imageCount * QUOTAS.costEstimateCents.imageAttachment +
    cost.pdfCount * QUOTAS.costEstimateCents.pdfAttachment;

  // UPSERT — insert if not exists, increment counters if it does. Drizzle
  // doesn't have a clean ON CONFLICT DO UPDATE builder for this case, so
  // use raw SQL for atomicity.
  await db.execute(sql`
    INSERT INTO ai_usage_daily (
      user_id, usage_date, text_turns, attachment_turns,
      image_attachments, pdf_attachments, estimated_cost_cents
    ) VALUES (
      ${userId}, ${today},
      ${cost.textTurn ? 1 : 0},
      ${cost.hasAttachment ? 1 : 0},
      ${cost.imageCount},
      ${cost.pdfCount},
      ${costCents}
    )
    ON CONFLICT (user_id, usage_date) DO UPDATE SET
      text_turns = ai_usage_daily.text_turns + ${cost.textTurn ? 1 : 0},
      attachment_turns = ai_usage_daily.attachment_turns + ${cost.hasAttachment ? 1 : 0},
      image_attachments = ai_usage_daily.image_attachments + ${cost.imageCount},
      pdf_attachments = ai_usage_daily.pdf_attachments + ${cost.pdfCount},
      estimated_cost_cents = ai_usage_daily.estimated_cost_cents + ${costCents}
  `);

  // Fire-and-forget global-spend check. Don't await — turn completes either way.
  setImmediate(() => {
    checkGlobalSpend().catch((err) =>
      console.error("[aiQuota] global spend check failed:", err),
    );
  });

  // Opportunistic cleanup of the in-memory rate map
  cleanupRateMap();
}

// ─── Global spend check + alerts + kill switch ───────────────────────────

async function getTodaysGlobalSpendCents(): Promise<number> {
  const today = currentUtcDate();
  const [row] = await db
    .select({ total: sql<number>`COALESCE(SUM(estimated_cost_cents), 0)::int` })
    .from(aiUsageDaily)
    .where(eq(aiUsageDaily.usageDate, today));
  return row?.total ?? 0;
}

async function alreadyAlertedToday(kind: string): Promise<boolean> {
  const today = currentUtcDate();
  const [row] = await db
    .select()
    .from(aiAlertsSent)
    .where(and(eq(aiAlertsSent.alertDate, today), eq(aiAlertsSent.alertKind, kind)))
    .limit(1);
  return !!row;
}

async function markAlertSent(kind: string): Promise<void> {
  const today = currentUtcDate();
  await db.execute(sql`
    INSERT INTO ai_alerts_sent (alert_date, alert_kind, sent_at)
    VALUES (${today}, ${kind}, ${new Date().toISOString()})
    ON CONFLICT (alert_date, alert_kind) DO NOTHING
  `);
}

async function checkGlobalSpend(): Promise<void> {
  const totalCents = await getTodaysGlobalSpendCents();

  // Layer 1: WARNING threshold — send admin email (once per day)
  if (totalCents >= QUOTAS.global.warningCents && !(await alreadyAlertedToday("spend_warning"))) {
    const totalDollars = (totalCents / 100).toFixed(2);
    await markAlertSent("spend_warning");
    sendSupportEmail({
      fromName: "Spliiit System",
      fromEmail: ADMIN_EMAIL,
      subject: `[Spliiit] AI Mode daily spend at $${totalDollars}`,
      message:
        `Heads up: today's estimated AI Mode spend has crossed the warning ` +
        `threshold of $${(QUOTAS.global.warningCents / 100).toFixed(2)}.\n\n` +
        `Current estimate: $${totalDollars}\n` +
        `Kill-switch threshold: $${(QUOTAS.global.killCents / 100).toFixed(2)}\n\n` +
        `If this looks abnormal, check /admin → AI Usage for top spenders. ` +
        `To manually kill AI Mode, set AI_MODE_DEGRADED=true on Render and redeploy.`,
    }).catch((err) => console.error("[aiQuota] alert email failed:", err));
  }

  // Layer 2: KILL threshold — flip the degraded flag (refuse new turns)
  if (totalCents >= QUOTAS.global.killCents && !(await alreadyAlertedToday("spend_kill"))) {
    const totalDollars = (totalCents / 100).toFixed(2);
    triggerGlobalDegraded(
      `Daily spend hit kill threshold ($${totalDollars}). AI Mode auto-paused until UTC midnight.`,
    );
    await markAlertSent("spend_kill");
    sendSupportEmail({
      fromName: "Spliiit System",
      fromEmail: ADMIN_EMAIL,
      subject: `[Spliiit] AI Mode AUTO-KILLED at $${totalDollars}`,
      message:
        `URGENT: today's estimated AI Mode spend has crossed the KILL threshold ` +
        `of $${(QUOTAS.global.killCents / 100).toFixed(2)}.\n\n` +
        `AI Mode is now auto-paused for the rest of the UTC day. Users will see ` +
        `a friendly "taking a breather" message. It will auto-resume at midnight UTC.\n\n` +
        `Current estimate: $${totalDollars}\n\n` +
        `Investigate /admin → AI Usage for the responsible user(s). ` +
        `To resume early, restart the Render service (clears the in-memory flag).`,
    }).catch((err) => console.error("[aiQuota] kill alert email failed:", err));
  }
}

// ─── Admin observability helpers ─────────────────────────────────────────

export interface UsageSummary {
  date: string;
  totalEstimatedCents: number;
  topSpenders: Array<{
    userId: string;
    textTurns: number;
    attachmentTurns: number;
    imageAttachments: number;
    pdfAttachments: number;
    estimatedCostCents: number;
  }>;
  uniqueUsers: number;
  totalTextTurns: number;
  totalImageAttachments: number;
}

export async function getDailyUsageSummary(date?: string): Promise<UsageSummary> {
  const targetDate = date || currentUtcDate();
  const rows = await db
    .select()
    .from(aiUsageDaily)
    .where(eq(aiUsageDaily.usageDate, targetDate))
    .orderBy(desc(aiUsageDaily.estimatedCostCents));

  const top = rows.slice(0, 20).map((r) => ({
    userId: r.userId,
    textTurns: r.textTurns,
    attachmentTurns: r.attachmentTurns,
    imageAttachments: r.imageAttachments,
    pdfAttachments: r.pdfAttachments,
    estimatedCostCents: r.estimatedCostCents,
  }));

  return {
    date: targetDate,
    totalEstimatedCents: rows.reduce((s, r) => s + r.estimatedCostCents, 0),
    topSpenders: top,
    uniqueUsers: rows.length,
    totalTextTurns: rows.reduce((s, r) => s + r.textTurns, 0),
    totalImageAttachments: rows.reduce((s, r) => s + r.imageAttachments, 0),
  };
}

export async function getRecentUsageWindow(days: number = 7): Promise<Array<{
  date: string;
  totalCents: number;
  uniqueUsers: number;
}>> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const rows = await db
    .select({
      usageDate: aiUsageDaily.usageDate,
      total: sql<number>`SUM(estimated_cost_cents)::int`,
      users: sql<number>`COUNT(DISTINCT user_id)::int`,
    })
    .from(aiUsageDaily)
    .where(gte(aiUsageDaily.usageDate, cutoffDate))
    .groupBy(aiUsageDaily.usageDate)
    .orderBy(desc(aiUsageDaily.usageDate));
  return rows.map((r) => ({
    date: r.usageDate,
    totalCents: r.total,
    uniqueUsers: r.users,
  }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function currentUtcDate(): string {
  return new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
}
