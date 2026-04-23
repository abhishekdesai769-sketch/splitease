/**
 * voiceParser.ts — rule-based voice intent + entity parser
 *
 * Pure functions only — no API calls, no side effects.
 * This is the "brain" of Voice Mode: transcript → structured intent.
 *
 * Architecture: on-device, deterministic, $0 cost.
 * No AI required for the supported intents.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type IntentType =
  | "add_expense"   // "add $50 for groceries" — generic, needs split target
  | "split_friend"  // "split $80 with Sarah" — explicit friend split
  | "split_group"   // "add $30 to roommates for dinner" — explicit group split
  | "ask_balance"   // "what do I owe" / "who owes me"
  | "navigate"      // "go to groups" / "open friends"
  | "cancel"        // "cancel" / "never mind" / "stop"
  | "unknown";      // couldn't parse anything useful

export interface VoiceFriend {
  id: string;
  name: string;
}

export interface VoiceGroup {
  id: string;
  name: string;
  memberIds: string[];
}

export interface VoiceContext {
  currentUserId: string;
  friends: VoiceFriend[];
  groups: VoiceGroup[];
  defaultCurrency: string; // e.g. "CAD"
}

export interface ParsedVoiceIntent {
  type: IntentType;
  transcript: string;

  // ── Expense fields (split_friend | split_group | add_expense) ──
  amount?: number;
  description?: string;
  paidById?: string;       // defaults to currentUserId
  splitAmongIds?: string[];
  groupId?: string;
  friendId?: string;
  friendName?: string;
  groupName?: string;

  // ── Navigation ──
  destination?: string; // e.g. "/groups", "/friends"

  // ── Meta ──
  confidence: "high" | "low";
}

// ─── Navigation keyword → route ───────────────────────────────────────────────

const NAV_KEYWORDS: [RegExp, string][] = [
  [/\b(home|dashboard)\b/i, "/"],
  [/\bfriends?\b/i, "/friends"],
  [/\bgroups?\b/i, "/groups"],
  [/\bexpenses?\b/i, "/expenses"],
  [/\b(upgrade|premium)\b/i, "/upgrade"],
];

const NAV_TRIGGER = /\b(go|open|show|navigate|take me|switch|view)\b/i;

// ─── Balance query patterns ───────────────────────────────────────────────────

const BALANCE_PATTERNS = [
  /what (do|did) i owe/i,
  /how much (do|did) i owe/i,
  /who owes me/i,
  /my (total\s+)?balance/i,
  /what.{0,20}owe/i,
  /owe.{0,10}me/i,
  /\bbalance\b/i,
  /what.{0,20}(i'm owed|i am owed)/i,
];

// ─── Amount extraction ────────────────────────────────────────────────────────

function extractAmount(text: string): number | undefined {
  const patterns = [
    /\$\s*(\d+(?:[.,]\d{1,2})?)/,                            // $50 / $50.00
    /(\d+(?:[.,]\d{1,2})?)\s*(?:dollars?|bucks?|cad|usd)/i,  // 50 dollars
    /(\d+(?:[.,]\d{1,2})?)/,                                   // bare number (last resort)
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const val = parseFloat(m[1].replace(",", "."));
      if (!isNaN(val) && val > 0 && val < 1_000_000) return val;
    }
  }
  return undefined;
}

// ─── Person matching (fuzzy) ──────────────────────────────────────────────────

function findFriend(text: string, friends: VoiceFriend[]): VoiceFriend | undefined {
  const t = text.toLowerCase();
  // Full name match first, then first-name only (≥ 3 chars to avoid false positives)
  return (
    friends.find((f) => t.includes(f.name.toLowerCase())) ||
    friends.find((f) => {
      const first = f.name.split(" ")[0].toLowerCase();
      return first.length >= 3 && t.includes(first);
    })
  );
}

// ─── Group matching ───────────────────────────────────────────────────────────

function findGroup(text: string, groups: VoiceGroup[]): VoiceGroup | undefined {
  const t = text.toLowerCase();
  return groups.find((g) => t.includes(g.name.toLowerCase()));
}

// ─── Description extraction ───────────────────────────────────────────────────

function extractDescription(
  transcript: string,
  personName?: string,
  groupName?: string
): string {
  // Prefer explicit "for <description>" pattern
  const forMatch = transcript.match(/\bfor\s+(.+?)(?:\s+(?:with|in|to)\b.*)?$/i);
  if (forMatch) {
    let desc = forMatch[1].trim();
    if (groupName) desc = desc.replace(new RegExp(groupName, "gi"), "").trim();
    if (personName) desc = desc.replace(new RegExp(personName, "gi"), "").trim();
    desc = desc.replace(/\s+/g, " ").trim();
    if (desc.length > 1) return capitalise(desc);
  }

  // Strip noise and return what's left
  let remaining = transcript
    .replace(/\$?\d+(?:[.,]\d{1,2})?/g, "")
    .replace(/\b(dollars?|bucks?|cad|usd)\b/gi, "")
    .replace(/\b(add|split|log|record|create|new|expense|a|an|the|with|to|in|for|and|my)\b/gi, "")
    .replace(personName ? new RegExp(`\\b${personName}\\b`, "gi") : /(?!x)x/, "")
    .replace(groupName ? new RegExp(`\\b${groupName}\\b`, "gi") : /(?!x)x/, "")
    .replace(/\bgroup\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return remaining.length > 1 ? capitalise(remaining) : "Expense";
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ─── Main parse function ──────────────────────────────────────────────────────

export function parseVoiceIntent(
  rawTranscript: string,
  ctx: VoiceContext
): ParsedVoiceIntent {
  const transcript = rawTranscript.trim();
  const t = transcript.toLowerCase();

  // 1. Cancel
  if (/\b(cancel|never ?mind|stop|quit|abort|exit|close)\b/i.test(t)) {
    return { type: "cancel", transcript, confidence: "high" };
  }

  // 2. Navigate (must have a navigation trigger word + destination)
  for (const [pattern, route] of NAV_KEYWORDS) {
    if (pattern.test(t) && NAV_TRIGGER.test(t)) {
      return { type: "navigate", transcript, destination: route, confidence: "high" };
    }
  }

  // 3. Balance query
  if (BALANCE_PATTERNS.some((p) => p.test(t))) {
    return { type: "ask_balance", transcript, confidence: "high" };
  }

  // 4. Extract entities
  const amount = extractAmount(transcript);
  const friend = findFriend(transcript, ctx.friends);
  const group = findGroup(transcript, ctx.groups);

  // 5. Group expense (group mentioned)
  if (group) {
    const description = extractDescription(transcript, undefined, group.name);
    return {
      type: "split_group",
      transcript,
      amount,
      description,
      paidById: ctx.currentUserId,
      splitAmongIds: group.memberIds,
      groupId: group.id,
      groupName: group.name,
      confidence: amount ? "high" : "low",
    };
  }

  // 6. Friend expense (friend mentioned)
  if (friend) {
    const description = extractDescription(transcript, friend.name, undefined);
    return {
      type: "split_friend",
      transcript,
      amount,
      description,
      paidById: ctx.currentUserId,
      splitAmongIds: [ctx.currentUserId, friend.id],
      friendId: friend.id,
      friendName: friend.name,
      confidence: amount ? "high" : "low",
    };
  }

  // 7. Generic expense (has amount but no split target)
  if (amount) {
    const description = extractDescription(transcript);
    return {
      type: "add_expense",
      transcript,
      amount,
      description,
      paidById: ctx.currentUserId,
      confidence: "low", // needs a split target — show warning in UI
    };
  }

  // 8. Unknown
  return { type: "unknown", transcript, confidence: "low" };
}

// ─── Helpers used by VoiceMicButton ──────────────────────────────────────────

/** Format an amount for display in voice confirmation cards */
export function formatVoiceAmount(amount: number, currency: string): string {
  const symbols: Record<string, string> = {
    CAD: "CA$", USD: "US$", EUR: "€", GBP: "£",
    AUD: "A$", INR: "₹", MXN: "MX$", JPY: "¥",
    CHF: "CHF", NZD: "NZ$", SGD: "S$", HKD: "HK$",
  };
  const sym = symbols[currency] ?? currency + " ";
  return `${sym}${amount.toFixed(2)}`;
}

/** Returns example utterances shown in the listening sheet hint */
export const VOICE_EXAMPLES = [
  "Add $50 for groceries",
  "Split $30 with Sarah",
  "Log $120 in Roommates for rent",
  "What do I owe?",
  "Go to groups",
];
