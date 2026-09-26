// Send-time gating for notification preferences.
//
// Every helper FAILS OPEN: if the preference lookup errors, we send. A missed
// "turn off" for one send is far less harmful than silently dropping every
// notification because the database hiccupped.

import { createHmac, timingSafeEqual } from "crypto";
import { inArray } from "drizzle-orm";
import { db } from "./db";
import { users } from "@shared/schema";
import { parseNotificationPrefs, type NotificationPrefKey } from "@shared/notificationPrefs";

/** Drop user ids that have turned `key` off. Order is preserved. */
export async function filterUserIdsByPref(userIds: string[], key: NotificationPrefKey): Promise<string[]> {
  if (userIds.length === 0) return [];
  try {
    const rows = await db
      .select({ id: users.id, prefs: users.notificationPrefs })
      .from(users)
      .where(inArray(users.id, userIds));
    const off = new Set(rows.filter((r) => !parseNotificationPrefs(r.prefs)[key]).map((r) => r.id));
    return userIds.filter((id) => !off.has(id));
  } catch (err) {
    console.error(`[notif-prefs] lookup failed for ${key}, sending anyway:`, err);
    return userIds;
  }
}

/** Email-keyed variant, for fan-outs that only know recipient addresses. */
export async function filterEmailsByPref(emails: string[], key: NotificationPrefKey): Promise<Set<string>> {
  const wanted = new Set(emails.map((e) => e.toLowerCase()));
  if (wanted.size === 0) return wanted;
  try {
    const rows = await db
      .select({ email: users.email, prefs: users.notificationPrefs })
      .from(users)
      .where(inArray(users.email, emails));
    for (const r of rows) {
      if (!parseNotificationPrefs(r.prefs)[key]) wanted.delete(r.email.toLowerCase());
    }
  } catch (err) {
    console.error(`[notif-prefs] email lookup failed for ${key}, sending anyway:`, err);
  }
  return wanted;
}

// ─── One-click unsubscribe links (News and updates emails) ─────────────────
// CASL requires a working unsubscribe on promotional email. The link carries
// the user id plus an HMAC so nobody can unsubscribe someone else by guessing.

function unsubscribeSecret(): string {
  return process.env.UNSUBSCRIBE_SECRET || process.env.SESSION_SECRET || "spliiit-dev-unsubscribe";
}

function sign(userId: string): string {
  return createHmac("sha256", unsubscribeSecret()).update(`news:${userId}`).digest("hex").slice(0, 32);
}

export function newsUnsubscribeUrl(userId: string): string {
  return `https://spliiit.ca/api/unsubscribe/news?u=${encodeURIComponent(userId)}&t=${sign(userId)}`;
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  const expected = Buffer.from(sign(userId));
  const given = Buffer.from(token || "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
