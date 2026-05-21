/**
 * Onboarding v2 fixtures — pure data, no backend calls, no DB writes.
 *
 * Everything the new onboarding flow renders (demo groups, members, expenses,
 * receipt items, persona-mapped Premium primes) is sourced from this file.
 * Keeping it in one place makes the copy easy to tune without touching any
 * component. Edit here, the whole flow updates.
 *
 * IMPORTANT: nothing in this file talks to lib/simplify.ts or the API.
 * Demo "balances" are pre-computed below and hardcoded as strings; we never
 * recompute balances during onboarding. Real balance math is reserved for
 * real expenses on a real group.
 */

// ─── Personas ─────────────────────────────────────────────────────────────────

export type Persona = "roommate" | "trip" | "couple";

export const PERSONAS: { id: Persona; label: string; emoji: string; tagline: string }[] = [
  {
    id: "roommate",
    label: "Roommates",
    emoji: "🏠",
    tagline: "Rent, utilities, groceries — same crew, same bills, every month.",
  },
  {
    id: "trip",
    label: "Friends on trips & nights out",
    emoji: "✈️",
    tagline: "Big tables, weird splits, occasional flakes.",
  },
  {
    id: "couple",
    label: "My partner / household",
    emoji: "💞",
    tagline: "Just two of us, but it adds up.",
  },
];

// ─── Pain points (Screen 02) ──────────────────────────────────────────────────

export type PainPoint =
  | "slow_payers"
  | "trip_math"
  | "roommate_chaos"
  | "default_treasurer"
  | "other_app_limits";

export const PAIN_POINTS: { id: PainPoint; emoji: string; label: string }[] = [
  { id: "slow_payers",       emoji: "🐌", label: "Friends never pay me back on time" },
  { id: "trip_math",         emoji: "🧮", label: "Group trips are a nightmare to calculate" },
  { id: "roommate_chaos",    emoji: "🏠", label: "My roommate and I split everything and it gets messy" },
  { id: "default_treasurer", emoji: "📒", label: "I'm always the one who tracks for the group" },
  { id: "other_app_limits",  emoji: "🚫", label: "Other apps limit how many expenses I can log" },
];

// ─── Demo group fixtures (Screen 04) ──────────────────────────────────────────
// One demo group per persona. Members + 5 pre-existing expenses each.
// All amounts pre-computed; no math happens at render time.

export interface DemoMember {
  id: string;          // local-only ID, never persisted
  name: string;
  isYou?: boolean;
  avatarColor: string;
}

export interface DemoExpense {
  id: string;
  description: string;
  amount: number;
  paidById: string;        // references DemoMember.id
  splitAmongIds: string[]; // references DemoMember.id[]
  date: string;            // ISO
  note?: string;           // e.g. "split 3 ways"
}

export interface DemoGroup {
  id: string;
  name: string;
  members: DemoMember[];
  expenses: DemoExpense[];
  // Pre-computed display strings — we do NOT recompute these
  balanceRibbonText: string;        // e.g. "You are owed $1,041.13 in total"
  balanceRibbonTone: "owed" | "owe" | "even";
  perPairBalances: { otherName: string; otherColor: string; youOwe: boolean; amount: number }[];
  totalGroupSpend: number;          // pre-computed sum of expenses, used in subtitle
  // Copy bits used elsewhere in the flow
  prefilledExpenseDescription: string;
  prefilledExpenseAmount: number;
  prefilledExpensePaidBy: string;
}

const today = new Date();
const iso = (daysAgo: number) =>
  new Date(today.getTime() - daysAgo * 86_400_000).toISOString();

export const DEMO_GROUPS: Record<Persona, DemoGroup> = {
  roommate: {
    id: "demo-roommate",
    name: "Apartment 4B",
    members: [
      { id: "m-you",    name: "You",    isYou: true, avatarColor: "#0ea596" },
      { id: "m-priya",  name: "Priya",  avatarColor: "#d97757" },
      { id: "m-marcus", name: "Marcus", avatarColor: "#8b5cf6" },
    ],
    expenses: [
      { id: "e1", description: "August rent",       amount: 1650.00, paidById: "m-you",    splitAmongIds: ["m-you","m-priya","m-marcus"], date: iso(14), note: "split 3 ways" },
      { id: "e2", description: "Internet (Aug)",    amount: 90.00,   paidById: "m-priya",  splitAmongIds: ["m-you","m-priya","m-marcus"], date: iso(11), note: "split 3 ways" },
      { id: "e3", description: "Hydro bill",        amount: 142.30,  paidById: "m-marcus", splitAmongIds: ["m-you","m-priya","m-marcus"], date: iso(8),  note: "split 3 ways" },
      { id: "e4", description: "Costco run",        amount: 187.40,  paidById: "m-you",    splitAmongIds: ["m-you","m-priya","m-marcus"], date: iso(4),  note: "split 3 ways" },
      { id: "e5", description: "Cleaner (Aug)",     amount: 120.00,  paidById: "m-priya",  splitAmongIds: ["m-you","m-priya","m-marcus"], date: iso(2),  note: "split 3 ways" },
    ],
    balanceRibbonText: "You are owed $543.13 in total",
    balanceRibbonTone: "owed",
    perPairBalances: [
      { otherName: "Priya",  otherColor: "#d97757", youOwe: false, amount: 271.57 },
      { otherName: "Marcus", otherColor: "#8b5cf6", youOwe: false, amount: 271.57 },
    ],
    totalGroupSpend: 2189.70,
    prefilledExpenseDescription: "Cleaning supplies",
    prefilledExpenseAmount: 34.50,
    prefilledExpensePaidBy: "m-you",
  },
  trip: {
    id: "demo-trip",
    name: "Lisbon Trip",
    members: [
      { id: "m-you",   name: "You",   isYou: true, avatarColor: "#0ea596" },
      { id: "m-aryan", name: "Aryan", avatarColor: "#d97757" },
      { id: "m-maya",  name: "Maya",  avatarColor: "#8b5cf6" },
      { id: "m-sam",   name: "Sam",   avatarColor: "#f59e0b" },
    ],
    expenses: [
      { id: "e1", description: "Airbnb (4 nights)",   amount: 560.00, paidById: "m-you",  splitAmongIds: ["m-you","m-aryan","m-maya","m-sam"], date: iso(12), note: "split 4 ways" },
      { id: "e2", description: "Train to Sintra",     amount: 48.00,  paidById: "m-aryan",splitAmongIds: ["m-you","m-aryan","m-maya","m-sam"], date: iso(9),  note: "split 4 ways" },
      { id: "e3", description: "Beachside lunch",     amount: 94.00,  paidById: "m-you",  splitAmongIds: ["m-you","m-maya"],                    date: iso(7),  note: "split 2 ways" },
      { id: "e4", description: "Castle tickets",      amount: 64.00,  paidById: "m-sam",  splitAmongIds: ["m-you","m-aryan","m-maya","m-sam"], date: iso(5),  note: "split 4 ways" },
      { id: "e5", description: "Tuk-tuk + groceries", amount: 76.50,  paidById: "m-maya", splitAmongIds: ["m-you","m-aryan","m-maya","m-sam"], date: iso(3),  note: "split 4 ways" },
    ],
    balanceRibbonText: "You are owed $400.13 in total",
    balanceRibbonTone: "owed",
    perPairBalances: [
      { otherName: "Aryan", otherColor: "#d97757", youOwe: false, amount: 152.13 },
      { otherName: "Maya",  otherColor: "#8b5cf6", youOwe: false, amount: 105.50 },
      { otherName: "Sam",   otherColor: "#f59e0b", youOwe: false, amount: 142.50 },
    ],
    totalGroupSpend: 842.50,
    prefilledExpenseDescription: "Custard tarts",
    prefilledExpenseAmount: 12.40,
    prefilledExpensePaidBy: "m-you",
  },
  couple: {
    id: "demo-couple",
    name: "Us · Daily Tab",
    members: [
      { id: "m-you",    name: "You",    isYou: true, avatarColor: "#0ea596" },
      { id: "m-jordan", name: "Jordan", avatarColor: "#d97757" },
    ],
    expenses: [
      { id: "e1", description: "Aug groceries",          amount: 124.40, paidById: "m-you",    splitAmongIds: ["m-you","m-jordan"], date: iso(10), note: "split equally" },
      { id: "e2", description: "Hinge date (cocktails)", amount: 58.00,  paidById: "m-you",    splitAmongIds: ["m-you","m-jordan"], date: iso(8),  note: "split equally" },
      { id: "e3", description: "Pet food + litter",      amount: 89.50,  paidById: "m-jordan", splitAmongIds: ["m-you","m-jordan"], date: iso(6),  note: "split equally" },
      { id: "e4", description: "Friday takeout",         amount: 42.00,  paidById: "m-jordan", splitAmongIds: ["m-you","m-jordan"], date: iso(4),  note: "split equally" },
      { id: "e5", description: "Streaming subs (Aug)",   amount: 36.00,  paidById: "m-you",    splitAmongIds: ["m-you","m-jordan"], date: iso(1),  note: "split equally" },
    ],
    balanceRibbonText: "You are owed $14.45 in total",
    balanceRibbonTone: "owed",
    perPairBalances: [
      { otherName: "Jordan", otherColor: "#d97757", youOwe: false, amount: 14.45 },
    ],
    totalGroupSpend: 349.90,
    prefilledExpenseDescription: "Saturday brunch",
    prefilledExpenseAmount: 38.00,
    prefilledExpensePaidBy: "m-jordan",
  },
};

// ─── Demo receipt (the AI Scanner magic moment) ───────────────────────────────
// A small 8-line restaurant receipt — deliberately short so the per-person
// assignment steps stay easy to follow. Assignments are expressed as member
// INDICES (0-based), resolved against the demo group's actual members at
// runtime, so the receipt is persona-agnostic (works for a 2/3/4-person group).
// These indices are only the STARTING checkboxes — the user changes them in
// the assignment steps; the AI never guesses who ate what.

export interface ReceiptItem {
  id: string;
  name: string;
  price: number;
  defaultMemberIndices: number[]; // 0-based positions into group.members
}

export const DEMO_RECEIPT = {
  restaurant: "Bella Trattoria",
  date: "20 May · 8:15 PM",
  cover: "Table 6 · 3 covers",
  items: [
    { id: "r1", name: "Garlic bread",        price: 7.50,  defaultMemberIndices: [0, 1, 2] },
    { id: "r2", name: "Caesar salad",        price: 12.00, defaultMemberIndices: [1] },
    { id: "r3", name: "Margherita pizza",    price: 16.00, defaultMemberIndices: [0, 2] },
    { id: "r4", name: "Spaghetti carbonara", price: 18.50, defaultMemberIndices: [1] },
    { id: "r5", name: "Grilled salmon",      price: 24.00, defaultMemberIndices: [0] },
    { id: "r6", name: "House fries",         price: 6.50,  defaultMemberIndices: [0, 1, 2] },
    { id: "r7", name: "Tiramisù × 2",        price: 14.00, defaultMemberIndices: [1, 2] },
    { id: "r8", name: "Wine (bottle)",       price: 38.00, defaultMemberIndices: [0, 1, 2] },
  ] satisfies ReceiptItem[],
  subtotal: 136.50,
  taxRate: 0.13,
  tax: 17.75,
  tipRate: 0.18,
  tip: 24.57,
  total: 178.82,
};

// ─── Persona-mapped Premium prime (Screen 05 — Wave 2) ────────────────────────
// Captured here so Wave 2 has the copy locked in already.

export const PAYWALL_PRIME_BY_PERSONA: Record<Persona, {
  feature: "ai_scanner" | "recurring" | "auto_reminders";
  featureLabel: string;
  headline: string;
  subhead: string;
}> = {
  roommate: {
    feature: "recurring",
    featureLabel: "Recurring Expenses",
    headline: "Rent. Internet. Hydro. Every month, forever.",
    subhead: "Recurring Expenses logs them automatically — set it once, never touch it again.",
  },
  trip: {
    feature: "ai_scanner",
    featureLabel: "AI Receipt Scanner",
    headline: "That receipt took seconds. Every receipt can.",
    subhead: "AI Receipt Scanner reads any bill — 8 items or 80 — and splits it in seconds, every time.",
  },
  couple: {
    feature: "auto_reminders",
    featureLabel: "Auto-Reminders",
    headline: "Stop being the one who always asks for money back.",
    subhead: "Auto-Reminders nudges them for you — friendly, firm, or funny. You pick the tone.",
  },
};

// Premium pricing (CAD). Display-only in the preview.
export const PREMIUM_PRICE = {
  monthly: "CA$3.99",
  yearly: "CA$29.99",
  trialDays: 30,
};
