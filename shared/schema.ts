import { pgTable, text, varchar, real, boolean, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

// Users (registered accounts)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").notNull(), // mandatory, unique identity
  password: text("password").notNull(), // hashed
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
}, (table) => [
  uniqueIndex("users_email_idx").on(table.email),
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
}, (table) => [
  index("expenses_group_id_idx").on(table.groupId),
  index("expenses_paid_by_idx").on(table.paidById),
  index("expenses_added_by_idx").on(table.addedById),
  index("expenses_deleted_at_idx").on(table.deletedAt),
]);

export const insertExpenseSchema = createInsertSchema(expenses).omit({ id: true });
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expenses.$inferSelect;

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
