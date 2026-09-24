// server/voice.ts — Talk-back voice mode (OpenAI Realtime).
//
// Mints a short-lived ephemeral session token (client_secrets) for everything
// the quick-add pill can do, by voice: splitting bills (whoever paid), settling
// up, and questions about balances and recent expenses. The user's friends +
// groups are injected as context. `propose_split` is resolved server-side;
// `propose_settle_up`, `get_balances` and `get_recent_expenses` are answered by
// the CLIENT from the same balance math the dashboard uses (so "what do I owe?"
// is always live, never stale). The real
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
  const groupList = ctx.groups.length
    ? ctx.groups.map((g) => {
        const members = Object.values(g.memberNames || {}).filter((n) => n !== ctx.userName).join(", ");
        return `${g.name}${members ? ` (with ${members})` : ""}`;
      }).join("; ")
    : "(no groups yet)";
  const today = new Date().toISOString().slice(0, 10);
  return [
    `You are Spliiit's voice assistant. You help ${ctx.userName} with everything in their Spliiit: splitting bills with friends and groups (whoever paid), settling up / recording payments, and answering questions about their balances and past expenses.`,
    `Talk naturally and briefly, like a friend helping out. One short sentence at a time.`,
    `Be precise and practical. NEVER fill silence — if the user pauses or hasn't said anything new, stay quiet and wait. Do not say things like "I'm here whenever you're ready." Never repeat a line you already said. Only speak when you have a real question or something useful to say.`,
    `The current user (the person talking) is "${ctx.userName}". Today is ${today}.`,
    `Their friends are: ${friendList}.`,
    `Their groups are: ${groupList}.`,
    `You ALREADY KNOW all these people. When the user says a first name, match it to the person above automatically — do NOT ask for a full name when there's only one match (e.g. one "Sarah" → use her). Only ask to disambiguate when TWO or more known people share that name, and when you do, offer the specific options ("Do you mean Sarah Miller in Homies, or Sarah Jones?"). Never make the user spell out someone you already know.`,
    `When they describe a bill, work out: the total amount; who is involved (map the names to the friends/groups above); how to split it; and the date.`,
    `SPLIT TYPES: "equal" = divided evenly. "custom" = specific amounts per person — when the user gives any per-person amount (e.g. "Marcus pays $50, the rest split the remaining $50"), use splitType "custom" and provide "shares" as an amount for EVERY person, and the shares MUST sum to the total. Do the arithmetic yourself.`,
    `WHO PAID: usually the user ("${ctx.userName}"), so set paidByName to "${ctx.userName}" unless they say someone else paid ("Raj paid 180 for groceries" → paidByName "Raj"). Anyone they know can be the payer, but the user must be involved: either they paid, or they're in the split. "I paid for Sarah's lunch" = the user paid and Sarah owes all of it (splitType "full_to_one", splitAmongNames ["Sarah"]). "Sarah covered my ticket" = Sarah paid and the user owes all of it (paidByName "Sarah", splitType "full_to_one", splitAmongNames ["${ctx.userName}"]).`,
    `If they don't say whether they're in the split, assume they are unless clearly excluded. The payer is in an even split too unless they say otherwise.`,
    `DESCRIPTION (title): always capture what the bill was FOR (e.g. "sushi dinner", "groceries", "Uber"). If they haven't said what it was for, ask ONE short question ("what was it for?") before proposing. Never label a split just "Voice split".`,
    `DATE: if they mention when it happened ("on Sept 15", "yesterday"), set "date" to that calendar date in YYYY-MM-DD. If they haven't said when, briefly ask "was this today?" — don't silently assume.`,
    `If something essential is missing or a name is ambiguous, ask ONE short question — never guess amounts or names.`,
    `Call propose_split with your best full understanding. If the user then CHANGES anything (amount, people, who pays what, date, description), call propose_split AGAIN with the updated details — don't just repeat that it's ready.`,
    `RECEIPTS WITH ITEMS: if they want a receipt split by item (e.g. "Raj had the wine, we shared the rest"), log it as a few separate splits, one propose_split at a time: propose the first, wait for it to be saved, then propose the next. Say up front how many you'll do.`,
    `SETTLING UP: when they say they paid someone back, someone paid them, or they want to settle up with someone, call propose_settle_up. direction "i_paid_them" = the user handed over money; "they_paid_me" = the other person paid the user. If they give no amount, leave it out and the full balance is used. If they don't say who paid whom, leave direction out and it's worked out from who owes whom. The app shows a card; they tap to record it.`,
    `After I confirm the split was saved, say one short friendly line and ask if there's anything else. If they say no / that's all / thanks, FIRST say a short warm goodbye out loud (like "Sounds good — have a great day!"), and THEN call end_call. Always say the goodbye before ending; never hang up silently.`,
    `BALANCES: when the user asks what they owe, who owes them, their balance with someone, or what's outstanding in a group, call get_balances FIRST and answer ONLY from what it returns — never guess or reuse an earlier number (balances change as splits are saved). Answer the exact question in one or two short sentences with the amounts: overall → say both totals; a person → that one person; a group → just that group. If there are several people, name the top few and the total rather than reading a long list. If they're all settled, say so. To settle a balance, use propose_settle_up.`,
    `HISTORY: for questions about past expenses ("what did I add last?", "what did Raj and I split this week?", "how much did we spend on the Goa trip?"), call get_recent_expenses (with personName and/or groupName if they named one) and answer ONLY from what it returns, briefly.`,
    `You can't delete or edit saved expenses by voice — if asked, say they can do that by opening the expense in the app.`,
    `If the user asks anything unrelated to Spliiit (their splits, balances, payments and expenses), say in one sentence that's all you can help with.`,
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
        paidByName: { type: "string", description: "Who paid — the current user unless they said someone else paid." },
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
    name: "get_balances",
    description:
      "Look up the user's CURRENT balances: totals they owe and are owed, each person's net balance, and a per-group breakdown. Call this for any question about what's owed — never answer balances from memory.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "propose_settle_up",
    description:
      "Propose recording a payment between the user and one person (settling up). The app shows a confirm card; the user taps to record it.",
    parameters: {
      type: "object",
      properties: {
        personName: { type: "string", description: "The other person, as the user said it." },
        amount: { type: "number", description: "Amount paid. Omit to settle the full balance." },
        direction: {
          type: "string",
          enum: ["i_paid_them", "they_paid_me"],
          description: "i_paid_them = the user paid the other person; they_paid_me = the other person paid the user. Omit if not said.",
        },
      },
      required: ["personName"],
    },
  },
  {
    type: "function",
    name: "get_recent_expenses",
    description:
      "Look up the user's recent expenses and payments, newest first, optionally only those involving one person and/or one group. Call this for any question about past expenses.",
    parameters: {
      type: "object",
      properties: {
        personName: { type: "string", description: "Only expenses involving this person." },
        groupName: { type: "string", description: "Only expenses in this group." },
        limit: { type: "number", description: "How many to return (default 10, max 25)." },
      },
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
  paidById: string;
  paidByName: string;
  paidByYou: boolean;
  youGetBack: number;       // total others owe the speaker (when you paid)
  youOwe: number;           // your share owed to the payer (when someone else paid)
}
export interface ResolveError {
  ok: false;
  error: string;
  message: string;
  unresolved?: string[];
}

export function norm(s: string): string {
  return s.trim().toLowerCase();
}
export function firstToken(s: string): string {
  return norm(s).split(/\s+/)[0] || "";
}

/** EVERYONE the speaker knows: themself + friends + members of ALL their
 *  groups. Used so a first name resolves without needing the group named. */
export function candidatePool(ctx: UserContext): Array<{ id: string; name: string }> {
  const pool: Array<{ id: string; name: string }> = [{ id: ctx.userId, name: ctx.userName }];
  for (const f of ctx.friends) if (!pool.some((p) => p.id === f.id)) pool.push({ id: f.id, name: f.name });
  for (const g of ctx.groups) for (const [id, name] of Object.entries(g.memberNames || {})) {
    if (!pool.some((p) => p.id === id)) pool.push({ id, name });
  }
  return pool;
}

/** Where a person is known from — for disambiguation ("Sarah in Homies"). */
function describePerson(ctx: UserContext, id: string): string {
  const groups = ctx.groups.filter((g) => (g.memberIds || []).includes(id)).map((g) => g.name);
  if (groups.length) return `in ${groups.join(" & ")}`;
  if (ctx.friends.some((f) => f.id === id)) return "your friend";
  return "";
}

/** Match a spoken name to the people it could be. Returns 0, 1 (resolved), or
 *  2+ (ambiguous → ask, naming the options). */
export function matchName(ctx: UserContext, pool: Array<{ id: string; name: string }>, raw: string): string[] {
  const n = norm(raw);
  if (!n) return [];
  if (["me", "myself", "i", "im", "i'm", "mine"].includes(n)) return [ctx.userId];
  if (n === norm(ctx.userName) || firstToken(ctx.userName) === firstToken(raw)) return [ctx.userId];
  const exact = pool.filter((c) => norm(c.name) === n);
  if (exact.length) return Array.from(new Set(exact.map((c) => c.id)));
  const byFirst = pool.filter((c) => firstToken(c.name) === n);
  if (byFirst.length) return Array.from(new Set(byFirst.map((c) => c.id)));
  const partial = pool.filter((c) => norm(c.name).startsWith(n) || firstToken(c.name).startsWith(n));
  return Array.from(new Set(partial.map((c) => c.id)));
}

/** Turn a propose_split tool call into a committable proposal + the full,
 *  server-computed breakdown the confirm card renders. The payer is the
 *  speaker unless they named someone else (same as the quick-add pill); the
 *  speaker must be involved either way. */
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
    else {
      // The user named a group we don't have. DON'T silently drop it to a
      // friends split — say so and offer the real groups so they can pick or
      // switch to friends. (Before this, "the Taboo group" just vanished.)
      const list = ctx.groups.length ? ctx.groups.map((x) => x.name).join(", ") : "none yet";
      return {
        ok: false,
        error: "unknown_group",
        message: `I couldn't find a group called "${args.groupName}". Your groups are: ${list}. Which one — or want me to just split it with friends?`,
        unresolved: [args.groupName],
      };
    }
  }

  const pool = candidatePool(ctx);

  // Resolve one spoken name → id, or an ambiguity/not-found error.
  const resolveOne = (raw: string): { id?: string; err?: ResolveError } => {
    const m = matchName(ctx, pool, raw);
    if (m.length === 1) return { id: m[0] };
    if (m.length === 0) {
      return { err: { ok: false, error: "unknown_people", message: `I couldn't find ${raw}. Who did you mean?`, unresolved: [raw] } };
    }
    const opts = m.map((id) => {
      const name = id === ctx.userId ? ctx.userName : (pool.find((p) => p.id === id)?.name || "someone");
      const where = describePerson(ctx, id);
      return where ? `${name} (${where})` : name;
    });
    return { err: { ok: false, error: "ambiguous_person", message: `There are a couple people named ${raw}: ${opts.join(", ")}. Which one?` } };
  };

  // Who paid. The speaker unless they named someone else.
  let payerId = ctx.userId;
  if (args.paidByName && args.paidByName.trim()) {
    const r = resolveOne(args.paidByName);
    if (r.err) return r.err;
    if (r.id) payerId = r.id;
  }
  if (payerId !== ctx.userId) {
    const payerOk = groupId
      ? !!ctx.groups.find((g) => g.id === groupId)?.memberIds?.includes(payerId)
      : ctx.friends.some((f) => f.id === payerId);
    if (!payerOk) {
      const who = pool.find((p) => p.id === payerId)?.name || args.paidByName;
      return {
        ok: false,
        error: "payer_not_connected",
        message: groupName
          ? `${who} isn't in ${groupName}. Which group was it, or did someone else pay?`
          : `${who} isn't on your friends list, so I can only log that inside a group you share. Which group was it?`,
      };
    }
  }

  // Who shares it. Default to just the user if none named.
  const rawNames = (args.splitAmongNames && args.splitAmongNames.length ? args.splitAmongNames : ["me"]);
  const ids: string[] = [];
  for (const raw of rawNames) {
    const r = resolveOne(raw);
    if (r.err) return r.err;
    if (r.id && !ids.includes(r.id)) ids.push(r.id);
  }
  // Assume the speaker (and the payer) are in the split unless clearly
  // excluded — but NOT for full_to_one, where the named people owe it all.
  if (args.splitType !== "full_to_one") {
    if (!ids.includes(payerId)) ids.unshift(payerId);
    if (!ids.includes(ctx.userId)) ids.unshift(ctx.userId);
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
    for (const s of args.shares!) {
      const r = resolveOne(s.name);
      if (r.err) return r.err;
      if (r.id) amounts[r.id] = round2(Number(s.amount) || 0);
    }
    const sum = round2(Object.values(amounts).reduce((a, b) => a + b, 0));
    if (Math.abs(sum - amount) > 0.02) {
      return { ok: false, error: "amount_mismatch", message: `Those add up to ${sum.toFixed(2)}, but the total is ${amount.toFixed(2)}. Which should I use?` };
    }
    const allIds = Array.from(new Set([...ids, ...Object.keys(amounts)]));
    // Custom split: exactly the people given a share (plus the speaker at 0 if
    // they only paid). Don't pad in the payer when they were given no share.
    for (let i = allIds.length - 1; i >= 0; i--) {
      const id = allIds[i];
      if (!(id in amounts) && id === payerId && payerId !== ctx.userId) allIds.splice(i, 1);
    }
    ids.length = 0; ids.push(...allIds);
    people = allIds.map((id) => ({ id, name: nameFor(id), isYou: id === ctx.userId, share: amounts[id] ?? 0 }));
    splitAmounts = amounts;
    splitLabel = "Custom split";
  } else {
    const per = round2(amount / ids.length);
    people = ids.map((id) => ({ id, name: nameFor(id), isYou: id === ctx.userId, share: per }));
    splitLabel = args.splitType === "full_to_one" ? "Owes the full amount" : "Split equally";
  }

  // The speaker has to be part of it — paying, or in the split.
  if (payerId !== ctx.userId && !people.some((p) => p.isYou && p.share > 0)) {
    return { ok: false, error: "not_involved", message: `You're not in that one, so I can't log it for you. Were you part of it?` };
  }

  const paidByYou = payerId === ctx.userId;
  const yourShare = people.find((p) => p.isYou)?.share ?? 0;
  const youGetBack = paidByYou ? round2(amount - yourShare) : 0;   // owed back to you
  const youOwe = paidByYou ? 0 : round2(yourShare);                // you owe the payer
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
      paidByUserId: payerId,
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
    paidById: payerId,
    paidByName: paidByYou ? ctx.userName : nameFor(payerId),
    paidByYou,
    youGetBack,
    youOwe,
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
