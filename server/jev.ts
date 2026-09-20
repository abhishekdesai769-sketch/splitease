// server/jev.ts — Jev (TypeSafe System One) confidence gate for Voice Mode.
//
// The Realtime model extracts a split; Jev is a SECOND, independent typed-
// decision engine that cross-checks the structured proposal against what the
// user actually said and returns a confidence + whether to double-check +
// which field is weakest. Powers the green "looks right" vs amber "check this"
// on the confirm card. Stateless, ~$0.00002/call.
//
// The OPENROUTER_API_KEY stays server-side. If it's missing or Jev errors/
// times out, we return null and the flow proceeds as "high confidence" — Jev
// never blocks a split.

const JEV_MODEL = process.env.JEV_MODEL || "typesafe/jev-1.13";
const JEV_URL = "https://openrouter.ai/api/alpha/decisions";
const TIMEOUT_MS = 6000;

export const JEV_ENABLED = !!process.env.OPENROUTER_API_KEY;

export interface JevState {
  user_said: string;                // recent user utterances (the request)
  proposed: Record<string, unknown>; // the structured split we're about to show
}

export interface JevVerdict {
  verdict: "high" | "check";
  confidence: number;            // 0..1 (normalized)
  weakField: string | null;      // "amount" | "people" | "split" | "date" | null
}

export async function scoreSplit(state: JevState): Promise<JevVerdict | null> {
  if (!process.env.OPENROUTER_API_KEY) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(JEV_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: JEV_MODEL,
        state,
        questions: {
          confidence: {
            type: "score",
            instructions: "How confident are we that the proposed split faithfully matches what the user said?",
            criteria: ["wrong or missing key info", "plausible but ambiguous", "faithfully captures the request"],
          },
          needs_check: {
            type: "choice",
            instructions: "Should the user double-check this split before it's saved?",
            criteria: { no: "clear and unambiguous", yes: "something is ambiguous or possibly misheard" },
          },
          weak_field: {
            type: "choice",
            instructions: "Which part of the split is most likely wrong or uncertain?",
            criteria: { none: "all clear", amount: "the total amount", people: "who is involved", split: "how it's divided", date: "the date" },
          },
        },
      }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const conf = data?.answers?.confidence;
    const check = data?.answers?.needs_check;
    const weak = data?.answers?.weak_field;

    // score is 0..(anchors-1); normalize to 0..1.
    const anchors = conf?.legend ? Object.keys(conf.legend).length : 3;
    const norm = anchors > 1 ? (Number(conf?.score) || 0) / (anchors - 1) : (Number(conf?.score) || 0);
    const confidence = Math.max(0, Math.min(1, norm));

    const needsCheck = check?.choice === "yes";
    const verdict: "high" | "check" = (needsCheck || confidence < 0.6) ? "check" : "high";
    const weakField = weak?.choice && weak.choice !== "none" ? String(weak.choice) : null;

    return { verdict, confidence, weakField };
  } catch {
    return null; // never block the split on Jev
  } finally {
    clearTimeout(t);
  }
}
