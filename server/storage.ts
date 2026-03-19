import { eq, and, or, ilike, inArray, ne } from "drizzle-orm";
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
  getAllUsers(): Promise<SafeUser[]>;
  updateUser(id: string, data: Partial<Pick<User, "isAdmin" | "isApproved" | "name">>): Promise<User | undefined>;
  deleteUser(id: string): Promise<boolean>;

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
  getExpense(id: string): Promise<Expense | undefined>;
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
        ne(users.id, excludeId)
      )
    );
    return result.map(toSafeUser);
  }

  async getAllUsers(): Promise<SafeUser[]> {
    const result = await db.select().from(users);
    return result.map(toSafeUser);
  }

  async updateUser(id: string, data: Partial<Pick<User, "isAdmin" | "isApproved" | "name">>): Promise<User | undefined> {
    const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return updated;
  }

  async deleteUser(id: string): Promise<boolean> {
    // Remove user from friends
    await db.delete(friends).where(or(eq(friends.userId, id), eq(friends.friendId, id)));
    // Remove user from group memberIds would be complex; just delete the user
    const result = await db.delete(users).where(eq(users.id, id)).returning();
    return result.length > 0;
  }

  // Friends
  async getFriends(userId: string): Promise<SafeUser[]> {
    const links = await db.select().from(friends).where(
      or(eq(friends.userId, userId), eq(friends.friendId, userId))
    );
    const friendIds = links.map(l => l.userId === userId ? l.friendId : l.userId);
    if (friendIds.length === 0) return [];
    return this.getUsersSafe(friendIds);
  }

  async addFriend(userId: string, friendId: string): Promise<void> {
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
    await db.delete(expenses).where(eq(expenses.groupId, id));
    const result = await db.delete(groups).where(eq(groups.id, id)).returning();
    return result.length > 0;
  }

  // Expenses
  async getExpense(id: string): Promise<Expense | undefined> {
    const [expense] = await db.select().from(expenses).where(eq(expenses.id, id));
    return expense;
  }

  async getExpensesByGroup(groupId: string): Promise<Expense[]> {
    return db.select().from(expenses).where(eq(expenses.groupId, groupId));
  }

  async getExpensesForUser(userId: string): Promise<Expense[]> {
    const userGroups = await this.getGroupsForUser(userId);
    const groupIds = userGroups.map(g => g.id);

    const allExpenses = await db.select().from(expenses);
    return allExpenses.filter(e => {
      if (e.groupId && groupIds.includes(e.groupId)) return true;
      if (!e.groupId && (e.paidById === userId || e.splitAmongIds.includes(userId))) return true;
      return false;
    });
  }

  async getDirectExpensesForUser(userId: string): Promise<Expense[]> {
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
