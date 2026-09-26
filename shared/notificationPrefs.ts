// Notification preferences — shared by server (send-time gating) and client
// (Notifications screen in the menu drawer).
//
// Stored on users.notification_prefs as a JSON string. Every key defaults to
// ON: a missing key, a missing column value, or unparseable JSON all mean
// "send it". That keeps existing users' behaviour unchanged until they
// actively turn something off.
//
// Always sent, never gated (not listed here on purpose): sign-in codes,
// password resets, exports the user asked for, and reminders from friends.

export const NOTIFICATION_PREF_KEYS = [
  "newExpenses",     // push — someone adds an expense with you (incl. recurring)
  "settleUps",       // push — someone settles up with you
  "deletedExpenses", // push — someone deletes an expense you're in (or clears all)
  "emailCopies",     // email — copies of receipt expenses and settle-ups
  "groupActivity",   // push — added to a group / someone joins your group
  "weeklyBalance",   // push — weekly "you're owed $X" digest
  "news",            // email + push — announcements / campaigns
] as const;

export type NotificationPrefKey = (typeof NOTIFICATION_PREF_KEYS)[number];
export type NotificationPrefs = Record<NotificationPrefKey, boolean>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  newExpenses: true,
  settleUps: true,
  deletedExpenses: true,
  emailCopies: true,
  groupActivity: true,
  weeklyBalance: true,
  news: true,
};

/** Parse the stored JSON. Anything missing or malformed falls back to ON. */
export function parseNotificationPrefs(raw: string | null | undefined): NotificationPrefs {
  let stored: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") stored = parsed;
    } catch {
      // fall through to defaults
    }
  }
  const prefs = { ...DEFAULT_NOTIFICATION_PREFS };
  for (const key of NOTIFICATION_PREF_KEYS) {
    if (typeof stored[key] === "boolean") prefs[key] = stored[key] as boolean;
  }
  return prefs;
}

/** Keep only known keys with boolean values from an untrusted request body. */
export function sanitizeNotificationPrefsPatch(body: unknown): Partial<NotificationPrefs> {
  const patch: Partial<NotificationPrefs> = {};
  if (!body || typeof body !== "object") return patch;
  for (const key of NOTIFICATION_PREF_KEYS) {
    const v = (body as Record<string, unknown>)[key];
    if (typeof v === "boolean") patch[key] = v;
  }
  return patch;
}
