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

// Each limiter keeps its OWN counters. (They used to share one map keyed by
// IP, so the global 200/min limiter's traffic counted against e.g. the
// 5/hour support limiter — sending a support message after normal app use
// returned 429 — and whichever limiter created an IP's entry set the window
// for all of them.)
type RateEntry = { count: number; resetAt: number };
const allRateMaps: Map<string, RateEntry>[] = [];

export function rateLimit(windowMs: number, maxRequests: number) {
  const hits = new Map<string, RateEntry>();
  allRateMaps.push(hits);
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const entry = hits.get(ip);

    if (!entry || now > entry.resetAt) {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
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
  for (const hits of allRateMaps) {
    for (const [key, val] of hits) {
      if (now > val.resetAt) hits.delete(key);
    }
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

// Earth-tone palette — matches the cream/terracotta brand (zero green/teal).
// Clay, ochre, olive, rust, terracotta, walnut, camel, sage, sienna, taupe.
export const AVATAR_COLORS = [
  "#7A3E32", "#8A6A32", "#4A5248", "#9A4A2A", "#B04A34",
  "#6B5D4F", "#A67B5B", "#5C6B5A", "#8C5A3C", "#7C6A52",
];

// ADMIN_EMAIL identifies the super-admin user. Source-of-truth is the
// ADMIN_EMAIL env var on Render; the hardcoded fallback below is for
// dev/legacy continuity and matches the value that's been in production.
// Moving to env-var-first reduces blast radius from public-repo scanning
// (this file is on GitHub) so attackers can't trivially see who to
// phish for admin takeover. Existing prod behaviour unchanged.
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "abhishekdesai769@gmail.com";
