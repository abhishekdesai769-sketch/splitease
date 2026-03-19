import { pgTable, text, varchar, integer, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

// People (friends you can split with)
export const people = pgTable("people", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email"),
  avatarColor: text("avatar_color").notNull(), // hex color for avatar
});

export const insertPersonSchema = createInsertSchema(people).omit({ id: true });
export type InsertPerson = z.infer<typeof insertPersonSchema>;
export type Person = typeof people.$inferSelect;

// Groups
export const groups = pgTable("groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  memberIds: text("member_ids").array().notNull(), // array of person IDs
});

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
  receiptUrl: text("receipt_url"), // base64 data URL for receipt
  date: text("date").notNull(), // ISO date string
});

export const insertExpenseSchema = createInsertSchema(expenses).omit({ id: true });
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expenses.$inferSelect;
