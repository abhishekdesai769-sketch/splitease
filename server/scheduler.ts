import { storage } from "./storage";
import { pool } from "./db";
import { sendAutoReminderEmail, sendWeeklyAnalyticsDigest } from "./email";
import { pushExpenseCreated, pushWeeklyDigest } from "./push";

// ISO-8601 week key (e.g. "2026-W31") — the once-per-week idempotency key.
function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(
    ((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// Weekly analytics digest to the founder — rolling KPIs + one prioritized
// insight. Claims the ISO-week key first (INSERT ... ON CONFLICT DO NOTHING) so
// a redeploy or a second instance can never double-send. Read-only analytics.
async function processWeeklyAnalyticsDigest() {
  try {
    const now = new Date();
    const weekKey = isoWeekKey(now);
    const claim = await pool.query(
      `INSERT INTO analytics_digest_sent (week_key, sent_at) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [weekKey, now.toISOString()],
    );
    if (claim.rowCount === 0) return; // already sent this week

    const { rows } = await pool.query(`
      WITH activated AS (
        SELECT DISTINCT uid FROM (
          SELECT paid_by_id AS uid FROM expenses WHERE deleted_at IS NULL AND is_settlement = false
          UNION SELECT unnest(split_among_ids) FROM expenses WHERE deleted_at IS NULL AND is_settlement = false
        ) t
      ),
      first_exp AS (
        SELECT uid, min(safe_ts(d)) AS first_at FROM (
          SELECT paid_by_id AS uid, date AS d FROM expenses WHERE deleted_at IS NULL AND is_settlement = false
          UNION ALL SELECT unnest(split_among_ids), date FROM expenses WHERE deleted_at IS NULL AND is_settlement = false
        ) t GROUP BY uid
      ),
      ex AS (
        SELECT paid_by_id AS uid, safe_ts(date) AS d FROM expenses WHERE deleted_at IS NULL AND is_settlement = false
        UNION ALL SELECT unnest(split_among_ids), safe_ts(date) FROM expenses WHERE deleted_at IS NULL AND is_settlement = false
      )
      SELECT
        (SELECT count(*) FROM users WHERE is_ghost = false) AS total_users,
        (SELECT count(*) FROM users u WHERE u.is_ghost = false AND EXISTS (SELECT 1 FROM activated a WHERE a.uid = u.id)) AS activated_users,
        (SELECT count(*) FROM users WHERE is_ghost = false AND is_premium = true AND safe_ts(premium_until) > now()) AS active_premium,
        (SELECT count(*) FROM first_exp fe JOIN users u ON u.id = fe.uid AND u.is_ghost = false WHERE fe.first_at >= now() - interval '30 days' AND fe.first_at < now()) AS new_30d,
        (SELECT count(*) FROM first_exp fe JOIN users u ON u.id = fe.uid AND u.is_ghost = false WHERE fe.first_at >= now() - interval '60 days' AND fe.first_at < now() - interval '30 days') AS new_prev30d,
        (SELECT count(DISTINCT ex.uid) FROM ex JOIN users u ON u.id = ex.uid AND u.is_ghost = false WHERE ex.d >= now() - interval '30 days' AND ex.d < now()) AS active_30d,
        (SELECT count(DISTINCT ex.uid) FROM ex JOIN users u ON u.id = ex.uid AND u.is_ghost = false WHERE ex.d >= now() - interval '60 days' AND ex.d < now() - interval '30 days') AS active_prev30d,
        (SELECT count(*) FROM expenses WHERE deleted_at IS NULL AND is_settlement = false AND safe_ts(date) >= now() - interval '30 days' AND safe_ts(date) < now()) AS exp_30d,
        (SELECT count(*) FROM expenses WHERE deleted_at IS NULL AND is_settlement = false AND safe_ts(date) >= now() - interval '60 days' AND safe_ts(date) < now() - interval '30 days') AS exp_prev30d
    `);
    const r = rows[0] || {};
    const N = (v: any) => Number(v ?? 0);
    const total = N(r.total_users), activated = N(r.activated_users);
    const dormant = Math.max(0, total - activated);
    const actRate = total > 0 ? (activated / total) * 100 : 0;
    const new30 = N(r.new_30d), newPrev = N(r.new_prev30d);
    const act30 = N(r.active_30d), actPrev = N(r.active_prev30d);
    const exp30 = N(r.exp_30d), expPrev = N(r.exp_prev30d);

    const delta = (a: number, b: number): { delta: string; dir: "up" | "down" | "flat" } => {
      if (b === 0) return a > 0 ? { delta: "new", dir: "up" } : { delta: "", dir: "flat" };
      const p = Math.round(((a - b) / b) * 100);
      return { delta: `${p > 0 ? "+" : ""}${p}%`, dir: p > 0 ? "up" : p < 0 ? "down" : "flat" };
    };

    const digestRows = [
      { label: "Activation rate", value: `${actRate.toFixed(1)}%` },
      { label: "Activated users", value: String(activated) },
      { label: "Dormant users", value: String(dormant) },
      { label: "Newly activated (30d)", value: String(new30), ...delta(new30, newPrev) },
      { label: "Active users (30d)", value: String(act30), ...delta(act30, actPrev) },
      { label: "Expenses created (30d)", value: String(exp30), ...delta(exp30, expPrev) },
      { label: "Active premium", value: String(N(r.active_premium)) },
    ];

    let insight: string;
    if (total > 0 && dormant / total > 0.4) {
      insight = `${dormant} of ${total} users (${Math.round((dormant / total) * 100)}%) signed up but never split an expense. Your biggest lever is activation — get new users to their first expense faster.`;
    } else if (act30 < actPrev) {
      insight = `Active users fell vs the prior 30 days — dig into retention: why aren't people coming back?`;
    } else {
      insight = `Activation looks healthy — push virality: your invite loop is the growth engine.`;
    }

    try {
      await sendWeeklyAnalyticsDigest({ to: "spliiit@klarityit.ca", rows: digestRows, insight });
      console.log("[scheduler] weekly analytics digest sent for", weekKey);
    } catch (sendErr) {
      // Send failed AFTER we claimed the week — release the claim so the next
      // daily tick retries instead of silently skipping the week.
      await pool.query(`DELETE FROM analytics_digest_sent WHERE week_key = $1`, [weekKey]).catch(() => {});
      throw sendErr;
    }
  } catch (err) {
    console.error("[scheduler] processWeeklyAnalyticsDigest failed:", err);
  }
}

async function processRecurringExpenses() {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  try {
    const due = await storage.getAllDueRecurringExpenses(today);
    if (due.length === 0) return;

    console.log(`[scheduler] Processing ${due.length} due recurring expense(s)`);

    for (const rec of due) {
      try {
        // Create the actual expense instance
        await storage.createExpense({
          description: rec.description,
          amount: rec.amount,
          paidById: rec.paidById,
          splitAmongIds: rec.splitAmongIds,
          groupId: rec.groupId ?? null,
          date: new Date().toISOString(),
          addedById: rec.userId,
          isSettlement: false,
          receiptData: null,
          splitAmounts: null,
          deletedAt: null,
        });

        // iOS push notifications for the new recurring expense
        // (fire-and-forget; wrapped in try so it never aborts the cron loop)
        try {
          const payer = await storage.getUser(rec.paidById);
          let groupName: string | undefined;
          if (rec.groupId) {
            const g = await storage.getGroup(rec.groupId);
            groupName = g?.name;
          }
          if (payer) {
            pushExpenseCreated({
              description: rec.description,
              amount: rec.amount,
              paidByName: payer.name,
              paidByUserId: rec.paidById,
              splitAmongUserIds: rec.splitAmongIds,
              groupName,
              isRecurring: true,
            }).catch((err) => console.error("[push] recurring:", err));
          }
        } catch (e) { /* ignore push setup errors */ }

        // Advance nextRunDate by the frequency
        const next = new Date(rec.nextRunDate + "T12:00:00Z"); // noon UTC avoids DST edge cases
        if (rec.frequency === "weekly") {
          next.setUTCDate(next.getUTCDate() + 7);
        } else {
          next.setUTCMonth(next.getUTCMonth() + 1);
        }
        const nextRunDate = next.toISOString().split("T")[0];
        await storage.updateRecurringExpenseNextRun(rec.id, nextRunDate);

        console.log(`[scheduler] ✓ Created recurring "${rec.description}" (${rec.frequency}) for user ${rec.userId} — next: ${nextRunDate}`);
      } catch (err) {
        console.error(`[scheduler] Failed to process recurring expense ${rec.id}:`, err);
      }
    }
  } catch (err) {
    console.error("[scheduler] Error fetching due recurring expenses:", err);
  }
}

// ─── Auto Payment Reminders ──────────────────────────────────────────────────
// Runs daily. For each premium user with reminders enabled, computes who owes
// them money and sends an email from Spliiit's voice if the debt has been
// outstanding longer than the user's configured threshold (min 7 days).

async function processAutoReminders() {
  const APP_URL = process.env.APP_URL || "https://spliiit.klarityit.ca";
  const today = new Date();

  try {
    const premiumUsers = await storage.getPremiumUsersWithRemindersEnabled();
    if (premiumUsers.length === 0) return;

    console.log(`[scheduler] Processing auto-reminders for ${premiumUsers.length} premium user(s)`);

    for (const premUser of premiumUsers) {
      try {
        const tone = (premUser.reminderTone || "friendly") as "friendly" | "firm" | "awkward";
        const thresholdDays = premUser.reminderDays ?? 7;

        // Get all direct (non-group) expenses involving this user
        const directExpenses = await storage.getDirectExpensesForUser(premUser.id);

        // Compute net balance per counterparty
        // Positive = counterparty owes premUser; negative = premUser owes them
        const netByPeer: Record<string, number> = {};

        for (const exp of directExpenses) {
          const peerIds = exp.splitAmongIds.filter(id => id !== premUser.id);
          const peerId = peerIds[0];
          if (!peerId) continue;

          const splitCount = exp.splitAmongIds.length;
          const perPersonShare = exp.amount / splitCount;

          if (exp.paidById === premUser.id) {
            // premUser paid — peer owes premUser their share
            netByPeer[peerId] = (netByPeer[peerId] || 0) + perPersonShare * (splitCount - 1);
          } else if (exp.paidById === peerId) {
            // peer paid — premUser owes peer their share
            netByPeer[peerId] = (netByPeer[peerId] || 0) - perPersonShare;
          }
        }

        // Only consider peers who owe premUser (positive balance)
        for (const [peerId, net] of Object.entries(netByPeer)) {
          if (net <= 0.009) continue; // they don't owe premUser

          // Skip ghost users — they have no real email
          const peer = await storage.getUser(peerId);
          if (!peer || peer.isGhost || !peer.email) continue;

          // Check last reminder sent
          const lastSent = await storage.getLastReminderSent(premUser.id, peerId);
          if (lastSent) {
            const daysSinceLast = (today.getTime() - new Date(lastSent.sentAt).getTime()) / (1000 * 60 * 60 * 24);
            if (daysSinceLast < thresholdDays) continue; // too soon
          }

          // Send the reminder email
          await sendAutoReminderEmail({
            to: peer.email,
            recipientName: peer.name,
            owedToName: premUser.name,
            amount: net,
            tone,
            appUrl: APP_URL,
          });

          // Record the send timestamp
          await storage.upsertSentReminder(premUser.id, peerId, new Date().toISOString());

          console.log(`[scheduler] ✓ Auto-reminder sent: ${premUser.name} → ${peer.name} ($${net.toFixed(2)}, ${tone})`);
        }
      } catch (err) {
        console.error(`[scheduler] Auto-reminder failed for user ${premUser.id}:`, err);
      }
    }
  } catch (err) {
    console.error("[scheduler] Error processing auto-reminders:", err);
  }
}

// ─── Weekly Digest Push ──────────────────────────────────────────────────────
// Re-engagement: once a week, ping iOS users who are owed money about their
// open balances. Only positive-net users (money TO collect) — never push the
// "you owe" side, that feels punitive. Throttled via users.lastWeeklyDigestPushAt
// so rapid Render redeploys can't double-fire within a 6-day window.
//
// We deliberately use a SIMPLE per-user balance heuristic here:
//   - Sum what the user paid that others share in (positive contribution)
//   - Subtract what others paid that the user shares in (negative contribution)
// This isn't the full simplified-debts graph used in the UI, but it's a
// faithful "is this user net-positive" signal which is all the digest needs.
// IMPORTANT: We do NOT touch shared/simplify.ts — that algorithm is locked.

const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;

async function processWeeklyDigestPush() {
  try {
    const users = await storage.getAllUsers();
    if (users.length === 0) return;

    const now = new Date();
    let sent = 0;
    let skippedThrottle = 0;

    for (const u of users) {
      try {
        // Throttle: skip if we sent a digest in the last 6 days
        if (u.lastWeeklyDigestPushAt) {
          const lastMs = new Date(u.lastWeeklyDigestPushAt).getTime();
          if (!Number.isNaN(lastMs) && now.getTime() - lastMs < SIX_DAYS_MS) {
            skippedThrottle++;
            continue;
          }
        }

        const expenses = await storage.getExpensesForUser(u.id);
        if (expenses.length === 0) continue;

        // Per-counterparty net balance. Positive = they owe me.
        const netByPeer: Record<string, number> = {};

        for (const exp of expenses) {
          if (exp.deletedAt) continue;
          const splitCount = exp.splitAmongIds.length;
          if (splitCount === 0) continue;

          // Parse custom splits if present, else equal share
          let customSplits: Record<string, number> | null = null;
          if (exp.splitAmounts) {
            try { customSplits = JSON.parse(exp.splitAmounts); } catch { /* ignore */ }
          }
          const perPerson = exp.amount / splitCount;

          if (exp.paidById === u.id) {
            // I paid — each other person in the split owes me their share
            for (const peerId of exp.splitAmongIds) {
              if (peerId === u.id) continue;
              const share = customSplits ? (customSplits[peerId] ?? 0) : perPerson;
              netByPeer[peerId] = (netByPeer[peerId] || 0) + share;
            }
          } else if (exp.splitAmongIds.includes(u.id)) {
            // Someone else paid and I'm in the split — I owe them my share
            const myShare = customSplits ? (customSplits[u.id] ?? 0) : perPerson;
            netByPeer[exp.paidById] = (netByPeer[exp.paidById] || 0) - myShare;
          }
        }

        // Total positive net (money to collect) + count of counterparties owing
        let totalOwed = 0;
        let counterparties = 0;
        for (const net of Object.values(netByPeer)) {
          if (net > 0.5) {
            // 50-cent threshold — ignore rounding dust
            totalOwed += net;
            counterparties++;
          }
        }

        if (totalOwed < 1 || counterparties === 0) continue;

        // Round to 2dp for the message
        const amountOwed = Math.round(totalOwed * 100) / 100;

        await pushWeeklyDigest({
          userId: u.id,
          amountOwed,
          counterpartyCount: counterparties,
          currency: u.defaultCurrency ?? "CAD",
        });

        await storage.updateUser(u.id, { lastWeeklyDigestPushAt: now.toISOString() });
        sent++;
      } catch (err) {
        console.error(`[scheduler] weekly digest failed for user ${u.id}:`, err);
      }
    }

    if (sent > 0 || skippedThrottle > 0) {
      console.log(`[scheduler] weekly digest: sent ${sent}, throttled ${skippedThrottle}`);
    }
  } catch (err) {
    console.error("[scheduler] processWeeklyDigestPush failed:", err);
  }
}

export function startRecurringExpenseScheduler() {
  // Run once on startup (catches any missed runs during downtime)
  processRecurringExpenses();
  processAutoReminders();
  processWeeklyDigestPush();
  processWeeklyAnalyticsDigest();

  // Recurring expenses: check every 6 hours
  setInterval(processRecurringExpenses, 6 * 60 * 60 * 1000);

  // Auto-reminders: check every 24 hours
  setInterval(processAutoReminders, 24 * 60 * 60 * 1000);

  // Weekly digest push: check every 24 hours (per-user throttle gates 6-day cadence)
  setInterval(processWeeklyDigestPush, 24 * 60 * 60 * 1000);

  // Weekly founder analytics digest: check every 24h (ISO-week guard sends once/week)
  setInterval(processWeeklyAnalyticsDigest, 24 * 60 * 60 * 1000);
}
