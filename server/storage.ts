import { eq, and, or, ilike, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  users, friends, groups, expenses,
  type User, type InsertUser, type SafeUser,
  type Friend, type InsertFriend,
  type Group, type InsertGroup,
  type Expense, type InsertExpense,
} from "@shared/schema";

function toSafeUser(user: User): SafeUser {
  const { password, ...safe } = user;
  return safe;
}

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getUsersSafe(ids: string[]): Promise<SafeUser[]>;
  searchUsersByEmail(email: string, excludeId: string): Promise<SafeUser[]>;

  // Friends
  getFriends(userId: string): Promise<SafeUser[]>;
  addFriend(userId: string, friendId: string): Promise<void>;
  removeFriend(userId: string, friendId: string): Promise<void>;
  areFriends(userId: string, friendId: string): Promise<boolean>;

  // Groups
  getGroupsForUser(userId: string): Promise<Group[]>;
  getGroup(id: string): Promise<Group | undefined>;
  createGroup(group: InsertGroup): Promise<Group>;
  updateGroupMembers(id: string, memberIds: string[]): Promise<Group | undefined>;
  deleteGroup(id: string): Promise<boolean>;

  // Expenses
  getExpensesByGroup(groupId: string): Promise<Expense[]>;
  getExpensesForUser(userId: string): Promise<Expense[]>;
  getDirectExpensesForUser(userId: string): Promise<Expense[]>;
  createExpense(expense: InsertExpense): Promise<Expense>;
  deleteExpense(id: string): Promise<boolean>;
}

export class PgStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getUsersSafe(ids: string[]): Promise<SafeUser[]> {
    if (ids.length === 0) return [];
    const result = await db.select().from(users).where(inArray(users.id, ids));
    return result.map(toSafeUser);
  }

  async searchUsersByEmail(email: string, excludeId: string): Promise<SafeUser[]> {
    const result = await db.select().from(users).where(
      and(
        ilike(users.email, `%${email}%`),
        eq(users.id, excludeId) ? undefined : undefined
      )
    );
    // Filter out excludeId in JS since drizzle "not eq" syntax varies
    return result.filter(u => u.id !== excludeId).map(toSafeUser);
  }

  // Friends
  async getFriends(userId: string): Promise<SafeUser[]> {
    // Get all friend links where user is either side
    const links = await db.select().from(friends).where(
      or(eq(friends.userId, userId), eq(friends.friendId, userId))
    );
    const friendIds = links.map(l => l.userId === userId ? l.friendId : l.userId);
    if (friendIds.length === 0) return [];
    return this.getUsersSafe(friendIds);
  }

  async addFriend(userId: string, friendId: string): Promise<void> {
    // Add bidirectional link (just one row, we query both directions)
    const existing = await this.areFriends(userId, friendId);
    if (existing) return;
    await db.insert(friends).values({ userId, friendId });
  }

  async removeFriend(userId: string, friendId: string): Promise<void> {
    await db.delete(friends).where(
      or(
        and(eq(friends.userId, userId), eq(friends.friendId, friendId)),
        and(eq(friends.userId, friendId), eq(friends.friendId, userId))
      )
    );
  }

  async areFriends(userId: string, friendId: string): Promise<boolean> {
    const [link] = await db.select().from(friends).where(
      or(
        and(eq(friends.userId, userId), eq(friends.friendId, friendId)),
        and(eq(friends.userId, friendId), eq(friends.friendId, userId))
      )
    );
    return !!link;
  }

  // Groups
  async getGroupsForUser(userId: string): Promise<Group[]> {
    const allGroups = await db.select().from(groups);
    return allGroups.filter(g => g.memberIds.includes(userId));
  }

  async getGroup(id: string): Promise<Group | undefined> {
    const [group] = await db.select().from(groups).where(eq(groups.id, id));
    return group;
  }

  async createGroup(insertGroup: InsertGroup): Promise<Group> {
    const [group] = await db.insert(groups).values(insertGroup).returning();
    return group;
  }

  async updateGroupMembers(id: string, memberIds: string[]): Promise<Group | undefined> {
    const [updated] = await db.update(groups)
      .set({ memberIds })
      .where(eq(groups.id, id))
      .returning();
    return updated;
  }

  async deleteGroup(id: string): Promise<boolean> {
    // Delete expenses in this group first
    await db.delete(expenses).where(eq(expenses.groupId, id));
    const result = await db.delete(groups).where(eq(groups.id, id)).returning();
    return result.length > 0;
  }

  // Expenses
  async getExpensesByGroup(groupId: string): Promise<Expense[]> {
    return db.select().from(expenses).where(eq(expenses.groupId, groupId));
  }

  async getExpensesForUser(userId: string): Promise<Expense[]> {
    // Get all expenses from groups the user belongs to + direct expenses
    const userGroups = await this.getGroupsForUser(userId);
    const groupIds = userGroups.map(g => g.id);

    const allExpenses = await db.select().from(expenses);
    return allExpenses.filter(e => {
      if (e.groupId && groupIds.includes(e.groupId)) return true;
      // Direct expense: user is payer or in split
      if (!e.groupId && (e.paidById === userId || e.splitAmongIds.includes(userId))) return true;
      return false;
    });
  }

  async getDirectExpensesForUser(userId: string): Promise<Expense[]> {
    // Direct (non-group) expenses involving this user
    const allDirect = await db.select().from(expenses).where(
      eq(expenses.groupId, null as any) // null groupId = direct
    );
    // The above won't work well. Let's get all and filter.
    const all = await db.select().from(expenses);
    return all.filter(e =>
      !e.groupId && (e.paidById === userId || e.splitAmongIds.includes(userId))
    );
  }

  async createExpense(insertExpense: InsertExpense): Promise<Expense> {
    const [expense] = await db.insert(expenses).values(insertExpense).returning();
    return expense;
  }

  async deleteExpense(id: string): Promise<boolean> {
    const result = await db.delete(expenses).where(eq(expenses.id, id)).returning();
    return result.length > 0;
  }
}

export const storage = new PgStorage();
