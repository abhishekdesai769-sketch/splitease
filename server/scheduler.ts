import { storage } from "./storage";
import { sendAutoReminderEmail } from "./email";

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

export function startRecurringExpenseScheduler() {
  // Run once on startup (catches any missed runs during downtime)
  processRecurringExpenses();
  processAutoReminders();

  // Recurring expenses: check every 6 hours
  setInterval(processRecurringExpenses, 6 * 60 * 60 * 1000);

  // Auto-reminders: check every 24 hours
  setInterval(processAutoReminders, 24 * 60 * 60 * 1000);
}
