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
  splitType?: "equal" | "unequal";
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

  const isUnequal = /\b(unequal|unevenly?|not\s+equal(?:ly)?|different\s+amounts?|custom\s+split|split\s+different|divide\s+unequal)\b/i.test(t);

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
      splitType: isUnequal ? "unequal" : "equal",
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
      splitType: isUnequal ? "unequal" : "equal",
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

// ─── Wizard parsing helpers ───────────────────────────────────────────────────
// These are used by the step-by-step voice wizard in VoiceMicButton.

/**
 * Try to match a group or friend name from a transcript.
 * Returns the first match found (groups checked before friends), or null.
 */
export function matchVoiceTarget(
  transcript: string,
  groups: VoiceGroup[],
  friends: VoiceFriend[],
): {
  groupId?: string; groupName?: string; splitAmongIds?: string[];
  friendId?: string; friendName?: string;
} | null {
  const t = transcript.toLowerCase().trim();
  // Groups first (they're usually more specific)
  for (const g of groups) {
    if (t.includes(g.name.toLowerCase())) {
      return { groupId: g.id, groupName: g.name, splitAmongIds: g.memberIds };
    }
  }
  // Friends (full name, then first name if ≥ 3 chars)
  const friend = findFriend(transcript, friends);
  if (friend) return { friendId: friend.id, friendName: friend.name };
  return null;
}

/** Extract a dollar amount from a transcript; returns null if none found. */
export function parseVoiceAmountOnly(transcript: string): number | null {
  return extractAmount(transcript) ?? null;
}

/**
 * Extract a plain expense description from a transcript.
 * In wizard context the transcript is ONLY the description answer,
 * so we just clean up filler words.
 */
export function parseVoiceDescription(transcript: string): string {
  const cleaned = transcript
    .replace(/^(it('s| was| is)?|for|the|a|an)\s+/i, "")
    .replace(/\s+(please|thanks|thank you)\.?$/i, "")
    .trim();
  if (!cleaned || cleaned.length < 2) return "Expense";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Detect whether the user said "equally" or "unequally".
 * Returns null if neither is clear (caller should re-ask).
 */
export function parseVoiceSplitType(transcript: string): "equal" | "unequal" | null {
  const t = transcript.toLowerCase();
  if (/\b(equal|equally|evenly?|same|fifty.fifty|half|halves?)\b/.test(t)) return "equal";
  if (/\b(unequal|uneven|different|custom|split\s+different|not\s+equal|custom\s+amounts?)\b/.test(t)) return "unequal";
  return null;
}

/**
 * Parse who to split between from a group-member context.
 * Understands "everyone", "everyone except [names]", or a list of names.
 * Returns an array of member IDs, or null if nothing matched.
 */
export function parseVoiceMembers(
  transcript: string,
  members: { id: string; name: string }[],
): string[] | null {
  const t = transcript.toLowerCase();
  const isEveryone = /\b(everyone|everybody|all|whole\s+group|all\s+of\s+(us|them))\b/.test(t);
  const hasExcept = /\b(except|excluding|not|minus|without)\b/.test(t);

  if (isEveryone && !hasExcept) {
    return members.map(m => m.id);
  }

  if (isEveryone && hasExcept) {
    // "everyone except Sarah" → all minus mentioned names
    const excluded = members.filter(m => t.includes(m.name.toLowerCase()));
    const remaining = members.filter(m => !excluded.find(e => e.id === m.id));
    return remaining.length > 0 ? remaining.map(m => m.id) : null;
  }

  // Specific names mentioned
  const matched = members.filter(m => t.includes(m.name.toLowerCase()));
  return matched.length > 0 ? matched.map(m => m.id) : null;
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
