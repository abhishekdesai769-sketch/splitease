import { pgTable, text, varchar, real, boolean, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

// Users (registered accounts)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").notNull(), // mandatory, unique identity
  password: text("password"), // hashed; null for Google-OAuth-only accounts
  googleId: text("google_id"), // Google OAuth sub — null for email/password accounts
  appleId: text("apple_id"),   // Apple Sign In sub — null for non-Apple accounts
  avatarColor: text("avatar_color").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  isApproved: boolean("is_approved").notNull().default(true), // auto-approved on signup
  isEmailVerified: boolean("is_email_verified").notNull().default(false),
  isGhost: boolean("is_ghost").notNull().default(false),
  isPremium: boolean("is_premium").notNull().default(false),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  premiumUntil: text("premium_until"), // ISO date string, null = no active sub
  // Auto-reminder settings (premium feature)
  reminderEnabled: boolean("reminder_enabled").notNull().default(false),
  reminderDays: integer("reminder_days").notNull().default(7), // send after N days of outstanding balance
  reminderTone: text("reminder_tone").notNull().default("friendly"), // "friendly" | "firm" | "awkward"
  // User preferences
  defaultCurrency: text("default_currency"),              // e.g. "CAD" — locked after first set
  currencyLockedAt: text("currency_locked_at"),           // ISO timestamp — null = not yet set
  firstRunCompletedAt: text("first_run_completed_at"),    // ISO timestamp — null = user hasn't finished/skipped first-run wizard yet
  lastWeeklyDigestPushAt: text("last_weekly_digest_push_at"), // ISO timestamp — throttle the weekly "you're owed $X" digest push
  themePreference: text("theme_preference").notNull().default("system"), // "dark"|"light"|"system"
  utmCampaign: text("utm_campaign"),   // WhatsApp / referral campaign tracking (nullable)
  adminNotes: text("admin_notes"),     // Private admin notes (deal info, outreach status, etc.)
  // Referral program
  referralCode: text("referral_code"),                                        // unique 8-char code, generated on signup
  referredByCode: text("referred_by_code"),                                   // code of who referred this user
  referralRewardClaimed: boolean("referral_reward_claimed").notNull().default(false), // one-time reward flag
  signupIp: text("signup_ip"),                                                // IP at signup — used for abuse detection
  // Free AI receipt scan quota (everyone gets 3 free successful scans before paywall)
  // Counter is decremented server-side only on a successful parse. Paid users (isPremium=true)
  // bypass this entirely. See server/premium-access.ts for the canUseAIScan() helper.
  freeAiScansUsed: integer("free_ai_scans_used").notNull().default(0),
  freeAiScansGranted: integer("free_ai_scans_granted").notNull().default(3),  // per-user override knob for support
  // Email normalization for abuse detection (Gmail dots/+aliases stripped, lowercased).
  // Set on signup; used to detect "same person, different alias" account recycling.
  normalizedEmail: text("normalized_email"),
}, (table) => [
  uniqueIndex("users_email_idx").on(table.email),
  uniqueIndex("users_referral_code_idx").on(table.referralCode),
  index("users_normalized_email_idx").on(table.normalizedEmail),
]);

// Device-level free AI scan quota — prevents the "make a new account on my phone" scam.
// One row per device. scansUsed is capped at 3 (or whatever freeAiScansGranted is on
// the user — we use min of user.granted and device cap). deviceId is IDFV on iOS, a
// stable random UUID stored in localStorage on web (best-effort, web users can clear it).
export const deviceScanQuota = pgTable("device_scan_quota", {
  deviceId: text("device_id").primaryKey(),
  scansUsed: integer("scans_used").notNull().default(0),
  firstScanAt: text("first_scan_at").notNull(),
  lastScanAt: text("last_scan_at").notNull(),
  // Platform tag — useful for analytics ("how many ios devices hit cap")
  platform: text("platform"), // "ios" | "android" | "web"
});

export type DeviceScanQuota = typeof deviceScanQuota.$inferSelect;

// AI scan audit log — every attempt (success or failure) is recorded. Used for:
// 1. Forensic abuse detection (find clusters by normalized_email/device_id/ip)
// 2. Analytics (success rate, parser errors)
// 3. Support ("did my scan really count against my free 3?")
export const aiScanAudit = pgTable("ai_scan_audit", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  normalizedEmail: text("normalized_email"),
  deviceId: text("device_id"),
  ip: text("ip"),
  scannedAt: text("scanned_at").notNull(),
  success: boolean("success").notNull(),         // did parseReceipt return a valid receipt?
  countedAgainstFree: boolean("counted_against_free").notNull().default(false), // true = decremented counter
  parseError: text("parse_error"),               // null if success
}, (table) => [
  index("ai_scan_audit_user_id_idx").on(table.userId),
  index("ai_scan_audit_device_id_idx").on(table.deviceId),
  index("ai_scan_audit_normalized_email_idx").on(table.normalizedEmail),
  index("ai_scan_audit_scanned_at_idx").on(table.scannedAt),
]);

export type AiScanAudit = typeof aiScanAudit.$inferSelect;
export type InsertAiScanAudit = typeof aiScanAudit.$inferInsert;

// ── Plaid (Money tab) ─────────────────────────────────────────────────────
// One row per bank-connection ("item" in Plaid's vocabulary). access_token
// is the long-lived credential that lets us read this user's bank data —
// TODO when going to Production: encrypt at rest via a PLAID_TOKEN_KEY env
// var. For Sandbox it's fake test data; Neon disk encryption is the floor.
export const plaidItems = pgTable("plaid_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  plaidItemId: text("plaid_item_id").notNull(),       // Plaid's unique item ID
  accessToken: text("access_token").notNull(),         // long-lived; KEEP SECRET
  institutionId: text("institution_id"),               // e.g. "ins_109508"
  institutionName: text("institution_name"),           // e.g. "Chase"
  status: text("status").notNull().default("active"),  // "active" | "error" | "disconnected"
  // Sync cursor for /transactions/sync (used when we wire the feed later)
  cursor: text("cursor"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("plaid_items_user_id_idx").on(table.userId),
  uniqueIndex("plaid_items_plaid_item_id_idx").on(table.plaidItemId),
]);

export type PlaidItem = typeof plaidItems.$inferSelect;
export type InsertPlaidItem = typeof plaidItems.$inferInsert;

// One row per account WITHIN an item (a single bank can expose multiple
// accounts — chequing + savings + credit card all in one connection).
export const plaidAccounts = pgTable("plaid_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  itemId: varchar("item_id").notNull(),                // fk → plaid_items.id
  plaidAccountId: text("plaid_account_id").notNull(),  // Plaid's account ID (stable)
  name: text("name").notNull(),                        // display name from Plaid
  officialName: text("official_name"),                 // longer bank-provided name
  mask: text("mask"),                                  // last 4 digits (or null)
  type: text("type").notNull(),                        // "depository" | "credit" | "loan" | "investment" | "brokerage" | "other"
  subtype: text("subtype"),                            // "checking" | "savings" | "credit card" | ...
  currentBalance: real("current_balance"),
  availableBalance: real("available_balance"),
  isoCurrencyCode: text("iso_currency_code"),          // "CAD" | "USD" | ...
  lastSyncedAt: text("last_synced_at").notNull(),
}, (table) => [
  index("plaid_accounts_item_id_idx").on(table.itemId),
  uniqueIndex("plaid_accounts_plaid_account_id_idx").on(table.plaidAccountId),
]);

export type PlaidAccount = typeof plaidAccounts.$inferSelect;
export type InsertPlaidAccount = typeof plaidAccounts.$inferInsert;

// ── AI Mode (conversational expense entry) ───────────────────────────────
// Each conversation belongs to one user. Messages are append-only — the
// "transcript" of one chat session. A conversation can have multiple turns
// (Claude responses can propose expenses, ask clarifications, or just chat).
//
// proposal column on ai_messages: when Claude calls the propose_expense
// tool, we serialize the structured proposal here so the client can render
// a confirmation card. Stays unset for chitchat / clarification turns.
export const aiConversations = pgTable("ai_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  title: text("title"),                              // first 60 chars of the user's first message
  status: text("status").notNull().default("active"), // "active" | "archived"
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("ai_conversations_user_id_idx").on(table.userId),
  index("ai_conversations_updated_at_idx").on(table.updatedAt),
]);

export type AiConversation = typeof aiConversations.$inferSelect;
export type InsertAiConversation = typeof aiConversations.$inferInsert;

export const aiMessages = pgTable("ai_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull(),
  role: text("role").notNull(),       // "user" | "assistant"
  content: text("content"),            // markdown / plain text body
  // toolCalls / proposal / attachments stored as JSON strings (Postgres jsonb
  // would be cleaner but text JSON works with our existing Drizzle setup and
  // we already use this pattern in other places).
  toolCalls: text("tool_calls"),       // JSON: claude's tool_use blocks
  proposal: text("proposal"),          // JSON: ExpenseProposal | MultiExpenseProposal | null
  attachments: text("attachments"),    // JSON: { receiptImageRef?, ... }
  // attachmentContext: verbatim text transcription of any attached receipts
  // on this turn. Written ONCE when the user uploads files (parse-and-discard
  // policy means the bytes are gone; this text is the only durable trace).
  // Replayed in every future Claude turn so the AI always has the receipt
  // content available even though the file itself is long gone.
  attachmentContext: text("attachment_context"),
  // Tracks whether this message's proposal was confirmed by the user. Once
  // confirmed, we don't allow re-confirming (idempotent — same pattern as
  // the ai_scan_audit countedAgainstFree flag).
  confirmedAt: text("confirmed_at"),   // ISO timestamp or null
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("ai_messages_conversation_id_idx").on(table.conversationId),
  index("ai_messages_created_at_idx").on(table.createdAt),
]);

export type AiMessage = typeof aiMessages.$inferSelect;
export type InsertAiMessage = typeof aiMessages.$inferInsert;

// AI Mode usage tracking — per-user-per-day counters for quota enforcement
// + abuse observability. Written on every successful AI turn. The estimated
// cost is OUR estimate (not Anthropic's actual billed amount); it's good
// enough for "is this user burning too much" type alerts.
export const aiUsageDaily = pgTable("ai_usage_daily", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  usageDate: text("usage_date").notNull(),       // YYYY-MM-DD UTC
  textTurns: integer("text_turns").notNull().default(0),
  attachmentTurns: integer("attachment_turns").notNull().default(0),
  imageAttachments: integer("image_attachments").notNull().default(0),   // expensive vision calls
  pdfAttachments: integer("pdf_attachments").notNull().default(0),
  estimatedCostCents: integer("estimated_cost_cents").notNull().default(0),
}, (table) => [
  uniqueIndex("ai_usage_daily_user_date_unique").on(table.userId, table.usageDate),
  index("ai_usage_daily_date_idx").on(table.usageDate),
]);

export type AiUsageDaily = typeof aiUsageDaily.$inferSelect;
export type InsertAiUsageDaily = typeof aiUsageDaily.$inferInsert;

// Tracks which days we've already fired the "global spend threshold crossed"
// alert email. Prevents flooding the admin inbox — at most one alert per
// day per threshold. Cleared automatically when the date rolls over.
export const aiAlertsSent = pgTable("ai_alerts_sent", {
  alertDate: text("alert_date").notNull(),       // YYYY-MM-DD UTC
  alertKind: text("alert_kind").notNull(),       // "spend_warning" | "spend_kill"
  sentAt: text("sent_at").notNull(),
}, (table) => [
  index("ai_alerts_sent_date_kind_idx").on(table.alertDate, table.alertKind),
]);

// OTP codes for email verification
export const otpCodes = pgTable("otp_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  code: text("code").notNull(),
  expiresAt: text("expires_at").notNull(),
  used: boolean("used").notNull().default(false),
});

// Password reset tokens
export const resetTokens = pgTable("reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  token: text("token").notNull(),
  expiresAt: text("expires_at").notNull(),
  used: boolean("used").notNull().default(false),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Safe user type (no password)
export type SafeUser = Omit<User, "password">;

// Friends (bidirectional friendship links)
export const friends = pgTable("friends", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  friendId: varchar("friend_id").notNull(),
}, (table) => [
  index("friends_user_id_idx").on(table.userId),
  index("friends_friend_id_idx").on(table.friendId),
]);

export const insertFriendSchema = createInsertSchema(friends).omit({ id: true });
export type InsertFriend = z.infer<typeof insertFriendSchema>;
export type Friend = typeof friends.$inferSelect;

// Groups
export const groups = pgTable("groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  createdById: varchar("created_by_id").notNull(),
  memberIds: text("member_ids").array().notNull(), // array of user IDs
  adminIds: text("admin_ids").array().notNull().default(sql`'{}'`), // array of admin user IDs
  deletedAt: text("deleted_at").default(sql`NULL`),
  simplifyDebts: boolean("simplify_debts").notNull().default(false),
}, (table) => [
  index("groups_created_by_idx").on(table.createdById),
  index("groups_deleted_at_idx").on(table.deletedAt),
]);

export const insertGroupSchema = createInsertSchema(groups).omit({ id: true });
export type InsertGroup = z.infer<typeof insertGroupSchema>;
export type Group = typeof groups.$inferSelect;

// Expenses
export const expenses = pgTable("expenses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  description: text("description").notNull(),
  amount: real("amount").notNull(),
  paidById: varchar("paid_by_id").notNull(),
  splitAmongIds: text("split_among_ids").array().notNull(),
  groupId: varchar("group_id"), // null = direct between friends
  date: text("date").notNull(),
  addedById: varchar("added_by_id").notNull(), // who added this expense
  isSettlement: boolean("is_settlement").notNull().default(false), // settle up entry
  deletedAt: text("deleted_at").default(sql`NULL`),
  receiptData: text("receipt_data"), // JSON string from AI receipt scanner, nullable
  splitAmounts: text("split_amounts"), // JSON: {"userId": amount, ...} for unequal splits. Null = equal division.
  notes: text("notes"), // optional note/comment added by the person creating the expense
  // Currency support (premium) — amount is ALWAYS stored in CAD; these columns are metadata only
  currency: text("currency"),         // null / "CAD" = no conversion; "USD" | "EUR" | etc. = original currency
  originalAmount: real("original_amount"), // amount as entered by user in the foreign currency
}, (table) => [
  index("expenses_group_id_idx").on(table.groupId),
  index("expenses_paid_by_idx").on(table.paidById),
  index("expenses_added_by_idx").on(table.addedById),
  index("expenses_deleted_at_idx").on(table.deletedAt),
]);

export const insertExpenseSchema = createInsertSchema(expenses).omit({ id: true });
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expenses.$inferSelect;

// Activity Log — tracks who did what in a group (expense added/deleted, settled up, etc.)
export const activityLog = pgTable("activity_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  groupId: varchar("group_id"), // null = direct friend expense
  userId: varchar("user_id").notNull(),
  userName: text("user_name").notNull(), // cached — avoids a join on every read
  action: text("action").notNull(), // 'expense_added' | 'expense_deleted' | 'settled_up' | 'member_joined'
  description: text("description").notNull(), // human-readable: "added Grocery run · $45.00"
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("activity_log_group_id_idx").on(table.groupId),
  index("activity_log_created_at_idx").on(table.createdAt),
]);

export type ActivityLog = typeof activityLog.$inferSelect;
export type InsertActivityLog = typeof activityLog.$inferInsert;

// Group Invites
export const groupInvites = pgTable("group_invites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  groupId: varchar("group_id").notNull(),
  inviterId: varchar("inviter_id").notNull(),
  inviteeId: varchar("invitee_id").notNull(),
  adminApproved: boolean("admin_approved").notNull().default(false),
  adminApprovedBy: varchar("admin_approved_by"),
  inviteeAccepted: boolean("invitee_accepted"),
  status: varchar("status").notNull().default("pending"), // pending, completed, rejected
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("group_invites_group_id_idx").on(table.groupId),
  index("group_invites_invitee_id_idx").on(table.inviteeId),
  index("group_invites_status_idx").on(table.status),
]);

export const insertGroupInviteSchema = createInsertSchema(groupInvites).omit({ id: true });
export type InsertGroupInvite = z.infer<typeof insertGroupInviteSchema>;
export type GroupInvite = typeof groupInvites.$inferSelect;

// Group Invite Links — shareable links for joining groups (V1: open-join, any member can generate)
// Behavior: when a new link is generated, the previous active link for that group is auto-revoked.
// Default expiry: 7 days. Admin can revoke at any time. Members join instantly via link.
export const groupInviteLinks = pgTable("group_invite_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  groupId: varchar("group_id").notNull(),
  code: text("code").notNull(),                       // 8-char unique random code (URL-safe)
  createdById: varchar("created_by_id").notNull(),    // who generated the link
  createdAt: text("created_at").notNull(),            // ISO timestamp
  expiresAt: text("expires_at").notNull(),            // ISO timestamp — default createdAt + 7 days
  maxUses: integer("max_uses"),                       // null = unlimited (forward-compat for V2)
  currentUses: integer("current_uses").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true), // false = revoked or superseded
}, (table) => [
  uniqueIndex("group_invite_links_code_idx").on(table.code),
  index("group_invite_links_group_id_idx").on(table.groupId),
  index("group_invite_links_active_idx").on(table.groupId, table.isActive),
]);

export const insertGroupInviteLinkSchema = createInsertSchema(groupInviteLinks).omit({ id: true });
export type InsertGroupInviteLink = z.infer<typeof insertGroupInviteLinkSchema>;
export type GroupInviteLink = typeof groupInviteLinks.$inferSelect;

// Recurring Expenses (premium feature — auto-create on a schedule)
export const recurringExpenses = pgTable("recurring_expenses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),       // who owns this template
  description: text("description").notNull(),
  amount: real("amount").notNull(),
  paidById: varchar("paid_by_id").notNull(),
  splitAmongIds: text("split_among_ids").array().notNull(),
  groupId: varchar("group_id"),               // null = direct friend expense
  frequency: text("frequency").notNull(),     // "monthly" | "weekly"
  nextRunDate: text("next_run_date").notNull(), // YYYY-MM-DD — when to fire next
  createdAt: text("created_at").notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

export type RecurringExpense = typeof recurringExpenses.$inferSelect;
export type InsertRecurringExpense = typeof recurringExpenses.$inferInsert;

// Sent Reminders — tracks the last auto-reminder sent between two users
// One row per (fromUserId, toUserId) pair — upserted on each send
export const sentReminders = pgTable("sent_reminders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fromUserId: varchar("from_user_id").notNull(),  // premium user who owns the reminder setting
  toUserId: varchar("to_user_id").notNull(),       // person who owes money
  sentAt: text("sent_at").notNull(),               // ISO timestamp of last send
}, (table) => [
  uniqueIndex("sent_reminders_pair_idx").on(table.fromUserId, table.toUserId),
]);

export type SentReminder = typeof sentReminders.$inferSelect;

// Referral Clicks — deferred deep link attribution (custom fingerprinting, no 3rd party)
// Recorded when a referral link is clicked on web; matched when app opens for first time.
export const referralClicks = pgTable("referral_clicks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  referralCode: text("referral_code").notNull(),     // the ?ref=CODE that was in the link
  ipHash: text("ip_hash").notNull(),                 // SHA-256(IP) — never store raw IPs
  userAgentOs: text("user_agent_os"),                // e.g. "iPhone OS 17_4" — browser-agnostic
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),           // createdAt + 48h
  claimed: boolean("claimed").notNull().default(false), // true once matched by native app
}, (table) => [
  index("referral_clicks_ip_hash_idx").on(table.ipHash),
  index("referral_clicks_expires_idx").on(table.expiresAt),
]);

export type ReferralClick = typeof referralClicks.$inferSelect;

// Device Tokens — for iOS push notifications via APNs.
// One row per (token) — token is globally unique. userId is a foreign key to users.
// On token refresh, the same token can be re-associated with a different user
// (rare, but possible if the device is shared). On logout, we DELETE the token.
// On APNs returning Unregistered/BadDeviceToken, we DELETE the token (auto-cleanup).
export const deviceTokens = pgTable("device_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  token: text("token").notNull(),                                       // APNs hex token
  platform: text("platform").notNull(),                                 // "ios" (Android added in v2)
  bundleId: text("bundle_id").notNull(),                                // "ca.klarityit.spliiit"
  environment: text("environment").notNull().default("production"),     // "production" | "sandbox"
  appVersion: text("app_version"),                                      // optional, e.g. "1.2.0"
  createdAt: text("created_at").notNull().default(sql`now()`),
  lastUsedAt: text("last_used_at").notNull().default(sql`now()`),
}, (table) => [
  uniqueIndex("device_tokens_token_idx").on(table.token),
  index("device_tokens_user_id_idx").on(table.userId),
]);

export const insertDeviceTokenSchema = createInsertSchema(deviceTokens).omit({ id: true, createdAt: true, lastUsedAt: true });
export type InsertDeviceToken = z.infer<typeof insertDeviceTokenSchema>;
export type DeviceToken = typeof deviceTokens.$inferSelect;

// Signup/Login schemas (for validation)
export const signupSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
  email: z.string().email("Invalid email").max(255, "Email too long"),
  password: z.string().min(10, "Password must be at least 10 characters").max(128, "Password too long"),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(1, "Password is required"),
});

export const verifyOtpSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6, "Code must be 6 digits"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(10, "Password must be at least 10 characters").max(128, "Password too long"),
});
