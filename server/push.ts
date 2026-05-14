/**
 * Push notification fan-out — mirrors the email pattern in server/email.ts.
 *
 * Each function:
 *   1. Looks up device tokens for the recipient userIds
 *   2. Builds the iOS notification payload (title + body)
 *   3. Sends in parallel via apns.ts
 *   4. Auto-deletes any tokens APNs reports as invalid (Unregistered, etc.)
 *
 * All functions are fire-and-forget safe: they never throw, they return after
 * APNs responds, and on any failure they log + return silently. This means
 * existing expense-creation flows never break if push is misconfigured.
 *
 * The data shape matches notifyExpenseCreated() so callers can pass the same
 * source data (just userIds instead of emails for the recipients).
 */

import { db } from "./db";
import { deviceTokens } from "@shared/schema";
import { inArray, and, ne, eq } from "drizzle-orm";
import { sendApnsBatch, APNS_ENABLED, type ApnsTokenRef } from "./apns";

interface RecipientFetch {
  token: string;
  environment: "production" | "sandbox";
}

async function getTokensForUsers(userIds: string[], excludeUserId?: string): Promise<ApnsTokenRef[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ token: deviceTokens.token, environment: deviceTokens.environment })
    .from(deviceTokens)
    .where(
      excludeUserId
        ? and(inArray(deviceTokens.userId, userIds), ne(deviceTokens.userId, excludeUserId))
        : inArray(deviceTokens.userId, userIds),
    );
  return rows.map((r) => ({
    token: r.token,
    environment: (r.environment as "production" | "sandbox") || "production",
  }));
}

async function purgeInvalidTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  try {
    await db.delete(deviceTokens).where(inArray(deviceTokens.token, tokens));
    console.log(`[push] purged ${tokens.length} invalid token(s)`);
  } catch (err) {
    console.error("[push] failed to purge invalid tokens:", err);
  }
}

function formatAmount(amount: number, currency = "CAD"): string {
  // Match the symbol style used elsewhere in the app
  const symbols: Record<string, string> = {
    CAD: "CA$", USD: "US$", EUR: "€", GBP: "£",
    AUD: "A$",  INR: "₹",  MXN: "MX$", JPY: "¥",
    CHF: "CHF", NZD: "NZ$", SGD: "S$", HKD: "HK$",
  };
  const sym = symbols[currency] ?? currency + " ";
  return `${sym}${amount.toFixed(2)}`;
}

/**
 * Notify split recipients about a new expense / settlement / recurring expense.
 * Skips the payer (they performed the action themselves).
 *
 * If push is misconfigured, returns silently without affecting the caller.
 */
export async function pushExpenseCreated(opts: {
  description: string;
  amount: number;
  paidByName: string;
  paidByUserId: string;
  /** All userIds in the split, including the payer (we filter the payer out). */
  splitAmongUserIds: string[];
  groupName?: string;
  isSettlement?: boolean;
  isRecurring?: boolean;
}): Promise<void> {
  if (!APNS_ENABLED) return;

  // Deduplicate + drop the payer — they don't need a push for their own action
  const recipientIds = Array.from(new Set(opts.splitAmongUserIds)).filter(
    (id) => id && id !== opts.paidByUserId,
  );
  if (recipientIds.length === 0) return;

  const tokens = await getTokensForUsers(recipientIds);
  if (tokens.length === 0) return;

  const formatted = formatAmount(opts.amount);

  let title: string;
  let body: string;

  if (opts.isSettlement) {
    // "Sarah settled with you · CA$25.00" or "Sarah settled with you · CA$25.00 in Roommates"
    title = `${opts.paidByName} settled with you`;
    body = opts.groupName ? `${formatted} in ${opts.groupName}` : formatted;
  } else if (opts.isRecurring) {
    // "Recurring: Rent · Sarah added CA$1200.00 in Roommates"
    title = `Recurring: ${opts.description}`;
    body = `${opts.paidByName} added ${formatted}${opts.groupName ? ` in ${opts.groupName}` : ""}`;
  } else if (opts.groupName) {
    // Group expense: "Sarah added an expense · Pizza · CA$25.00 in Roommates"
    title = `${opts.paidByName} added an expense`;
    body = `${opts.description} · ${formatted} in ${opts.groupName}`;
  } else {
    // Friend split: "Sarah split CA$25.00 with you · Pizza"
    title = `${opts.paidByName} split ${formatted} with you`;
    body = opts.description;
  }

  const result = await sendApnsBatch(tokens, {
    title,
    body,
    threadId: opts.groupName ? `group:${opts.groupName}` : "spliiit:expense",
    data: {
      type: opts.isSettlement ? "settlement" : opts.isRecurring ? "recurring" : opts.groupName ? "group_expense" : "friend_expense",
      groupName: opts.groupName,
      amount: opts.amount,
      paidByName: opts.paidByName,
    },
  });

  if (result.invalidTokens.length > 0) {
    await purgeInvalidTokens(result.invalidTokens);
  }
}

/**
 * Notify existing group members when someone accepts an invite link and joins.
 * This is the retention engine for first-run: a new user invites a friend →
 * friend joins → first user gets a push → they come back to the app.
 *
 * Recipients: all current group members EXCLUDING the new joiner.
 * Fire-and-forget. Never throws.
 */
export async function pushGroupMemberJoined(opts: {
  joinerUserId: string;
  joinerName: string;
  groupId: string;
  groupName: string;
  /** All current member ids of the group AFTER the joiner was added. */
  groupMemberIds: string[];
}): Promise<void> {
  if (!APNS_ENABLED) return;

  const recipientIds = Array.from(new Set(opts.groupMemberIds)).filter(
    (id) => id && id !== opts.joinerUserId,
  );
  if (recipientIds.length === 0) return;

  const tokens = await getTokensForUsers(recipientIds);
  if (tokens.length === 0) return;

  const result = await sendApnsBatch(tokens, {
    title: `${opts.joinerName} joined ${opts.groupName}`,
    body: "Add an expense to start splitting.",
    threadId: `group:${opts.groupName}`,
    data: {
      type: "group_member_joined",
      groupId: opts.groupId,
      groupName: opts.groupName,
      joinerName: opts.joinerName,
    },
  });

  if (result.invalidTokens.length > 0) {
    await purgeInvalidTokens(result.invalidTokens);
  }
}

/**
 * Weekly digest push — nudges a single user about their outstanding balance.
 * Only sent when net is POSITIVE (they're owed money) so the message stays
 * positive ("go collect") instead of guilt-trippy ("you owe…").
 *
 * Recipient: the user themselves. No fan-out.
 * Fire-and-forget. Never throws.
 */
export async function pushWeeklyDigest(opts: {
  userId: string;
  amountOwed: number;        // always positive
  counterpartyCount: number; // distinct people who owe them
  currency?: string;
}): Promise<void> {
  if (!APNS_ENABLED) return;
  if (opts.amountOwed <= 0) return;

  const tokens = await getTokensForUsers([opts.userId]);
  if (tokens.length === 0) return;

  const formatted = formatAmount(opts.amountOwed, opts.currency ?? "CAD");
  const peopleLabel = opts.counterpartyCount === 1 ? "friend" : "friends";

  const result = await sendApnsBatch(tokens, {
    title: "Open balances on Spliiit",
    body: `You're owed ${formatted} across ${opts.counterpartyCount} ${peopleLabel} — tap to settle up.`,
    threadId: "spliiit:digest",
    data: {
      type: "weekly_digest",
      amountOwed: opts.amountOwed,
      counterpartyCount: opts.counterpartyCount,
    },
  });

  if (result.invalidTokens.length > 0) {
    await purgeInvalidTokens(result.invalidTokens);
  }
}

/** Delete a device token by exact match — used on logout / deregister. */
export async function deleteDeviceToken(token: string, userId: string): Promise<void> {
  try {
    await db
      .delete(deviceTokens)
      .where(and(eq(deviceTokens.token, token), eq(deviceTokens.userId, userId)));
  } catch (err) {
    console.error("[push] failed to delete device token:", err);
  }
}
