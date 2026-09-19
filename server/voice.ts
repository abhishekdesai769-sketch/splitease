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

function buildInstructions(ctx: UserContext): string {
  const friendList = ctx.friends.map((f) => f.name).join(", ") || "(no friends added yet)";
  const groupList = ctx.groups.map((g) => g.name).join(", ") || "(no groups yet)";
  return [
    `You are Spliiit's voice assistant. You ONLY help ${ctx.userName} split bills with friends — nothing else.`,
    `Talk naturally and briefly, like a friend helping out. One or two short sentences at a time.`,
    `The current user (the person talking) is "${ctx.userName}".`,
    `Their friends are: ${friendList}.`,
    `Their groups are: ${groupList}.`,
    `When they describe a bill, work out: the total amount; who is involved (map the names they say to the friends or groups listed above); who paid; and how to split it — equally, unequally, or one person owes another the full amount.`,
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
          audio: { output: { voice: VOICE } },
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
