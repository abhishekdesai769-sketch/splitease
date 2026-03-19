import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import createMemoryStore from "memorystore";
import { storage } from "./storage";
import { signupSchema, loginSchema } from "@shared/schema";
import { createHash } from "crypto";

// Simple password hashing
function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

// Auth middleware
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!(req.session as any).userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

const AVATAR_COLORS = [
  "#0d9488", "#0891b2", "#7c3aed", "#db2777", "#ea580c",
  "#d97706", "#059669", "#4f46e5", "#be185d", "#2563eb",
];

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Session setup
  const MemoryStore = createMemoryStore(session);
  app.use(
    session({
      secret: "splitease-secret-key-2026",
      resave: false,
      saveUninitialized: false,
      store: new MemoryStore({ checkPeriod: 86400000 }),
      cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: "lax",
      },
    })
  );

  // ========== Auth ==========
  app.post("/api/auth/signup", async (req, res) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
    }

    const { name, email, password } = parsed.data;

    const existing = await storage.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const user = await storage.createUser({
      name,
      email: email.toLowerCase(),
      password: hashPassword(password),
      avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    });

    (req.session as any).userId = user.id;

    const { password: _, ...safeUser } = user;
    res.status(201).json(safeUser);
  });

  app.post("/api/auth/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
    }

    const { email, password } = parsed.data;
    const user = await storage.getUserByEmail(email);

    if (!user || !verifyPassword(password, user.password)) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    (req.session as any).userId = user.id;

    const { password: _, ...safeUser } = user;
    res.json(safeUser);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    const userId = (req.session as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    const { password: _, ...safeUser } = user;
    res.json(safeUser);
  });

  // ========== Users (search) ==========
  app.get("/api/users/search", requireAuth, async (req, res) => {
    const email = (req.query.email as string) || "";
    const userId = (req.session as any).userId;
    if (email.length < 2) return res.json([]);
    const results = await storage.searchUsersByEmail(email, userId);
    res.json(results);
  });

  // ========== Friends ==========
  app.get("/api/friends", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const friendsList = await storage.getFriends(userId);
    res.json(friendsList);
  });

  app.post("/api/friends", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const { email } = req.body;

    if (!email) return res.status(400).json({ error: "Email is required" });

    const targetUser = await storage.getUserByEmail(email.toLowerCase());
    if (!targetUser) {
      return res.status(404).json({ error: "No user found with that email. They need to sign up first." });
    }

    if (targetUser.id === userId) {
      return res.status(400).json({ error: "You can't add yourself as a friend" });
    }

    const already = await storage.areFriends(userId, targetUser.id);
    if (already) {
      return res.status(409).json({ error: "Already friends" });
    }

    await storage.addFriend(userId, targetUser.id);
    const { password: _, ...safeFriend } = targetUser;
    res.status(201).json(safeFriend);
  });

  app.delete("/api/friends/:friendId", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    await storage.removeFriend(userId, req.params.friendId);
    res.status(204).send();
  });

  // Direct expenses between friends (no group)
  app.get("/api/friends/expenses", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const directExpenses = await storage.getDirectExpensesForUser(userId);
    res.json(directExpenses);
  });

  app.post("/api/friends/expenses", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const { description, amount, paidById, splitAmongIds, date } = req.body;

    if (!description || !amount || !paidById || !splitAmongIds || !date) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const expense = await storage.createExpense({
      description: description.trim(),
      amount: parseFloat(amount),
      paidById,
      splitAmongIds,
      groupId: null, // direct between friends
      date,
      addedById: userId,
    });
    res.status(201).json(expense);
  });

  // ========== Groups ==========
  app.get("/api/groups", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const groupsList = await storage.getGroupsForUser(userId);
    res.json(groupsList);
  });

  app.get("/api/groups/:id", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const group = await storage.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Not found" });
    if (!group.memberIds.includes(userId)) {
      return res.status(403).json({ error: "Not a member of this group" });
    }
    res.json(group);
  });

  app.post("/api/groups", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const { name, memberIds } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Group name is required" });
    }

    const allMembers = Array.from(new Set([userId, ...(memberIds || [])]));

    const group = await storage.createGroup({
      name: name.trim(),
      createdById: userId,
      memberIds: allMembers,
    });
    res.status(201).json(group);
  });

  app.post("/api/groups/:id/members", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const group = await storage.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    if (!group.memberIds.includes(userId)) {
      return res.status(403).json({ error: "Not a member" });
    }

    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const targetUser = await storage.getUserByEmail(email);
    if (!targetUser) {
      return res.status(404).json({ error: "No user found with that email. They need to sign up first." });
    }

    if (group.memberIds.includes(targetUser.id)) {
      return res.status(409).json({ error: "User is already a member" });
    }

    const updated = await storage.updateGroupMembers(
      group.id,
      [...group.memberIds, targetUser.id]
    );
    res.json(updated);
  });

  app.delete("/api/groups/:id/members/:memberId", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const group = await storage.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    if (!group.memberIds.includes(userId)) {
      return res.status(403).json({ error: "Not a member" });
    }
    if (req.params.memberId === group.createdById) {
      return res.status(400).json({ error: "Cannot remove the group creator" });
    }

    const newMembers = group.memberIds.filter((id) => id !== req.params.memberId);
    const updated = await storage.updateGroupMembers(group.id, newMembers);
    res.json(updated);
  });

  app.delete("/api/groups/:id", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const group = await storage.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Not found" });
    if (group.createdById !== userId) {
      return res.status(403).json({ error: "Only the group creator can delete it" });
    }
    await storage.deleteGroup(req.params.id);
    res.status(204).send();
  });

  // ========== Expenses ==========
  app.get("/api/expenses", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const expensesList = await storage.getExpensesForUser(userId);
    res.json(expensesList);
  });

  app.get("/api/expenses/group/:groupId", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const group = await storage.getGroup(req.params.groupId);
    if (!group || !group.memberIds.includes(userId)) {
      return res.status(403).json({ error: "Not a member of this group" });
    }
    const expensesList = await storage.getExpensesByGroup(req.params.groupId);
    res.json(expensesList);
  });

  app.post("/api/expenses", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const { description, amount, paidById, splitAmongIds, groupId, date } = req.body;

    if (!description || !amount || !paidById || !splitAmongIds || !date) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // If group expense, verify user is in the group
    if (groupId) {
      const group = await storage.getGroup(groupId);
      if (!group || !group.memberIds.includes(userId)) {
        return res.status(403).json({ error: "Not a member of this group" });
      }
    }

    const expense = await storage.createExpense({
      description: description.trim(),
      amount: parseFloat(amount),
      paidById,
      splitAmongIds,
      groupId: groupId || null,
      date,
      addedById: userId,
    });
    res.status(201).json(expense);
  });

  app.delete("/api/expenses/:id", requireAuth, async (req, res) => {
    const deleted = await storage.deleteExpense(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  });

  // ========== Members info for a group ==========
  app.get("/api/groups/:id/members", requireAuth, async (req, res) => {
    const userId = (req.session as any).userId;
    const group = await storage.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Not found" });
    if (!group.memberIds.includes(userId)) {
      return res.status(403).json({ error: "Not a member" });
    }
    const members = await storage.getUsersSafe(group.memberIds);
    res.json(members);
  });

  return httpServer;
}
