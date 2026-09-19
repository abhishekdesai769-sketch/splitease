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
  const today = new Date().toISOString().slice(0, 10);
  return [
    `You are Spliiit's voice assistant. You ONLY help ${ctx.userName} split bills with friends — nothing else.`,
    `Talk naturally and briefly, like a friend helping out. One short sentence at a time.`,
    `Be precise and practical. NEVER fill silence — if the user pauses or hasn't said anything new, stay quiet and wait. Do not say things like "I'm here whenever you're ready." Never repeat a line you already said. Only speak when you have a real question or something useful to say.`,
    `The current user (the person talking) is "${ctx.userName}". Today is ${today}.`,
    `Their friends are: ${friendList}.`,
    `Their groups are: ${groupList}.`,
    `When they describe a bill, work out: the total amount; who is involved (map the names to the friends/groups above); how to split it; and the date.`,
    `SPLIT TYPES: "equal" = divided evenly. "custom" = specific amounts per person — when the user gives any per-person amount (e.g. "Marcus pays $50, the rest split the remaining $50"), use splitType "custom" and provide "shares" as an amount for EVERY person, and the shares MUST sum to the total. Do the arithmetic yourself.`,
    `You ONLY log expenses THIS user paid for. Always set paidByName to "${ctx.userName}". If they say someone ELSE paid, say in one short sentence you can only log splits they paid for — do not call the tool.`,
    `If they don't say whether they're in the split, assume they are unless clearly excluded.`,
    `DATE: if they mention when it happened ("on Sept 15", "yesterday"), set "date" to that calendar date in YYYY-MM-DD. Otherwise use today (${today}).`,
    `If something essential is missing or a name is ambiguous, ask ONE short question — never guess amounts or names.`,
    `Call propose_split with your best full understanding. If the user then CHANGES anything (amount, people, who pays what, date, description), call propose_split AGAIN with the updated details — don't just repeat that it's ready.`,
    `After I confirm the split was saved, say one short friendly line and ask if there's anything else. If they say no / that's all / thanks, call end_call to hang up. If they go quiet after you ask, call end_call.`,
    `If the user asks anything unrelated to splitting a bill, say in one sentence you can only help with splitting bills.`,
  ].join(" ");
}

const TOOLS = [
  {
    type: "function",
    name: "propose_split",
    description:
      "Propose (or re-propose) a bill split for the user to review and confirm. Call again with updated fields whenever the user changes anything.",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "Short human description, e.g. 'Tacofino dinner'." },
        amount: { type: "number", description: "The total bill amount as a number." },
        currency: { type: "string", description: "ISO 4217 code (e.g. USD, EUR). Omit or 'CAD' if not stated." },
        paidByName: { type: "string", description: "Who paid — always the current user." },
        splitAmongNames: {
          type: "array",
          items: { type: "string" },
          description: "Names of everyone sharing the bill (include the current user if involved).",
        },
        groupName: { type: "string", description: "Group name if this belongs to a known group; omit for a friends split." },
        splitType: {
          type: "string",
          enum: ["equal", "custom", "full_to_one"],
          description: "equal = divided evenly; custom = specific per-person amounts (provide shares); full_to_one = one person owes the whole amount.",
        },
        shares: {
          type: "array",
          description: "REQUIRED when splitType is 'custom': each person's exact amount. Must include every person and sum to the total.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              amount: { type: "number" },
            },
            required: ["name", "amount"],
          },
        },
        date: { type: "string", description: "Calendar date of the expense in YYYY-MM-DD. Omit for today." },
      },
      required: ["amount", "paidByName", "splitAmongNames", "splitType"],
    },
  },
  {
    type: "function",
    name: "end_call",
    description: "Hang up the voice call. Call this when the user is done (after saving, if they have nothing else, or if they ask to stop).",
    parameters: { type: "object", properties: {} },
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
  splitType?: "equal" | "custom" | "unequal" | "full_to_one";
  shares?: Array<{ name: string; amount: number }>;
  date?: string;
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
    splitAmounts?: Record<string, number>;  // set for custom splits
    groupId: string | null;
    currency?: string;
    date: string;                           // ISO — honored on commit
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
  // Assume the speaker is in the split unless clearly excluded — but NOT for
  // full_to_one, where someone else owes the whole amount.
  if (args.splitType !== "full_to_one" && !ids.includes(ctx.userId)) ids.unshift(ctx.userId);

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

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const isCustom = (args.splitType === "custom" || args.splitType === "unequal")
    && Array.isArray(args.shares) && args.shares.length > 0;

  let people: ResolvedPerson[];
  let splitAmounts: Record<string, number> | undefined;
  let splitLabel: string;

  if (isCustom) {
    const amounts: Record<string, number> = {};
    const shareUnresolved: string[] = [];
    for (const s of args.shares!) {
      const id = resolveName(ctx, pool, s.name);
      if (!id) { shareUnresolved.push(s.name); continue; }
      amounts[id] = round2(Number(s.amount) || 0);
    }
    if (shareUnresolved.length) {
      return { ok: false, error: "unknown_people", message: `I couldn't find ${shareUnresolved.join(", ")}. Who did you mean?`, unresolved: shareUnresolved };
    }
    const sum = round2(Object.values(amounts).reduce((a, b) => a + b, 0));
    if (Math.abs(sum - amount) > 0.02) {
      return { ok: false, error: "amount_mismatch", message: `Those add up to ${sum.toFixed(2)}, but the total is ${amount.toFixed(2)}. Which should I use?` };
    }
    const allIds = Array.from(new Set([...ids, ...Object.keys(amounts)]));
    ids.length = 0; ids.push(...allIds);
    people = allIds.map((id) => ({ id, name: nameFor(id), isYou: id === ctx.userId, share: amounts[id] ?? 0 }));
    splitAmounts = amounts;
    splitLabel = "Custom split";
  } else {
    const per = round2(amount / ids.length);
    people = ids.map((id) => ({ id, name: nameFor(id), isYou: id === ctx.userId, share: per }));
    splitLabel = args.splitType === "full_to_one" ? "Owes the full amount" : "Split equally";
  }

  const yourShare = people.find((p) => p.isYou)?.share ?? 0;
  const youGetBack = round2(amount - yourShare); // total owed back to the payer
  const perPerson = round2(amount / Math.max(people.length, 1));
  const currency = args.currency && args.currency.toUpperCase() !== "CAD" ? args.currency.toUpperCase() : "CAD";

  // Date: honor a valid YYYY-MM-DD, else today. Noon-UTC avoids TZ off-by-one.
  let dateIso = new Date().toISOString();
  if (args.date && /^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    const d = new Date(args.date + "T12:00:00Z");
    if (!isNaN(d.getTime())) dateIso = d.toISOString();
  }

  const description = (args.description || "Voice split").slice(0, 200);

  return {
    ok: true,
    proposal: {
      description,
      amount,
      paidByUserId: ctx.userId,
      splitAmongUserIds: ids,
      splitAmounts,
      groupId,
      currency: currency !== "CAD" ? currency : undefined,
      date: dateIso,
    },
    amount,
    currency,
    description,
    date: dateIso,
    groupId,
    groupName,
    splitLabel,
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
            input: {
              // Transcribe the USER's speech for the on-screen chat. whisper-1
              // hallucinates (random Korean/other-language text) on near-silence;
              // gpt-4o-mini-transcribe + a hard English hint is far cleaner.
              transcription: { model: "gpt-4o-mini-transcribe", language: "en" },
              // Semantic VAD understands when the user has actually FINISHED a
              // thought vs. just paused — so a couple seconds of silence no
              // longer ends the turn and makes the model fill the gap. Low
              // eagerness = it waits for the user instead of jumping in.
              turn_detection: {
                type: "semantic_vad",
                eagerness: "low",
              },
            },
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
