import { storage } from "./storage";

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

export function startRecurringExpenseScheduler() {
  // Run once on startup (catches any missed runs during downtime)
  processRecurringExpenses();

  // Then check every 6 hours
  setInterval(processRecurringExpenses, 6 * 60 * 60 * 1000);
}
