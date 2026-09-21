// server/voiceLog.ts — durable, queryable record of what Voice Mode actually did.
//
// Every voice turn (a /preview) and every save (a /commit) writes one row to
// `voice_interactions`. This is the record we were missing: before it, Jev's
// verdicts were computed on each turn and thrown away, so "was it accurate?"
// could only be reconstructed from OpenRouter + Render. Now it's one SQL query.
//
// DESIGN RULE: logging must NEVER affect the call. Every write is wrapped so a
// DB hiccup can't fail a preview/commit — on error we swallow + console.error.
// No file bytes are stored; receipts are already transcribed to text upstream.

import { db } from "./db";
import { voiceInteractions } from "@shared/schema";

export interface VoiceTurnLog {
  userId: string;
  callId?: string | null;
  transcript?: string | null;
  modelArgs?: unknown;                    // raw propose_split args (per-turn intent); stringified
  proposedCard?: unknown;                 // stringified to JSON before storing
  jevVerdict?: "high" | "check" | null;
  jevConfidence?: number | null;
  jevWeakField?: string | null;
  assistantAsked?: boolean;
  toolName?: string | null;
}

/** Log a single voice "preview" turn (proposal + Jev verdict). Never throws. */
export async function logVoiceTurn(entry: VoiceTurnLog): Promise<void> {
  try {
    await db.insert(voiceInteractions).values({
      userId: entry.userId,
      callId: entry.callId ?? null,
      kind: "preview",
      transcript: entry.transcript ? entry.transcript.slice(0, 4000) : null,
      modelArgs: entry.modelArgs != null ? JSON.stringify(entry.modelArgs).slice(0, 4000) : null,
      clarifyError: null,
      proposedCard: entry.proposedCard != null ? JSON.stringify(entry.proposedCard).slice(0, 8000) : null,
      jevVerdict: entry.jevVerdict ?? null,
      jevConfidence: typeof entry.jevConfidence === "number" ? entry.jevConfidence : null,
      jevWeakField: entry.jevWeakField ?? null,
      assistantAsked: !!entry.assistantAsked,
      toolName: entry.toolName ?? null,
      expenseId: null,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[voiceLog] logVoiceTurn failed (non-fatal):", err);
  }
}

/** Log a turn where the model's proposal couldn't be resolved (unknown group /
 *  person / bad amount) so the assistant had to ASK instead of showing a card.
 *  These are the most useful failures to see — before, they were invisible.
 *  Never throws. */
export async function logVoiceClarification(entry: {
  userId: string;
  callId?: string | null;
  transcript?: string | null;
  modelArgs?: unknown;
  clarifyError?: string | null;
}): Promise<void> {
  try {
    await db.insert(voiceInteractions).values({
      userId: entry.userId,
      callId: entry.callId ?? null,
      kind: "clarification",
      transcript: entry.transcript ? entry.transcript.slice(0, 4000) : null,
      modelArgs: entry.modelArgs != null ? JSON.stringify(entry.modelArgs).slice(0, 4000) : null,
      clarifyError: entry.clarifyError ?? null,
      proposedCard: null,
      jevVerdict: null,
      jevConfidence: null,
      jevWeakField: null,
      assistantAsked: true, // by definition the assistant had to ask
      toolName: "propose_split",
      expenseId: null,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[voiceLog] logVoiceClarification failed (non-fatal):", err);
  }
}

/** Log a successful voice "commit" (the split the user confirmed). Never throws. */
export async function logVoiceCommit(entry: {
  userId: string;
  callId?: string | null;
  proposedCard?: unknown;
  expenseId?: string | null;
}): Promise<void> {
  try {
    await db.insert(voiceInteractions).values({
      userId: entry.userId,
      callId: entry.callId ?? null,
      kind: "commit",
      transcript: null,
      proposedCard: entry.proposedCard != null ? JSON.stringify(entry.proposedCard).slice(0, 8000) : null,
      jevVerdict: null,
      jevConfidence: null,
      jevWeakField: null,
      assistantAsked: false,
      toolName: "commit",
      expenseId: entry.expenseId ?? null,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[voiceLog] logVoiceCommit failed (non-fatal):", err);
  }
}
