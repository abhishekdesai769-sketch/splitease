import type { Request, Response, NextFunction } from "express";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import multer from "multer";
import { storage } from "./storage";

// Multer: memory-only storage for receipt uploads (max 10MB)
export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ========== Password hashing ==========

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    if (storedHash.startsWith("scrypt:")) {
      const [, salt, hash] = storedHash.split(":");
      if (!salt || !hash) return false;
      const derived = scryptSync(password, salt, 64).toString("hex");
      const hashBuf = Buffer.from(hash, "hex");
      const derivedBuf = Buffer.from(derived, "hex");
      if (hashBuf.length !== derivedBuf.length) return false;
      return timingSafeEqual(hashBuf, derivedBuf);
    }
    // Legacy SHA-256 fallback — constant-time comparison
    const sha256 = createHash("sha256").update(password).digest("hex");
    const sha256Buf = Buffer.from(sha256, "hex");
    const storedBuf = Buffer.from(storedHash, "hex");
    if (sha256Buf.length !== storedBuf.length) return false;
    return timingSafeEqual(sha256Buf, storedBuf);
  } catch {
    return false;
  }
}

export function needsHashUpgrade(storedHash: string): boolean {
  return !storedHash.startsWith("scrypt:");
}

// ========== Rate limiter ==========

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(windowMs: number, maxRequests: number) {
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

// ========== Sanitizer ==========

export function sanitize(input: string, maxLen = 500): string {
  return input.replace(/<[^>]*>/g, "").trim().slice(0, maxLen);
}

// ========== Auth middleware ==========

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!(req.session as any).userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  const user = await storage.getUser(userId);
  if (!user || !user.isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

// ========== Constants ==========

export const AVATAR_COLORS = [
  "#0d9488", "#0891b2", "#7c3aed", "#db2777", "#ea580c",
  "#d97706", "#059669", "#4f46e5", "#be185d", "#2563eb",
];

export const ADMIN_EMAIL = "abhishekdesai769@gmail.com";
