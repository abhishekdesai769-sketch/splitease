import { eq, and, or, ilike, inArray, ne, isNull, isNotNull, lt } from "drizzle-orm";
import { db } from "./db";
import {
  users, friends, groups, expenses, otpCodes, resetTokens, groupInvites, recurringExpenses, sentReminders, activityLog,
  type User, type InsertUser, type SafeUser,
  type Friend, type InsertFriend,
  type Group, type InsertGroup,
  type Expense, type InsertExpense,
  type GroupInvite, type InsertGroupInvite,
  type RecurringExpense, type InsertRecurringExpense,
  type SentReminder,
  type ActivityLog,
} from "@shared/schema";

function toSafeUser(user: User): SafeUser {
  const { password, ...safe } = user;
  return safe;
}

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  linkGoogleId(userId: string, googleId: string): Promise<void>;
  getUserByAppleId(appleId: string): Promise<User | undefined>;
  linkAppleId(userId: string, appleId: string): Promise<void>;
  createUser(user: InsertUser): Promise<User>;
  getUsersSafe(ids: string[]): Promise<SafeUser[]>;
  searchUsersByEmail(email: string, excludeId: string): Promise<SafeUser[]>;
  getAllUsers(): Promise<SafeUser[]>;
  updateUser(id: string, data: Partial<Pick<User, "isAdmin" | "isApproved" | "name">>): Promise<User | undefined>;
  updateUserPassword(id: string, hashedPassword: string): Promise<void>;
  updateUserSubscription(id: string, data: { isPremium: boolean; stripeCustomerId?: string; stripeSubscriptionId?: string | null; premiumUntil?: string | null }): Promise<User | undefined>;
  getUserByStripeCustomerId(stripeCustomerId: string): Promise<User | undefined>;
  deleteUser(id: string): Promise<boolean>;

  // OTP
  createOtp(data: { email: string; code: string; expiresAt: string }): Promise<void>;
  verifyOtp(email: string, code: string): Promise<boolean>;

  // Reset tokens
  createResetToken(data: { userId: string; token: string; expiresAt: string }): Promise<void>;
  verifyResetToken(token: string): Promise<{ userId: string } | null>;

  // Friends
  getFriends(userId: string): Promise<SafeUser[]>;
  addFriend(userId: string, friendId: string): Promise<void>;
  removeFriend(userId: string, friendId: string): Promise<void>;
  areFriends(userId: string, friendId: string): Promise<boolean>;

  // Groups
  getGroupsForUser(userId: string): Promise<Group[]>;
  getGroup(id: string): Promise<Group | undefined>;
  getGroupIncludeDeleted(id: string): Promise<Group | undefined>;
  createGroup(group: InsertGroup): Promise<Group>;
  updateGroupMembers(id: string, memberIds: string[]): Promise<Group | undefined>;
  updateGroupAdmins(id: string, adminIds: string[]): Promise<Group | undefined>;
  updateGroupMembersAndAdmins(id: string, memberIds: string[], adminIds: string[]): Promise<Group | undefined>;
  updateGroupName(id: string, name: string): Promise<Group | undefined>;
  updateGroupSimplifyDebts(id: string, simplifyDebts: boolean): Promise<Group | undefined>;
  deleteGroup(id: string): Promise<boolean>;
  getDeletedGroups(): Promise<Group[]>;
  restoreGroup(id: string): Promise<Group | undefined>;

  // Expenses
  getExpense(id: string): Promise<Expense | undefined>;
  getExpensesByGroup(groupId: string): Promise<Expense[]>;
  getExpensesForUser(userId: string): Promise<Expense[]>;
  getDirectExpensesForUser(userId: string): Promise<Expense[]>;
  createExpense(expense: InsertExpense): Promise<Expense>;
  deleteExpense(id: string): Promise<boolean>;
  getDeletedExpenses(): Promise<Expense[]>;
  restoreExpense(id: string): Promise<Expense | undefined>;
  updateExpenseReceiptData(id: string, receiptData: string): Promise<void>;

  // Activity Log
  createActivity(data: { groupId?: string | null; userId: string; userName: string; action: string; description: string }): Promise<void>;
  getGroupActivity(groupId: string, limit?: number): Promise<ActivityLog[]>;

  // Group Invites
  createGroupInvite(invite: InsertGroupInvite): Promise<GroupInvite>;
  getGroupInvite(id: string): Promise<GroupInvite | undefined>;
  getPendingInvitesForGroup(groupId: string): Promise<GroupInvite[]>;
  getPendingInvitesForUser(userId: string): Promise<GroupInvite[]>;
  updateGroupInvite(id: string, data: Partial<GroupInvite>): Promise<GroupInvite | undefined>;

  // Ghost users
  createGhostUser(name: string): Promise<User>;
  mergeGhostUser(ghostId: string, realUserId: string): Promise<void>;
  upgradeGhostUser(ghostId: string, data: { name: string; password: string; isAdmin: boolean; isEmailVerified: boolean }): Promise<void>;
  updateUserEmail(id: string, email: string): Promise<User | undefined>;
  getGhostsByEmail(email: string): Promise<User[]>;

  // Purge
  purgeExpiredDeleted(daysOld: number): Promise<{ groups: number; expenses: number }>;

  // Recurring expenses (premium)
  createRecurringExpense(data: InsertRecurringExpense): Promise<RecurringExpense>;
  getRecurringExpensesForUser(userId: string): Promise<RecurringExpense[]>;
  getAllDueRecurringExpenses(asOfDate: string): Promise<RecurringExpense[]>;
  updateRecurringExpenseNextRun(id: string, nextRunDate: string): Promise<void>;
  deactivateRecurringExpense(id: string): Promise<boolean>;

  // Auto-reminder settings (premium)
  updateReminderSettings(userId: string, data: { reminderEnabled: boolean; reminderDays: number; reminderTone: string }): Promise<void>;
  getPremiumUsersWithRemindersEnabled(): Promise<User[]>;
  getLastReminderSent(fromUserId: string, toUserId: string): Promise<SentReminder | undefined>;
  upsertSentReminder(fromUserId: string, toUserId: string, sentAt: string): Promise<void>;
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

  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.googleId, googleId));
    return user;
  }

  async linkGoogleId(userId: string, googleId: string): Promise<void> {
    await db.update(users).set({ googleId }).where(eq(users.id, userId));
  }

  async getUserByAppleId(appleId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.appleId, appleId));
    return user;
  }

  async linkAppleId(userId: string, appleId: string): Promise<void> {
    await db.update(users).set({ appleId }).where(eq(users.id, userId));
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
        ne(users.id, excludeId),
        eq(users.isGhost, false)
      )
    );
    return result.map(toSafeUser);
  }

  async getAllUsers(): Promise<SafeUser[]> {
    const result = await db.select().from(users).where(eq(users.isGhost, false));
    return result.map(toSafeUser);
  }

  async updateUser(id: string, data: Partial<Pick<User, "isAdmin" | "isApproved" | "name">>): Promise<User | undefined> {
    const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return updated;
  }

  async updateUserPassword(id: string, hashedPassword: string): Promise<void> {
    await db.update(users).set({ password: hashedPassword }).where(eq(users.id, id));
  }

  async updateUserSubscription(id: string, data: { isPremium: boolean; stripeCustomerId?: string; stripeSubscriptionId?: string | null; premiumUntil?: string | null }): Promise<User | undefined> {
    const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return updated;
  }

  async getUserByStripeCustomerId(stripeCustomerId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.stripeCustomerId, stripeCustomerId));
    return user;
  }

  async deleteUser(id: string): Promise<boolean> {
    // 1. Delete OTP codes and reset tokens
    const user = await this.getUser(id);
    if (!user) return false;
    await db.delete(otpCodes).where(eq(otpCodes.email, user.email));
    await db.delete(resetTokens).where(eq(resetTokens.userId, id));

    // 2. Delete group invites (sent or received)
    await db.delete(groupInvites).where(or(eq(groupInvites.inviterId, id), eq(groupInvites.inviteeId, id)));

    // 3. Delete friends
    await db.delete(friends).where(or(eq(friends.userId, id), eq(friends.friendId, id)));

    // 4. Delete expenses the user created
    await db.delete(expenses).where(eq(expenses.addedById, id));

    // 5. Remove user from all groups (memberIds + adminIds arrays)
    const allGroups = await db.select().from(groups);
    for (const group of allGroups) {
      const isMember = group.memberIds.includes(id);
      const isAdmin = (group.adminIds || []).includes(id);
      if (!isMember && !isAdmin) continue;
      const newMembers = group.memberIds.filter(mid => mid !== id);
      const newAdmins = (group.adminIds || []).filter(aid => aid !== id);

      if (newMembers.length === 0) {
        // No members left — delete the group and its expenses
        await db.delete(expenses).where(eq(expenses.groupId, group.id));
        await db.delete(groups).where(eq(groups.id, group.id));
      } else {
        await db.update(groups).set({ memberIds: newMembers, adminIds: newAdmins }).where(eq(groups.id, group.id));
      }
    }

    // 6. Delete the user
    const result = await db.delete(users).where(eq(users.id, id)).returning();
    return result.length > 0;
  }

  // OTP
  async createOtp(data: { email: string; code: string; expiresAt: string }): Promise<void> {
    await db.insert(otpCodes).values(data);
  }

  async verifyOtp(email: string, code: string): Promise<boolean> {
    const [otp] = await db.select().from(otpCodes).where(
      and(
        eq(otpCodes.email, email.toLowerCase()),
        eq(otpCodes.code, code),
        eq(otpCodes.used, false)
      )
    );
    if (!otp) return false;
    if (new Date(otp.expiresAt) < new Date()) return false;
    // Mark as used
    await db.update(otpCodes).set({ used: true }).where(eq(otpCodes.id, otp.id));
    return true;
  }

  // Reset tokens
  async createResetToken(data: { userId: string; token: string; expiresAt: string }): Promise<void> {
    await db.insert(resetTokens).values(data);
  }

  async verifyResetToken(token: string): Promise<{ userId: string } | null> {
    const [rt] = await db.select().from(resetTokens).where(
      and(
        eq(resetTokens.token, token),
        eq(resetTokens.used, false)
      )
    );
    if (!rt) return null;
    if (new Date(rt.expiresAt) < new Date()) return null;
    // Mark as used
    await db.update(resetTokens).set({ used: true }).where(eq(resetTokens.id, rt.id));
    return { userId: rt.userId };
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
    const allGroups = await db.select().from(groups).where(isNull(groups.deletedAt));
    return allGroups.filter(g => g.memberIds.includes(userId));
  }

  async getGroup(id: string): Promise<Group | undefined> {
    const [group] = await db.select().from(groups).where(and(eq(groups.id, id), isNull(groups.deletedAt)));
    return group;
  }

  async getGroupIncludeDeleted(id: string): Promise<Group | undefined> {
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

  async updateGroupAdmins(id: string, adminIds: string[]): Promise<Group | undefined> {
    const [updated] = await db.update(groups)
      .set({ adminIds })
      .where(eq(groups.id, id))
      .returning();
    return updated;
  }

  async updateGroupMembersAndAdmins(id: string, memberIds: string[], adminIds: string[]): Promise<Group | undefined> {
    const [updated] = await db.update(groups)
      .set({ memberIds, adminIds })
      .where(eq(groups.id, id))
      .returning();
    return updated;
  }

  async updateGroupName(id: string, name: string): Promise<Group | undefined> {
    const [updated] = await db.update(groups).set({ name }).where(eq(groups.id, id)).returning();
    return updated;
  }

  async updateGroupSimplifyDebts(id: string, simplifyDebts: boolean): Promise<Group | undefined> {
    const [updated] = await db.update(groups).set({ simplifyDebts }).where(eq(groups.id, id)).returning();
    return updated;
  }

  async deleteGroup(id: string): Promise<boolean> {
    await db.update(expenses).set({ deletedAt: new Date().toISOString() }).where(and(eq(expenses.groupId, id), isNull(expenses.deletedAt)));
    const result = await db.update(groups).set({ deletedAt: new Date().toISOString() }).where(eq(groups.id, id)).returning();
    return result.length > 0;
  }

  async getDeletedGroups(): Promise<Group[]> {
    return db.select().from(groups).where(isNotNull(groups.deletedAt));
  }

  async restoreGroup(id: string): Promise<Group | undefined> {
    await db.update(expenses).set({ deletedAt: null }).where(eq(expenses.groupId, id));
    const [restored] = await db.update(groups).set({ deletedAt: null }).where(eq(groups.id, id)).returning();
    return restored;
  }

  // Expenses
  async getExpense(id: string): Promise<Expense | undefined> {
    const [expense] = await db.select().from(expenses).where(and(eq(expenses.id, id), isNull(expenses.deletedAt)));
    return expense;
  }

  async getExpensesByGroup(groupId: string): Promise<Expense[]> {
    return db.select().from(expenses).where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt)));
  }

  async getExpensesForUser(userId: string): Promise<Expense[]> {
    const userGroups = await this.getGroupsForUser(userId);
    const groupIds = userGroups.map(g => g.id);

    const allExpenses = await db.select().from(expenses).where(isNull(expenses.deletedAt));
    return allExpenses.filter(e => {
      if (e.groupId && groupIds.includes(e.groupId)) return true;
      if (!e.groupId && (e.paidById === userId || e.splitAmongIds.includes(userId))) return true;
      return false;
    });
  }

  async getDirectExpensesForUser(userId: string): Promise<Expense[]> {
    const all = await db.select().from(expenses).where(isNull(expenses.deletedAt));
    return all.filter(e =>
      !e.groupId && (e.paidById === userId || e.splitAmongIds.includes(userId))
    );
  }

  async createExpense(insertExpense: InsertExpense): Promise<Expense> {
    const [expense] = await db.insert(expenses).values(insertExpense).returning();
    return expense;
  }

  async deleteExpense(id: string): Promise<boolean> {
    const result = await db.update(expenses).set({ deletedAt: new Date().toISOString() }).where(eq(expenses.id, id)).returning();
    return result.length > 0;
  }

  async getDeletedExpenses(): Promise<Expense[]> {
    return db.select().from(expenses).where(isNotNull(expenses.deletedAt));
  }

  async restoreExpense(id: string): Promise<Expense | undefined> {
    const [restored] = await db.update(expenses).set({ deletedAt: null }).where(eq(expenses.id, id)).returning();
    return restored;
  }

  async updateExpenseReceiptData(id: string, receiptData: string): Promise<void> {
    await db.update(expenses).set({ receiptData }).where(eq(expenses.id, id));
  }

  // Activity Log
  async createActivity(data: { groupId?: string | null; userId: string; userName: string; action: string; description: string }): Promise<void> {
    await db.insert(activityLog).values({
      groupId: data.groupId || null,
      userId: data.userId,
      userName: data.userName,
      action: data.action,
      description: data.description,
      createdAt: new Date().toISOString(),
    });
  }

  async getGroupActivity(groupId: string, limit = 30): Promise<ActivityLog[]> {
    const { desc } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.groupId, groupId))
      .orderBy(desc(activityLog.createdAt))
      .limit(limit);
    return rows;
  }

  // Group Invites
  async createGroupInvite(invite: InsertGroupInvite): Promise<GroupInvite> {
    const [created] = await db.insert(groupInvites).values(invite).returning();
    return created;
  }

  async getGroupInvite(id: string): Promise<GroupInvite | undefined> {
    const [invite] = await db.select().from(groupInvites).where(eq(groupInvites.id, id));
    return invite;
  }

  async getPendingInvitesForGroup(groupId: string): Promise<GroupInvite[]> {
    return db.select().from(groupInvites).where(
      and(eq(groupInvites.groupId, groupId), eq(groupInvites.status, "pending"))
    );
  }

  async getPendingInvitesForUser(userId: string): Promise<GroupInvite[]> {
    return db.select().from(groupInvites).where(
      and(
        eq(groupInvites.inviteeId, userId),
        eq(groupInvites.status, "pending"),
        isNull(groupInvites.inviteeAccepted)
      )
    );
  }

  async updateGroupInvite(id: string, data: Partial<GroupInvite>): Promise<GroupInvite | undefined> {
    const [updated] = await db.update(groupInvites).set(data).where(eq(groupInvites.id, id)).returning();
    return updated;
  }

  // Purge: permanently delete soft-deleted items older than N days
  async purgeExpiredDeleted(daysOld: number): Promise<{ groups: number; expenses: number }> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);
    const cutoffStr = cutoff.toISOString();

    // Delete expired expenses first (including those in expired groups)
    const expiredExpenses = await db.delete(expenses)
      .where(and(isNotNull(expenses.deletedAt), lt(expenses.deletedAt, cutoffStr)))
      .returning();

    // Delete expired groups
    const expiredGroups = await db.delete(groups)
      .where(and(isNotNull(groups.deletedAt), lt(groups.deletedAt, cutoffStr)))
      .returning();

    return { groups: expiredGroups.length, expenses: expiredExpenses.length };
  }

  // Ghost users
  async createGhostUser(name: string): Promise<User> {
    const { randomBytes, scryptSync } = await import("crypto");
    const placeholderEmail = `ghost-${crypto.randomUUID()}@placeholder.spliiit`;
    const salt = randomBytes(16).toString("hex");
    const derived = scryptSync(randomBytes(32).toString("hex"), salt, 64).toString("hex");
    const placeholderPassword = `scrypt:${salt}:${derived}`;
    const AVATAR_COLORS = [
      "#0d9488", "#0891b2", "#7c3aed", "#db2777", "#ea580c",
      "#d97706", "#059669", "#4f46e5", "#be185d", "#2563eb",
    ];
    const [user] = await db.insert(users).values({
      name,
      email: placeholderEmail,
      password: placeholderPassword,
      avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
      isAdmin: false,
      isApproved: false,
      isEmailVerified: false,
      isGhost: true,
    }).returning();
    return user;
  }

  async mergeGhostUser(ghostId: string, realUserId: string): Promise<void> {
    const ghost = await this.getUser(ghostId);
    if (!ghost || !ghost.isGhost) throw new Error("Ghost user not found");
    const realUser = await this.getUser(realUserId);
    if (!realUser || realUser.isGhost) throw new Error("Real user not found");

    // 1. Update expenses.paidById
    await db.update(expenses).set({ paidById: realUserId }).where(eq(expenses.paidById, ghostId));

    // 2. Update expenses.addedById
    await db.update(expenses).set({ addedById: realUserId }).where(eq(expenses.addedById, ghostId));

    // 3. Update expenses.splitAmongIds AND splitAmounts — replace ghostId with realUserId
    const allExpenses = await db.select().from(expenses);
    for (const exp of allExpenses) {
      if (exp.splitAmongIds.includes(ghostId)) {
        const newIds = exp.splitAmongIds.map(id => id === ghostId ? realUserId : id);
        const deduped = [...new Set(newIds)];
        const updates: Record<string, any> = { splitAmongIds: deduped };

        // Also update splitAmounts JSON keys (e.g. {"ghostId": 15} → {"realUserId": 15})
        if (exp.splitAmounts) {
          try {
            const amounts = JSON.parse(exp.splitAmounts);
            if (ghostId in amounts) {
              const ghostAmount = amounts[ghostId];
              delete amounts[ghostId];
              // If realUserId already has an entry (shouldn't happen, but be safe), sum them
              amounts[realUserId] = (amounts[realUserId] || 0) + ghostAmount;
              updates.splitAmounts = JSON.stringify(amounts);
            }
          } catch { /* skip if JSON is invalid */ }
        }

        await db.update(expenses).set(updates).where(eq(expenses.id, exp.id));
      }
    }

    // 4. Update groups.memberIds and adminIds
    const allGroups = await db.select().from(groups);
    for (const group of allGroups) {
      let changed = false;
      let newMembers = group.memberIds;
      let newAdmins = group.adminIds || [];

      if (newMembers.includes(ghostId)) {
        newMembers = [...new Set(newMembers.map(id => id === ghostId ? realUserId : id))];
        changed = true;
      }
      if (newAdmins.includes(ghostId)) {
        newAdmins = [...new Set(newAdmins.map(id => id === ghostId ? realUserId : id))];
        changed = true;
      }
      if (changed) {
        await db.update(groups).set({ memberIds: newMembers, adminIds: newAdmins }).where(eq(groups.id, group.id));
      }
    }

    // 5. Update groups.createdById
    await db.update(groups).set({ createdById: realUserId }).where(eq(groups.createdById, ghostId));

    // 6. Update friends — replace or remove duplicates
    const ghostFriends = await db.select().from(friends).where(
      or(eq(friends.userId, ghostId), eq(friends.friendId, ghostId))
    );
    for (const f of ghostFriends) {
      const otherId = f.userId === ghostId ? f.friendId : f.userId;
      if (otherId === realUserId) {
        // Would create self-friendship, just delete
        await db.delete(friends).where(eq(friends.id, f.id));
      } else {
        const alreadyFriends = await this.areFriends(realUserId, otherId);
        if (alreadyFriends) {
          await db.delete(friends).where(eq(friends.id, f.id));
        } else {
          const newData = f.userId === ghostId
            ? { userId: realUserId }
            : { friendId: realUserId };
          await db.update(friends).set(newData).where(eq(friends.id, f.id));
        }
      }
    }

    // 7. Update groupInvites
    await db.update(groupInvites).set({ inviterId: realUserId }).where(eq(groupInvites.inviterId, ghostId));
    await db.update(groupInvites).set({ inviteeId: realUserId }).where(eq(groupInvites.inviteeId, ghostId));

    // 8. Delete OTP codes and reset tokens for ghost
    await db.delete(otpCodes).where(eq(otpCodes.email, ghost.email));
    await db.delete(resetTokens).where(eq(resetTokens.userId, ghostId));

    // 9. Delete the ghost user
    await db.delete(users).where(eq(users.id, ghostId));
  }

  async updateUserEmail(id: string, email: string): Promise<User | undefined> {
    const [updated] = await db.update(users).set({ email: email.toLowerCase() }).where(eq(users.id, id)).returning();
    return updated;
  }

  async upgradeGhostUser(ghostId: string, data: { name: string; password: string; isAdmin: boolean; isEmailVerified: boolean }): Promise<void> {
    await db.update(users).set({
      name: data.name,
      password: data.password,
      isGhost: false,
      isAdmin: data.isAdmin,
      isApproved: true,
      isEmailVerified: data.isEmailVerified,
    }).where(eq(users.id, ghostId));
  }

  async getGhostsByEmail(email: string): Promise<User[]> {
    return db.select().from(users).where(
      and(eq(users.email, email.toLowerCase()), eq(users.isGhost, true))
    );
  }

  // Recurring expenses
  async createRecurringExpense(data: InsertRecurringExpense): Promise<RecurringExpense> {
    const [rec] = await db.insert(recurringExpenses).values(data).returning();
    return rec;
  }

  async getRecurringExpensesForUser(userId: string): Promise<RecurringExpense[]> {
    return db.select().from(recurringExpenses).where(
      and(eq(recurringExpenses.userId, userId), eq(recurringExpenses.isActive, true))
    );
  }

  async getAllDueRecurringExpenses(asOfDate: string): Promise<RecurringExpense[]> {
    // Fetch all active; filter by nextRunDate <= asOfDate in memory (avoids complex SQL comparison)
    const all = await db.select().from(recurringExpenses).where(eq(recurringExpenses.isActive, true));
    return all.filter(r => r.nextRunDate <= asOfDate);
  }

  async updateRecurringExpenseNextRun(id: string, nextRunDate: string): Promise<void> {
    await db.update(recurringExpenses).set({ nextRunDate }).where(eq(recurringExpenses.id, id));
  }

  async deactivateRecurringExpense(id: string): Promise<boolean> {
    const result = await db.update(recurringExpenses)
      .set({ isActive: false })
      .where(eq(recurringExpenses.id, id))
      .returning();
    return result.length > 0;
  }

  // ── Auto-reminder settings ──────────────────────────────────────────────────

  async updateReminderSettings(
    userId: string,
    data: { reminderEnabled: boolean; reminderDays: number; reminderTone: string }
  ): Promise<void> {
    await db.update(users)
      .set({
        reminderEnabled: data.reminderEnabled,
        reminderDays: data.reminderDays,
        reminderTone: data.reminderTone,
      })
      .where(eq(users.id, userId));
  }

  async getPremiumUsersWithRemindersEnabled(): Promise<User[]> {
    return db.select().from(users).where(
      and(
        eq(users.isPremium, true),
        eq(users.reminderEnabled, true),
        eq(users.isGhost, false)
      )
    );
  }

  async getLastReminderSent(fromUserId: string, toUserId: string): Promise<SentReminder | undefined> {
    const [row] = await db.select().from(sentReminders).where(
      and(
        eq(sentReminders.fromUserId, fromUserId),
        eq(sentReminders.toUserId, toUserId)
      )
    );
    return row;
  }

  async upsertSentReminder(fromUserId: string, toUserId: string, sentAt: string): Promise<void> {
    await db
      .insert(sentReminders)
      .values({ fromUserId, toUserId, sentAt })
      .onConflictDoUpdate({
        target: [sentReminders.fromUserId, sentReminders.toUserId],
        set: { sentAt },
      });
  }
}

export const storage = new PgStorage();
