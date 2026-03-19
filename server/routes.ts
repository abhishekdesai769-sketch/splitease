import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import createMemoryStore from "memorystore";
import multer from "multer";
import { storage } from "./storage";
import { signupSchema, loginSchema, verifyOtpSchema, forgotPasswordSchema, resetPasswordSchema } from "@shared/schema";
import { createHash, randomBytes } from "crypto";
import { notifyExpenseCreated, sendOtpEmail, sendResetPasswordEmail, sendExportEmail } from "./email";

// Multer: memory-only storage for receipt uploads (max 10MB)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ========== Security helpers ==========

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

// Rate limiter (in-memory, per IP)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function rateLimit(windowMs: number, maxRequests: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const entry = rateLimitMap.get(ip);

    if (!entry || now > entry.resetAt) {
      rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count++;
    if (entry.count > maxRequests) {
      return res.status(429).json({ error: "Too many requests. Please try again later." });
    }
    next();
  };
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }
}, 60000);

// Input sanitizer — strip HTML tags, trim, limit length
function sanitize(input: string, maxLen = 500): string {
  return input.replace(/<[^>]*>/g, "").trim().slice(0, maxLen);
}

// Auth middleware
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!(req.session as any).userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

// Admin middleware
async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  const user = await storage.getUser(userId);
  if (!user || !user.isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

// Approved user middleware — user must be approved by admin to use the app
async function requireApproved(req: Request, res: Response, next: NextFunction) {
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  const user = await storage.getUser(userId);
  if (!user) return res.status(401).json({ error: "User not found" });

  // Admins are always approved
  if (!user.isApproved && !user.isAdmin) {
    return res.status(403).json({ error: "Your account is pending approval by the administrator." });
  }
  next();
}

const AVATAR_COLORS = [
  "#0d9488", "#0891b2", "#7c3aed", "#db2777", "#ea580c",
  "#d97706", "#059669", "#4f46e5", "#be185d", "#2563eb",
];

// The first user to sign up (Abhishek) gets admin privileges
const ADMIN_EMAIL = "abhishekdesai769@gmail.com";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Trust proxy (Render runs behind a reverse proxy)
  app.set("trust proxy", 1);

  // Session setup with stronger config
  const MemoryStore = createMemoryStore(session);
  const sessionSecret = process.env.SESSION_SECRET || "splitease-secret-" + randomBytes(16).toString("hex");

  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: new MemoryStore({ checkPeriod: 86400000 }),
      cookie: {
        secure: false, // Render handles HTTPS at proxy level
        httpOnly: true, // prevents JS access to cookie
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        sameSite: "lax", // CSRF protection
      },
    })
  );

  // ========== Auth (rate limited) ==========
  const authLimiter = rateLimit(15 * 60 * 1000, 20); // 20 attempts per 15 min

  // Step 1: Send OTP to verify email before creating account
  app.post("/api/auth/send-otp", authLimiter, async (req, res) => {
    const { email, name } = req.body;
    if (!email || !name) return res.status(400).json({ error: "Email and name are required" });

    const cleanEmail = email.toLowerCase().trim();
    const existing = await storage.getUserByEmail(cleanEmail);
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    // Generate 6-digit OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    await storage.createOtp({ email: cleanEmail, code, expiresAt });
    sendOtpEmail(cleanEmail, sanitize(name, 100), code);

    res.json({ message: "OTP sent" });
  });

  // Step 2: Verify OTP and create the account
  app.post("/api/auth/signup", authLimiter, async (req, res) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
    }

    const { name, email, password } = parsed.data;
    const otpCode = req.body.otpCode;
    const cleanName = sanitize(name, 100);
    const cleanEmail = email.toLowerCase().trim();

    // Verify OTP
    if (!otpCode) {
      return res.status(400).json({ error: "Verification code is required" });
    }
    const validOtp = await storage.verifyOtp(cleanEmail, otpCode);
    if (!validOtp) {
      return res.status(400).json({ error: "Invalid or expired verification code" });
    }

    const existing = await storage.getUserByEmail(cleanEmail);
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    // Check if this is the admin email
    const isAdmin = cleanEmail === ADMIN_EMAIL;
    const isApproved = isAdmin; // Admin is auto-approved, everyone else needs approval

    const user = await storage.createUser({
      name: cleanName,
      email: cleanEmail,
      password: hashPassword(password),
      avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
      isAdmin,
      isApproved,
      isEmailVerified: true,
    });

    (req.session as any).userId = user.id;

    const { password: _, ...safeUser } = user;
    res.status(201).json(safeUser);
  });

  app.post("/api/auth/login", authLimiter, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
    }

    const { email, password } = parsed.data;
    const user = await storage.getUserByEmail(email.toLowerCase().trim());

    if (!user || !verifyPassword(password, user.password)) {
      // Generic message to prevent email enumeration
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

  // ========== Forgot / Reset Password ==========
  app.post("/api/auth/forgot-password", authLimiter, async (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Valid email is required" });
    }

    const cleanEmail = parsed.data.email.toLowerCase().trim();
    const user = await storage.getUserByEmail(cleanEmail);

    // Always return success to prevent email enumeration
    if (!user) {
      return res.json({ message: "If an account exists with that email, a reset link has been sent." });
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    await storage.createResetToken({ userId: user.id, token, expiresAt });

    // Build reset link — uses hash routing
    const baseUrl = process.env.APP_URL || "https://splitease-81re.onrender.com";
    const resetLink = `${baseUrl}/#/reset-password?token=${token}`;

    sendResetPasswordEmail(cleanEmail, user.name, resetLink);

    res.json({ message: "If an account exists with that email, a reset link has been sent." });
  });

  app.post("/api/auth/reset-password", authLimiter, async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
    }

    const { token, password } = parsed.data;
    const resetToken = await storage.verifyResetToken(token);

    if (!resetToken) {
      return res.status(400).json({ error: "Invalid or expired reset link. Please request a new one." });
    }

    await storage.updateUserPassword(resetToken.userId, hashPassword(password));

    res.json({ message: "Password has been reset successfully. You can now sign in." });
  });

  // ========== Users (search) — requires approved ==========
  app.get("/api/users/search", requireAuth, requireApproved, async (req, res) => {
    const email = sanitize((req.query.email as string) || "", 255);
    const userId = (req.session as any).userId;
    if (email.length < 2) return res.json([]);
    const results = await storage.searchUsersByEmail(email, userId);
    res.json(results);
  });

  // ========== Admin routes ==========
  app.get("/api/admin/users", requireAuth, requireAdmin, async (_req, res) => {
    const allUsers = await storage.getAllUsers();
    res.json(allUsers);
  });

  app.patch("/api/admin/users/:id/approve", requireAuth, requireAdmin, async (req, res) => {
    const updated = await storage.updateUser(req.params.id, { isApproved: true });
    if (!updated) return res.status(404).json({ error: "User not found" });
    const { password: _, ...safeUser } = updated;
    res.json(safeUser);
  });

  app.patch("/api/admin/users/:id/revoke", requireAuth, requireAdmin, async (req, res) => {
    // Cannot revoke own admin
    const userId = (req.session as any).userId;
    if (req.params.id === userId) {
      return res.status(400).json({ error: "Cannot revoke your own access" });
    }
    const updated = await storage.updateUser(req.params.id, { isApproved: false });
    if (!updated) return res.status(404).json({ error: "User not found" });
    const { password: _, ...safeUser } = updated;
    res.json(safeUser);
  });

  app.delete("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
    const userId = (req.session as any).userId;
    if (req.params.id === userId) {
      return res.status(400).json({ error: "Cannot delete yourself" });
    }
    const deleted = await storage.deleteUser(req.params.id);
    if (!deleted) return res.status(404).json({ error: "User not found" });
    res.status(204).send();
  });

  // ========== Friends — requires approved ==========
  app.get("/api/friends", requireAuth, requireApproved, async (req, res) => {
    const userId = (req.session as any).userId;
    const friendsList = await storage.getFriends(userId);
    res.json(friendsList);
  });

  app.post("/api/friends", requireAuth, requireApproved, async (req, res) => {
    const userId = (req.session as any).userId;
    const email = sanitize((req.body.email || "").toLowerCase(), 255);

    if (!email) return res.status(400).json({ error: "Email is required" });

    const targetUser = await storage.getUserByEmail(email);
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

  app.delete("/api/friends/:friendId", requireAuth, requireApproved, async (req, res) => {
    const userId = (req.session as any).userId;
    await storage.removeFriend(userId, req.params.friendId);
    res.status(204).send();
  });

  // Direct expenses between friends (no group)
  app.get("/api/friends/expenses", requireAuth, requireApproved, async (req, res) => {
    const userId = (req.session as any).userId;
    const directExpenses = await storage.getDirectExpensesForUser(userId);
    res.json(directExpenses);
  });

  app.post("/api/friends/expenses", requireAuth, requireApproved, upload.single("receipt"), async (req, res) => {
    const userId = (req.session as any).userId;
    const { description, amount, paidById, date, isSettlement } = req.body;
    // splitAmongIds comes as JSON string from FormData
    let splitAmongIds = req.body.splitAmongIds;
    if (typeof splitAmongIds === "string") {
      try { splitAmongIds = JSON.parse(splitAmongIds); } catch { /* keep as-is */ }
    }

    if (!description || !amount || !paidById || !splitAmongIds || !date) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0 || parsedAmount > 1000000) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const expense = await storage.createExpense({
      description: sanitize(description, 200),
      amount: parsedAmount,
      paidById,
      splitAmongIds,
      groupId: null,
      date,
      addedById: userId,
      isSettlement: !!isSettlement,
    });
    res.status(201).json(expense);

    // Receipt from upload (held in memory only — not saved)
    const receiptFile = req.file;

    // Send email notifications (fire-and-forget)
    try {
      const payer = await storage.getUser(paidById);
      const splitUsers = await storage.getUsersSafe(splitAmongIds);
      const perPerson = parsedAmount / splitAmongIds.length;
      if (payer) {
        notifyExpenseCreated({
          description: sanitize(description, 200),
          amount: parsedAmount,
          paidByName: payer.name,
          paidByEmail: payer.email,
          splitAmong: splitUsers.map((u) => ({ name: u.name, email: u.email, share: perPerson })),
          isSettlement: !!isSettlement,
          receiptBuffer: receiptFile?.buffer,
          receiptFilename: receiptFile?.originalname,
        });
      }
    } catch (e) { /* ignore email errors */ }
  });

  // ========== Settle Up ==========
  app.post("/api/settle-up", requireAuth, requireApproved, async (req, res) => {
    const userId = (req.session as any).userId;
    const { friendId, amount, groupId } = req.body;

    if (!friendId || !amount) {
      return res.status(400).json({ error: "Friend and amount are required" });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0 || parsedAmount > 1000000) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // Determine who pays whom based on positive/negative amount
    // If amount > 0, current user pays friend (current user owed friend)
    // We create a payment record: paidById = userId (the one paying), splitAmongIds = [friendId]
    const expense = await storage.createExpense({
      description: `Settlement payment`,
      amount: parsedAmount,
      paidById: userId, // person who is paying/settling
      splitAmongIds: [friendId], // person receiving the payment
      groupId: groupId || null,
      date: new Date().toISOString(),
      addedById: userId,
      isSettlement: true,
    });
    res.status(201).json(expense);

    // Send email notification for settlement (fire-and-forget)
    try {
      const payer = await storage.getUser(userId);
      const receiver = await storage.getUser(friendId);
      if (payer && receiver) {
        notifyExpenseCreated({
          description: "Settlement payment",
          amount: parsedAmount,
          paidByName: payer.name,
          paidByEmail: payer.email,
          splitAmong: [{ name: receiver.name, email: receiver.email, share: parsedAmount }],
          isSettlement: true,
        });
      }
    } catch (e) { /* ignore email errors */ }
  });

  // ========== Groups — requires approved ==========
  app.get("/api/groups", requireAuth, requireApproved, async (req, res) => {
    const userId = (req.session as any).userId;
    const groupsList = await storage.getGroupsForUser(userId);
    res.json(groupsList);
  });

  app.get("/api/groups/:id", requireAuth, requireApproved, async (req, res) => {
    const userId = (req.session as any).userId;
    const group = await storage.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Not found" });
    if (!group.memberIds.includes(userId)) {
      return res.status(403).json({ error: "Not a member of this group" });
    }
    res.json(group);
  });

  app.post("/api/groups", requireAuth, requireApproved, async (req, res) => {
    const userId = (req.session as any).userId;
    const { name, memberIds } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Group name is required" });
    }

    const allMembers = Array.from(new Set([userId, ...(memberIds || [])]));

    const group = await storage.createGroup({
      name: sanitize(name, 100),
      createdById: userId,
      memberIds: allMembers,
    });
    res.status(201).json(group);
  });

  app.post("/api/groups/:id/members", requireAuth, requireApproved, async (req, res) => {
    const userId = (req.session as any).userId;
    const group = await storage.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Group not found" });
    if (!group.memberIds.includes(userId)) {
      return res.status(403).json({ error: "Not a member" });
    }

    const email = sanitize((req.body.email || "").toLowerCase(), 255);
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

  app.delete("/api/groups/:id/members/:memberId", requireAuth, requireApproved, async (req, res) => {
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

  app.delete("/api/groups/:id", requireAuth, requireApproved, async (req, res) => {
    const userId = (req.session as any).userId;
    const group = await storage.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Not found" });
    if (group.createdById !== userId) {
      return res.status(403).json({ error: "Only the group creator can delete it" });
    }
    await storage.deleteGroup(req.params.id);
    res.status(204).send();
  });

  // ========== Expenses — requires approved ==========
  app.get("/api/expenses", requireAuth, requireApproved, async (req, res) => {
    const userId = (req.session as any).userId;
    const expensesList = await storage.getExpensesForUser(userId);
    res.json(expensesList);
  });

  app.get("/api/expenses/group/:groupId", requireAuth, requireApproved, async (req, res) => {
    const userId = (req.session as any).userId;
    const group = await storage.getGroup(req.params.groupId);
    if (!group || !group.memberIds.includes(userId)) {
      return res.status(403).json({ error: "Not a member of this group" });
    }
    const expensesList = await storage.getExpensesByGroup(req.params.groupId);
    res.json(expensesList);
  });

  app.post("/api/expenses", requireAuth, requireApproved, upload.single("receipt"), async (req, res) => {
    const userId = (req.session as any).userId;
    const { description, amount, paidById, groupId, date, isSettlement } = req.body;
    // splitAmongIds comes as JSON string from FormData
    let splitAmongIds = req.body.splitAmongIds;
    if (typeof splitAmongIds === "string") {
      try { splitAmongIds = JSON.parse(splitAmongIds); } catch { /* keep as-is */ }
    }

    if (!description || !amount || !paidById || !splitAmongIds || !date) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0 || parsedAmount > 1000000) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // If group expense, verify user is in the group
    if (groupId) {
      const group = await storage.getGroup(groupId);
      if (!group || !group.memberIds.includes(userId)) {
        return res.status(403).json({ error: "Not a member of this group" });
      }
    }

    const expense = await storage.createExpense({
      description: sanitize(description, 200),
      amount: parsedAmount,
      paidById,
      splitAmongIds,
      groupId: groupId || null,
      date,
      addedById: userId,
      isSettlement: !!isSettlement,
    });
    res.status(201).json(expense);

    // Receipt from upload (held in memory only — not saved)
    const receiptFile = req.file;

    // Send email notifications for group expense (fire-and-forget)
    try {
      const payer = await storage.getUser(paidById);
      const splitUsers = await storage.getUsersSafe(splitAmongIds);
      const perPerson = parsedAmount / splitAmongIds.length;
      let groupName: string | undefined;
      if (groupId) {
        const group = await storage.getGroup(groupId);
        groupName = group?.name;
      }
      if (payer) {
        notifyExpenseCreated({
          description: sanitize(description, 200),
          amount: parsedAmount,
          paidByName: payer.name,
          paidByEmail: payer.email,
          splitAmong: splitUsers.map((u) => ({ name: u.name, email: u.email, share: perPerson })),
          groupName,
          isSettlement: !!isSettlement,
          receiptBuffer: receiptFile?.buffer,
          receiptFilename: receiptFile?.originalname,
        });
      }
    } catch (e) { /* ignore email errors */ }
  });

  app.delete("/api/expenses/:id", requireAuth, requireApproved, async (req, res) => {
    const userId = (req.session as any).userId;
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ error: "User not found" });

    // Check expense exists
    const expense = await storage.getExpense(req.params.id);
    if (!expense) return res.status(404).json({ error: "Not found" });

    // Only the person who added the expense or admin can delete
    if (expense.addedById !== userId && !user.isAdmin) {
      return res.status(403).json({ error: "Only the person who created this expense can delete it" });
    }

    const deleted = await storage.deleteExpense(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  });

  // ========== Members info for a group ==========
  app.get("/api/groups/:id/members", requireAuth, requireApproved, async (req, res) => {
    const userId = (req.session as any).userId;
    const group = await storage.getGroup(req.params.id);
    if (!group) return res.status(404).json({ error: "Not found" });
    if (!group.memberIds.includes(userId)) {
      return res.status(403).json({ error: "Not a member" });
    }
    const members = await storage.getUsersSafe(group.memberIds);
    res.json(members);
  });

  // ========== Data Export (emailed as CSV) ==========
  app.post("/api/export/expenses", requireAuth, requireApproved, async (req, res) => {
    const userId = (req.session as any).userId;
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ error: "User not found" });

    const { scope, friendId, groupId } = req.body;
    // scope: "all" | "friend" | "group"

    let expenses: any[] = [];
    let scopeLabel = "All Expenses";

    if (scope === "friend" && friendId) {
      // Get direct expenses between this user and the friend
      const directExpenses = await storage.getDirectExpensesForUser(userId);
      expenses = directExpenses.filter(
        (e: any) =>
          (e.paidById === userId && e.splitAmongIds.includes(friendId)) ||
          (e.paidById === friendId && e.splitAmongIds.includes(userId))
      );
      const friendUser = await storage.getUser(friendId);
      scopeLabel = friendUser ? `Expenses with ${friendUser.name}` : "Friend Expenses";
    } else if (scope === "group" && groupId) {
      // Get group expenses
      const group = await storage.getGroup(groupId);
      if (!group || !group.memberIds.includes(userId)) {
        return res.status(403).json({ error: "Not a member of this group" });
      }
      expenses = await storage.getExpensesByGroup(groupId);
      scopeLabel = `Expenses in ${group.name}`;
    } else {
      // All expenses
      expenses = await storage.getExpensesForUser(userId);
      scopeLabel = "All Expenses";
    }

    if (expenses.length === 0) {
      return res.status(400).json({ error: "No expenses to export" });
    }

    // Build user and group lookup maps
    const userIds = new Set<string>();
    expenses.forEach((e: any) => {
      userIds.add(e.paidById);
      e.splitAmongIds.forEach((id: string) => userIds.add(id));
    });
    const usersMap = new Map<string, string>();
    if (userIds.size > 0) {
      const users = await storage.getUsersSafe(Array.from(userIds));
      users.forEach(u => usersMap.set(u.id, u.name));
    }
    const allGroups = await storage.getGroupsForUser(userId);
    const groupsMap = new Map<string, string>();
    allGroups.forEach(g => groupsMap.set(g.id, g.name));

    // Sort by date descending
    const sorted = [...expenses].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Build CSV
    const csvRows = ["Date,Description,Amount,Paid By,Split Among,Group,Type"];
    for (const e of sorted) {
      const date = new Date(e.date).toLocaleDateString("en-CA"); // YYYY-MM-DD
      const desc = e.description.replace(/"/g, '""');
      const paidBy = usersMap.get(e.paidById) || "Unknown";
      const splitAmong = e.splitAmongIds.map((id: string) => usersMap.get(id) || "Unknown").join("; ");
      const group = e.groupId ? (groupsMap.get(e.groupId) || "Unknown Group") : "Direct";
      const type = e.isSettlement ? "Settlement" : "Expense";
      csvRows.push(`"${date}","${desc}",${e.amount.toFixed(2)},"${paidBy}","${splitAmong}","${group}","${type}"`);
    }

    const csv = csvRows.join("\n");

    // Email the CSV to the user
    try {
      await sendExportEmail(user.email, user.name, csv, scopeLabel);
      res.json({ message: `Export sent to ${user.email}` });
    } catch (err) {
      console.error("Export email failed:", err);
      res.status(500).json({ error: "Failed to send export email. Please try again." });
    }
  });

  return httpServer;
}
