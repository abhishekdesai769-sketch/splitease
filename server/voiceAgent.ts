// server/voiceAgent.ts
//
// Backend glue for AI Mode "Speak" mode — a Vapi voice agent that acts as a
// VOICE FRONT-END over the existing text brain (ai.runAiTurn). Vapi handles
// speech-to-text + text-to-speech + turn-taking; whenever the caller actually
// describes a split, Vapi calls one of our server "tools" (webhooks) below,
// and WE run the exact same runAiTurn / createExpense logic the chat mode uses.
//
// Why a token instead of the session cookie: Vapi's tool webhooks are
// server-to-server (from Vapi's cloud, not the user's browser), so they carry
// no Spliiit session. At call start the authed client asks us for a short-lived
// signed token bound to their userId; it rides along in the assistant's
// variableValues and comes back on every tool call, which we verify here.
//
// This module is pure/stateless helpers + a small in-memory pending-proposal
// store. The Express routes (server/routes.ts) own DB/context access and call
// into runAiTurn / storage; they use these helpers for auth + payload shape.

import crypto from "node:crypto";
import type { Request } from "express";
import type { ExpenseProposal } from "./ai.js";

// ── Config ──────────────────────────────────────────────────────────────────
// VAPI_TOOL_SECRET: shared secret Vapi sends as a header on every tool call
//   (configured on the assistant's server settings) — rejects forged webhooks.
// VOICE_TOKEN_SECRET: HMAC key for the per-call user token. Falls back to the
//   session secret so voice works as soon as SESSION_SECRET is set.
const TOOL_SECRET = process.env.VAPI_TOOL_SECRET || "";
const TOKEN_SECRET =
  process.env.VOICE_TOKEN_SECRET || process.env.SESSION_SECRET || "";
const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 min — long enough for one voice session

export const VOICE_ENABLED = () =>
  !!process.env.VAPI_PUBLIC_KEY && !!process.env.VAPI_ASSISTANT_ID && !!TOKEN_SECRET;

// ── Per-call user token (HMAC, no external dep) ──────────────────────────────
// Format: base64url(`${userId}.${expMs}`) + "." + base64url(hmacSHA256)
function b64u(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}
export function mintVoiceToken(userId: string): string {
  const body = `${userId}.${Date.now() + TOKEN_TTL_MS}`;
  const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest();
  return `${b64u(body)}.${b64u(sig)}`;
}
export function verifyVoiceToken(token: string | undefined | null): string | null {
  if (!token || !TOKEN_SECRET) return null;
  const parts = String(token).split(".");
  if (parts.length !== 2) return null;
  let body: string, sig: Buffer;
  try {
    body = Buffer.from(parts[0], "base64url").toString("utf8");
    sig = Buffer.from(parts[1], "base64url");
  } catch {
    return null;
  }
  const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest();
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
  const [userId, expStr] = body.split(".");
  if (!userId || !expStr || Date.now() > Number(expStr)) return null;
  return userId;
}

// ── Vapi request authenticity ────────────────────────────────────────────────
// If TOOL_SECRET is unset we fail CLOSED (reject) rather than accept anything —
// the route also gates on VOICE_ENABLED() so this only matters once configured.
export function verifyVapiSecret(req: Request): boolean {
  if (!TOOL_SECRET) return false;
  const got =
    (req.headers["x-vapi-secret"] as string) ||
    (req.headers["x-vapi-signature"] as string) ||
    "";
  const a = Buffer.from(got);
  const b = Buffer.from(TOOL_SECRET);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Vapi tool-call payload parsing ───────────────────────────────────────────
// Vapi POSTs { message: { type: "tool-calls", toolCallList|toolCalls: [...],
//   call: { id, assistantOverrides: { variableValues: {...} } } } }.
// Tool args arrive JSON-encoded (or already-parsed on some versions).
export interface ParsedVapiTool {
  toolCallId: string;
  name: string;
  args: Record<string, any>;
  callId: string;
  token: string | null;
}
export function parseVapiToolCall(body: any): ParsedVapiTool | null {
  const msg = body?.message ?? body;
  const list = msg?.toolCallList || msg?.toolCalls || msg?.tool_calls || [];
  const tc = Array.isArray(list) ? list[0] : null;
  if (!tc) return null;
  const fn = tc.function || tc;
  let args = fn.arguments ?? fn.args ?? {};
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { args = {}; }
  }
  const call = msg?.call || {};
  const vars =
    call?.assistantOverrides?.variableValues ||
    msg?.assistantOverrides?.variableValues ||
    {};
  return {
    toolCallId: tc.id || tc.toolCallId || "",
    name: fn.name || "",
    args: args || {},
    callId: call?.id || msg?.callId || "",
    // token may travel as a variable or inside the tool args (belt + braces)
    token: vars.spliiitToken || vars.token || args?.spliiitToken || null,
  };
}

// Vapi expects { results: [{ toolCallId, result: "<string the model reads>" }] }
export function vapiToolResult(toolCallId: string, result: string) {
  return { results: [{ toolCallId, result }] };
}

// ── Pending-proposal store ───────────────────────────────────────────────────
// propose_split stashes the structured proposal keyed by callId so create_split
// commits the EXACT figures we computed — never numbers the voice LLM re-typed
// (guards against a mis-heard "$45" becoming "$54" between the two tool calls).
// In-memory is fine on single-instance Render, same as aiQuota's rate limiter.
interface Pending { proposal: ExpenseProposal | ExpenseProposal[]; userId: string; ts: number; }
const PENDING_TTL_MS = 15 * 60 * 1000;
const pending = new Map<string, Pending>();

export function stashProposal(callId: string, userId: string, proposal: ExpenseProposal | ExpenseProposal[]) {
  if (!callId) return;
  pending.set(callId, { proposal, userId, ts: Date.now() });
}
export function takeProposal(callId: string, userId: string): ExpenseProposal[] | null {
  const p = pending.get(callId);
  if (!p || p.userId !== userId || Date.now() - p.ts > PENDING_TTL_MS) {
    pending.delete(callId);
    return null;
  }
  pending.delete(callId); // one-shot: consume on confirm
  return Array.isArray(p.proposal) ? p.proposal : [p.proposal];
}
// Opportunistic sweep so abandoned calls don't leak memory.
export function sweepPending(now = Date.now()) {
  for (const [k, v] of Array.from(pending.entries())) {
    if (now - v.ts > PENDING_TTL_MS) pending.delete(k);
  }
}

// A short, speakable readback of a proposal for the agent to confirm out loud.
export function speakProposal(p: ExpenseProposal, nameOf: (id: string) => string): string {
  const who = p.splitAmongUserIds.map(nameOf).join(", ");
  const cur = p.currency && p.currency !== "CAD" ? ` ${p.currency}` : "";
  if (p.splitAmounts) {
    const parts = Object.entries(p.splitAmounts).map(([id, amt]) => `${nameOf(id)} ${amt}${cur}`);
    return `${p.description}, ${p.amount}${cur} total — split as ${parts.join(", ")}. Want me to save it?`;
  }
  return `${p.description}, ${p.amount}${cur}, split between ${who}. Want me to save it?`;
}
