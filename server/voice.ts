// server/voice.ts — Talk-back voice mode (OpenAI Realtime).
//
// Mints a short-lived ephemeral session token (client_secrets) scoped to
// bill-splitting, with the user's friends + groups injected as context and a
// `propose_split` tool the model calls once it has enough to act. The real
// OPENAI_API_KEY NEVER leaves the server; the client connects to the Realtime
// API using the `ek_…` token this returns.
//
// Like AI Mode, the model never writes to the DB. It proposes a split; the
// client renders a confirm card; the user taps Confirm; the split is posted
// through the existing /api/expenses + /api/friends/expenses endpoints — so all
// the balance/validation logic we already trust is reused unchanged.

import type { UserContext } from "./ai";

export const VOICE_ENABLED = !!process.env.OPENAI_API_KEY;

const MODEL = process.env.VOICE_REALTIME_MODEL || "gpt-realtime-mini";
const VOICE = process.env.VOICE_REALTIME_VOICE || "marin";

// Exported for the public /api/voice/health check (safe to expose — not a secret).
export const VOICE_MODEL = MODEL;

function buildInstructions(ctx: UserContext): string {
  const friendList = ctx.friends.map((f) => f.name).join(", ") || "(no friends added yet)";
  const groupList = ctx.groups.map((g) => g.name).join(", ") || "(no groups yet)";
  return [
    `You are Spliiit's voice assistant. You ONLY help ${ctx.userName} split bills with friends — nothing else.`,
    `Talk naturally and briefly, like a friend helping out. One or two short sentences at a time.`,
    `The current user (the person talking) is "${ctx.userName}".`,
    `Their friends are: ${friendList}.`,
    `Their groups are: ${groupList}.`,
    `When they describe a bill, work out: the total amount; who is involved (map the names they say to the friends or groups listed above); and how to split it — equally, or one person owes the full amount.`,
    `You ONLY log expenses THIS user paid for. Always set paidByName to "${ctx.userName}". If they say someone ELSE paid, say in one short sentence that you can only log splits they paid for, and to use the manual form or have that person log it — do not call the tool.`,
    `If the user does not say whether they themselves are part of the split, assume they are unless they clearly excluded themselves.`,
    `If something essential is missing or a name is ambiguous, ask ONE short question — do not guess. Never invent amounts or names.`,
    `Once you have the amount, the people, who paid, and the split method, call the propose_split tool with your best structured understanding, then say one short line telling them it's ready and to tap Confirm.`,
    `If the user asks anything unrelated to splitting a bill, politely say in one sentence that you can only help with splitting bills.`,
  ].join(" ");
}

const TOOLS = [
  {
    type: "function",
    name: "propose_split",
    description:
      "Propose a bill split for the user to review and confirm. Call this once you have the amount, the people involved, who paid, and the split method.",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "Short human description, e.g. 'Tacofino dinner'." },
        amount: { type: "number", description: "The total bill amount as a number." },
        currency: { type: "string", description: "ISO 4217 code (e.g. USD, EUR). Omit or 'CAD' if not stated." },
        paidByName: { type: "string", description: "Name of who paid — one of the known friends, or the current user." },
        splitAmongNames: {
          type: "array",
          items: { type: "string" },
          description: "Names of everyone sharing the bill (include the current user if they are involved).",
        },
        groupName: { type: "string", description: "Group name if this belongs to a known group; omit for a friends split." },
        splitType: {
          type: "string",
          enum: ["equal", "unequal", "full_to_one"],
          description: "equal = divided evenly; unequal = different amounts; full_to_one = one person owes another the whole amount.",
        },
      },
      required: ["amount", "paidByName", "splitAmongNames", "splitType"],
    },
  },
];

// ---- propose_split → ExpenseProposal bridge -------------------------------
//
// The Realtime model emits propose_split with NAMES (it doesn't know internal
// IDs). We resolve those names against the user's own friends/groups and build
// the exact same ExpenseProposal shape the text-AI confirm path commits, so all
// the trusted balance/validation logic (storage.createExpense) is reused.

export interface ProposeSplitArgs {
  amount: number;
  description?: string;
  currency?: string;
  paidByName?: string;
  splitAmongNames?: string[];
  groupName?: string;
  splitType?: "equal" | "unequal" | "full_to_one";
}

export interface ResolvedPerson {
  id: string;
  name: string;
  isYou: boolean;
  share: number;   // what this person's slice of the bill is
}

export interface ResolvedProposal {
  ok: true;
  proposal: {
    description: string;
    amount: number;
    paidByUserId: string;
    splitAmongUserIds: string[];
    groupId: string | null;
    currency?: string;
  };
  // Everything the confirm card needs (authoritative — computed server-side).
  amount: number;
  currency: string;         // display code, e.g. "$" is derived client-side
  description: string;
  date: string;             // ISO
  groupId: string | null;
  groupName: string | null;
  splitLabel: string;       // "Split equally"
  perPerson: number;        // even share
  people: ResolvedPerson[]; // resolved, with each person's share
  youGetBack: number;       // total others owe the speaker (payer = you)
}
export interface ResolveError {
  ok: false;
  error: string;
  message: string;
  unresolved?: string[];
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}
function firstToken(s: string): string {
  return norm(s).split(/\s+/)[0] || "";
}

/** Everyone the speaker can name: themself + friends + (if a group is in play)
 *  that group's members. */
function candidatePool(ctx: UserContext, groupId: string | null): Array<{ id: string; name: string }> {
  const pool: Array<{ id: string; name: string }> = [{ id: ctx.userId, name: ctx.userName }];
  for (const f of ctx.friends) if (!pool.some((p) => p.id === f.id)) pool.push({ id: f.id, name: f.name });
  if (groupId) {
    const g = ctx.groups.find((x) => x.id === groupId);
    if (g) for (const [id, name] of Object.entries(g.memberNames || {})) {
      if (!pool.some((p) => p.id === id)) pool.push({ id, name });
    }
  }
  return pool;
}

/** Resolve a spoken name to a userId against the pool. Handles "me"/the user's
 *  own name (any form), exact, first-name, and unique prefix matches. */
function resolveName(ctx: UserContext, pool: Array<{ id: string; name: string }>, raw: string): string | null {
  const n = norm(raw);
  if (!n) return null;
  if (["me", "myself", "i", "im", "i'm", "mine"].includes(n)) return ctx.userId;
  // The speaker, by full or first name.
  if (n === norm(ctx.userName) || firstToken(ctx.userName) === firstToken(raw)) return ctx.userId;
  let hit = pool.find((c) => norm(c.name) === n); if (hit) return hit.id;
  hit = pool.find((c) => firstToken(c.name) === n); if (hit) return hit.id;
  const partial = pool.filter((c) => norm(c.name).startsWith(n) || firstToken(c.name).startsWith(n));
  if (partial.length === 1) return partial[0].id;
  return null;
}

/** Turn a propose_split tool call into a committable proposal + the full,
 *  server-computed breakdown the confirm card renders. Payer is always the
 *  speaker (Voice Mode only logs what you paid for). */
export function resolveVoiceProposal(ctx: UserContext, args: ProposeSplitArgs): ResolvedProposal | ResolveError {
  const amount = Number(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "bad_amount", message: "I didn't catch a valid amount — how much was it?" };
  }

  // Group (optional) — resolve first so its members join the candidate pool.
  let groupId: string | null = null;
  let groupName: string | null = null;
  if (args.groupName) {
    const gn = norm(args.groupName);
    const g = ctx.groups.find((x) => norm(x.name) === gn)
      || ctx.groups.find((x) => norm(x.name).startsWith(gn))
      || ctx.groups.find((x) => firstToken(x.name) === firstToken(args.groupName!));
    if (g) { groupId = g.id; groupName = g.name; }
  }

  const pool = candidatePool(ctx, groupId);

  // Who shares it. Default to just the user if none named.
  const rawNames = (args.splitAmongNames && args.splitAmongNames.length ? args.splitAmongNames : ["me"]);
  const ids: string[] = [];
  const unresolved: string[] = [];
  for (const raw of rawNames) {
    const id = resolveName(ctx, pool, raw);
    if (id) { if (!ids.includes(id)) ids.push(id); }
    else unresolved.push(raw);
  }
  // Assume the speaker is in the split unless clearly excluded.
  if (!ids.includes(ctx.userId)) ids.unshift(ctx.userId);

  if (unresolved.length) {
    return {
      ok: false,
      error: "unknown_people",
      message: `I couldn't find ${unresolved.join(", ")}. Who did you mean?`,
      unresolved,
    };
  }
  if (ids.length < 1) {
    return { ok: false, error: "no_people", message: "Who's this split with?" };
  }

  const nameFor = (id: string) =>
    id === ctx.userId ? ctx.userName : (pool.find((p) => p.id === id)?.name || "someone");

  const perPerson = Math.round((amount / ids.length) * 100) / 100;
  const people: ResolvedPerson[] = ids.map((id) => ({
    id, name: nameFor(id), isYou: id === ctx.userId, share: perPerson,
  }));
  const youGetBack = Math.round((amount - perPerson) * 100) / 100; // others' shares owed to you
  const currency = args.currency && args.currency.toUpperCase() !== "CAD" ? args.currency.toUpperCase() : "CAD";

  return {
    ok: true,
    proposal: {
      description: (args.description || "Voice split").slice(0, 200),
      amount,
      paidByUserId: ctx.userId,
      splitAmongUserIds: ids,
      groupId,
      currency: currency !== "CAD" ? currency : undefined,
    },
    amount,
    currency,
    description: (args.description || "Voice split").slice(0, 200),
    date: new Date().toISOString(),
    groupId,
    groupName,
    splitLabel: "Split equally",
    perPerson,
    people,
    youGetBack,
  };
}

export interface VoiceSession {
  clientSecret: string;
  expiresAt: number;
  model: string;
  voice: string;
}

/** Mint an ephemeral Realtime session for this user. Returns null if voice is
 *  disabled (no OPENAI_API_KEY) or OpenAI rejects the request. */
export async function createVoiceSession(ctx: UserContext): Promise<VoiceSession | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: MODEL,
          instructions: buildInstructions(ctx),
          audio: {
            // Transcribe the USER's speech too, so the client can render a
            // full chat history (both sides) during the call.
            input: { transcription: { model: "whisper-1" } },
            output: { voice: VOICE },
          },
          tools: TOOLS,
          tool_choice: "auto",
        },
      }),
    });
    if (!res.ok) {
      console.error("[voice] client_secrets failed:", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data: any = await res.json();
    return { clientSecret: data.value, expiresAt: data.expires_at, model: MODEL, voice: VOICE };
  } catch (err) {
    console.error("[voice] createVoiceSession error:", (err as Error)?.message);
    return null;
  }
}
