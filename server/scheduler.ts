import { storage } from "./storage";
import { sendAutoReminderEmail } from "./email";
import { pushExpenseCreated, pushWeeklyDigest } from "./push";

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

  // Recurring expenses: check every 6 hours
  setInterval(processRecurringExpenses, 6 * 60 * 60 * 1000);

  // Auto-reminders: check every 24 hours
  setInterval(processAutoReminders, 24 * 60 * 60 * 1000);

  // Weekly digest push: check every 24 hours (per-user throttle gates 6-day cadence)
  setInterval(processWeeklyDigestPush, 24 * 60 * 60 * 1000);
}
