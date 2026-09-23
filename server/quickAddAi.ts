// server/quickAddAi.ts — Claude Haiku reads what the user typed in the
// dashboard quick-add pill ("dinner with katie 80 she has to pay 30") and
// returns the same shape the on-device parser produces, resolved to real
// people and groups.
//
// The pill shows the instant rule-based card while you type; this runs when
// you pause, and its answer replaces the card if it understood more. Nothing is
// saved here: the user still reviews the card and taps Add, which goes through
// the normal expense endpoints.
//
// Only names go to the model (no emails). Its output is never trusted as-is:
// names are matched against the user's own friends/groups (same matcher as
// Voice Mode), and people who can't be resolved are dropped and reported.
//
// Cost guard: own per-user and global daily caps (in-memory, reset on deploy,
// like voiceQuota), plus the shared AI kill switch. It does not use AI Mode's
// per-user quota, so typing in the pill never eats anyone's AI Mode turns.

import Anthropic from "@anthropic-ai/sdk";
import type { UserContext } from "./ai";
import { candidatePool, matchName, norm, firstToken } from "./voice";
import { isGloballyDegraded } from "./aiQuota";

export const QUICK_ADD_AI_ENABLED = !!process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-haiku-4-5";

let _client: Anthropic | null = null;
const client = () => (_client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));

// ── Quota ────────────────────────────────────────────────────────────────────
const PER_USER_PER_DAY = parseInt(process.env.QUICK_ADD_AI_DAILY_PER_USER || "300", 10);
const GLOBAL_PER_DAY = parseInt(process.env.QUICK_ADD_AI_DAILY_GLOBAL || "20000", 10); // ~$40/day worst case
let quotaDay = "";
let globalCount = 0;
const perUser = new Map<string, number>();

/** Consumes one call if allowed. Returns why not otherwise. */
export function takeQuickAddAiQuota(userId: string): { ok: true } | { ok: false; reason: "degraded" | "global" | "user" } {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== quotaDay) { quotaDay = today; globalCount = 0; perUser.clear(); }
  if (isGloballyDegraded().degraded) return { ok: false, reason: "degraded" };
  if (globalCount >= GLOBAL_PER_DAY) return { ok: false, reason: "global" };
  if ((perUser.get(userId) || 0) >= PER_USER_PER_DAY) return { ok: false, reason: "user" };
  globalCount += 1;
  perUser.set(userId, (perUser.get(userId) || 0) + 1);
  return { ok: true };
}

// ── What the model returns ───────────────────────────────────────────────────
export interface ModelOutput {
  kind: "expense" | "settle" | "balance" | "unknown";
  amount?: number;
  description?: string;
  paid_by?: string;
  people?: string[];
  group?: string;
  shares?: Array<{ name: string; amount: number }>;
  date?: string;
  settle_with?: string;
  settle_direction?: "i_paid" | "they_paid";
  balance_with?: string;
}

const TOOL: Anthropic.Tool = {
  name: "record_quick_add",
  description: "Record what the user's short note about shared money means.",
  input_schema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["expense", "settle", "balance", "unknown"],
        description: "expense: something was bought and is shared. settle: someone paid someone back. balance: a question about who owes what. unknown: anything else.",
      },
      amount: { type: "number", description: "The total amount (expense) or the amount paid back (settle). Omit if none is stated." },
      description: { type: "string", description: "Expense only. A short title, 1-4 words, first letter capitalised, e.g. \"Sushi night\". No names, amounts or dates." },
      paid_by: { type: "string", description: "Expense only. Who paid: \"me\" or the person's name. Default \"me\"." },
      people: { type: "array", items: { type: "string" }, description: "Expense only. The other people sharing it, by name (not the user). Leave empty when a whole group is meant." },
      group: { type: "string", description: "Expense only. The group's name, when one of the user's groups is meant." },
      shares: {
        type: "array",
        description: "Expense only, and only when specific amounts are stated for specific people (\"she has to pay 30\", \"I pay 50\"). Use \"me\" for the user. Resolve he/she/they to the right person.",
        items: {
          type: "object",
          properties: { name: { type: "string" }, amount: { type: "number" } },
          required: ["name", "amount"],
        },
      },
      date: { type: "string", description: "YYYY-MM-DD, only if a day is mentioned (\"yesterday\", \"last friday\"). Omit otherwise." },
      settle_with: { type: "string", description: "Settle only. The other person." },
      settle_direction: { type: "string", enum: ["i_paid", "they_paid"], description: "Settle only. i_paid: the user paid them. they_paid: they paid the user." },
      balance_with: { type: "string", description: "Balance only. The person asked about, if any." },
    },
    required: ["kind"],
  },
};

const SYSTEM = [
  "You read short notes typed into a bill-splitting app and record what they mean by calling record_quick_add exactly once.",
  "The user is \"me\". Notes are casual and often lowercase, e.g. \"dinner with katie 80 she has to pay 30\" or \"sam paid 64 for tacos\".",
  "Use the names and groups exactly as they appear in the lists provided when the note refers to them; keep other names as written.",
  "Unless the note says otherwise, the user paid and shares the expense.",
  "Never invent amounts or people that aren't in the note.",
].join(" ");

// ── Result sent to the pill (same shape as client QuickIntent) ───────────────
export type QuickAiResult =
  | {
      type: "expense";
      amount: number | null;
      description: string | null;
      payerId: string;
      splitIds: string[];
      groupId: string | null;
      shares?: Record<string, number>;
      date?: string;
      unresolved?: string[];
    }
  | { type: "settle"; friendId: string; amount: number | null; friendIsPayer: boolean }
  | { type: "balance"; personId: string | null }
  | { type: "unknown" };

export async function understandQuickAdd(ctx: UserContext, text: string, today: string): Promise<QuickAiResult> {
  const lists = [
    `Today is ${today}.`,
    `Friends: ${ctx.friends.map((f) => f.name).join(", ") || "none"}.`,
    `Groups: ${ctx.groups.map((g) => `${g.name} (${Object.values(g.memberNames || {}).join(", ")})`).join("; ") || "none"}.`,
  ].join("\n");

  const response = await client().messages.create(
    {
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content: `${lists}\n\nNote: ${text}` }],
    },
    { timeout: 8000, maxRetries: 0 }, // the pill already shows a card; don't make it wait
  );

  const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!call) return { type: "unknown" };
  return resolveQuickAddOutput(ctx, call.input as ModelOutput);
}

export function resolveQuickAddOutput(ctx: UserContext, out: ModelOutput): QuickAiResult {
  const pool = candidatePool(ctx);
  const friendIds = new Set(ctx.friends.map((f) => f.id));
  const unresolved: string[] = [];
  const who = (raw?: string): string | null => {
    if (!raw) return null;
    const m = matchName(ctx, pool, raw);
    if (m.length === 1) return m[0];
    unresolved.push(raw);
    return null;
  };
  const amountOf = (n?: number) => (typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 1_000_000 ? Math.round(n * 100) / 100 : null);

  if (out.kind === "settle") {
    const id = who(out.settle_with);
    // Settle-up is between friends only (the endpoint enforces it too).
    if (!id || id === ctx.userId || !friendIds.has(id)) return { type: "unknown" };
    return { type: "settle", friendId: id, amount: amountOf(out.amount), friendIsPayer: out.settle_direction === "they_paid" };
  }

  if (out.kind === "balance") {
    const id = who(out.balance_with);
    return { type: "balance", personId: id && id !== ctx.userId ? id : null };
  }

  if (out.kind !== "expense") return { type: "unknown" };

  // Group, matched the same way Voice Mode does.
  let group = out.group
    ? ctx.groups.find((g) => norm(g.name) === norm(out.group!))
      || ctx.groups.find((g) => norm(g.name).startsWith(norm(out.group!)))
      || ctx.groups.find((g) => firstToken(g.name) === firstToken(out.group!))
    : undefined;

  const named = (out.people || []).map(who).filter((id): id is string => !!id && id !== ctx.userId);
  const payerId = (out.paid_by && norm(out.paid_by) !== "me" && who(out.paid_by)) || ctx.userId;

  let shares: Record<string, number> | undefined;
  for (const s of out.shares || []) {
    const id = norm(s.name) === "me" ? ctx.userId : who(s.name);
    const amt = amountOf(s.amount);
    if (id && amt != null) (shares ??= {})[id] = amt;
  }

  let splitIds = Array.from(new Set([ctx.userId, ...named, payerId, ...Object.keys(shares || {})]));
  if (group) {
    // No one named means the whole group; a stated share ("priya pays 40")
    // sets that person's part, it doesn't shrink the split to them.
    if (named.length === 0) splitIds = Array.from(new Set([...group.memberIds, payerId, ...Object.keys(shares || {})]));
    // Someone outside the named group means the group was the wrong read.
    if (!splitIds.every((id) => group!.memberIds.includes(id))) group = undefined;
  }
  if (!group && splitIds.some((id) => id !== ctx.userId && !friendIds.has(id))) {
    // Non-friends can only be split with inside a group you share.
    group = ctx.groups
      .filter((g) => splitIds.every((id) => g.memberIds.includes(id)))
      .sort((a, b) => a.memberIds.length - b.memberIds.length)[0];
    if (!group) splitIds = splitIds.filter((id) => id === ctx.userId || friendIds.has(id));
  }
  if (shares) shares = Object.fromEntries(Object.entries(shares).filter(([id]) => splitIds.includes(id)));

  const description = (out.description || "").trim().slice(0, 60);
  const date = out.date && /^\d{4}-\d{2}-\d{2}$/.test(out.date) ? out.date : undefined;
  return {
    type: "expense",
    amount: amountOf(out.amount),
    description: description ? description.charAt(0).toUpperCase() + description.slice(1) : null,
    payerId: splitIds.includes(payerId) ? payerId : ctx.userId,
    splitIds,
    groupId: group?.id ?? null,
    ...(shares && Object.keys(shares).length ? { shares } : {}),
    ...(date ? { date } : {}),
    ...(unresolved.length ? { unresolved } : {}),
  };
}
