// server/voiceQuota.ts
//
// Cost guardrails for talk-back Voice Mode (OpenAI Realtime audio is the
// expensive part — minutes of audio per session). Two caps, both failing
// GRACEFULLY into the "split by chatting" fallback rather than hard-blocking:
//
//   1. Per-user: N voice sessions/day (default 3).
//   2. Global:   a daily budget (default $30) expressed as a session count
//                via an estimated per-session cost.
//
// Plus: honors the shared AI_MODE emergency kill switch (isGloballyDegraded).
//
// NOTE: counters are in-memory and reset on deploy. That's an acceptable v1
// trade-off for a soft cost guard (a deploy just refills the day's budget a
// little early). Upgrade to a durable per-day table when we next run a
// migration. All limits are env-configurable for emergency tuning.

import { isGloballyDegraded } from "./aiQuota";

const PER_USER_PER_DAY = parseInt(process.env.VOICE_DAILY_PER_USER || "3", 10);
const DAILY_BUDGET_CENTS = parseInt(process.env.VOICE_DAILY_BUDGET_CENTS || "3000", 10); // $30
const EST_SESSION_COST_CENTS = parseInt(process.env.VOICE_EST_SESSION_COST_CENTS || "40", 10); // ~$0.40/session
const GLOBAL_PER_DAY = Math.max(1, Math.floor(DAILY_BUDGET_CENTS / Math.max(1, EST_SESSION_COST_CENTS)));

function utcDate(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

let day = utcDate();
let globalCount = 0;
const perUser = new Map<string, number>();

function rollover() {
  const today = utcDate();
  if (today !== day) {
    day = today;
    globalCount = 0;
    perUser.clear();
  }
}

const CHATTING_HINT = "You can still split by chatting — just type it below.";

export interface VoiceQuotaResult {
  ok: boolean;
  scope?: "user" | "global" | "degraded";
  message?: string;
}

/** Check (without consuming) whether this user may start a voice session. */
export function checkVoiceQuota(userId: string): VoiceQuotaResult {
  rollover();

  const degraded = isGloballyDegraded();
  if (degraded.degraded) {
    return {
      ok: false,
      scope: "degraded",
      message: `Voice is taking a quick breather — heavy usage right now. ${CHATTING_HINT} It'll be back shortly.`,
    };
  }
  if (globalCount >= GLOBAL_PER_DAY) {
    return {
      ok: false,
      scope: "global",
      message: `Voice is taking a quick breather — heavy usage right now. ${CHATTING_HINT} It'll be back soon.`,
    };
  }
  if ((perUser.get(userId) || 0) >= PER_USER_PER_DAY) {
    return {
      ok: false,
      scope: "user",
      message: `You've used today's ${PER_USER_PER_DAY} voice splits. ${CHATTING_HINT} Voice resets tomorrow.`,
    };
  }
  return { ok: true };
}

/** Consume one voice session for this user (call after a session is minted). */
export function recordVoiceSession(userId: string): void {
  rollover();
  globalCount += 1;
  perUser.set(userId, (perUser.get(userId) || 0) + 1);
}

/** For admin/debug. */
export function voiceQuotaSnapshot() {
  rollover();
  return { day, globalCount, globalCap: GLOBAL_PER_DAY, perUserCap: PER_USER_PER_DAY, users: perUser.size };
}
