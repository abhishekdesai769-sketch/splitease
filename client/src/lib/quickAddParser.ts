/**
 * quickAddParser.ts — typed text → structured card for the dashboard quick-add bar.
 *
 * Pure, synchronous, on-device. Runs on every keystroke, so it must stay cheap
 * and must never guess a person from a half-typed word: names only match as
 * whole words ("pri" never becomes Priya).
 *
 * Understands:
 *   "dinner 60 with priya and raj"         → expense, split me + Priya + Raj
 *   "uber 45 goa trip"                     → expense, split the whole group
 *   "uber 45 goa trip with priya"          → expense in the group, me + Priya only
 *   "raj paid 180 for groceries"           → expense paid by Raj
 *   "paid priya 80" / "priya paid me 80"   → settle up
 *   "what does raj owe" / "balance with raj" → balance lookup
 */

export interface QuickPerson { id: string; name: string }
export interface QuickGroup { id: string; name: string; memberIds: string[] }

export interface QuickContext {
  meId: string;
  friends: QuickPerson[];
  groups: QuickGroup[];
  /** Everyone else the user knows (friends + fellow group members), for names. */
  people?: QuickPerson[];
}

export type QuickIntent =
  | {
      type: "expense";
      amount: number | null;
      description: string | null;
      payerId: string;
      splitIds: string[];       // always includes the payer
      groupId: string | null;
    }
  | { type: "settle"; friendId: string; amount: number | null; friendIsPayer: boolean }
  | { type: "balance"; personId: string | null }
  | { type: "unknown" };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (w: string) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc(w)}(?=$|[^\\p{L}\\p{N}])`, "iu");

// Longest-first so "Priya Shah" wins over "Priya" and the full name is stripped.
function nameKeys(p: QuickPerson): string[] {
  const full = p.name.trim().toLowerCase();
  const first = full.split(/\s+/)[0];
  return first.length >= 3 && first !== full ? [full, first] : [full];
}

function findPeople(text: string, people: QuickPerson[]): { person: QuickPerson; key: string; index: number }[] {
  const hits: { person: QuickPerson; key: string; index: number }[] = [];
  for (const p of people) {
    for (const key of nameKeys(p)) {
      const m = wordRe(key).exec(text);
      if (m) { hits.push({ person: p, key, index: m.index }); break; }
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

const AMOUNT_RE = /(?:[$₹€£¥]\s?)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?!\s*(?:am|pm|st|nd|rd|th)\b)/i;

function extractAmount(text: string): { amount: number; match: string } | null {
  const m = AMOUNT_RE.exec(text);
  if (!m) return null;
  const amount = parseFloat(m[1].replace(/,/g, "") + (m[2] ? `.${m[2]}` : ""));
  if (!(amount > 0 && amount <= 1_000_000)) return null;
  return { amount, match: m[0] };
}

const FILLER = /\b(add|log|spent|spend|split|between|equally|evenly|with|and|for|on|at|in|to|by|paid|pay|the|a|an|my|me|i|we|us|of|dollars?|bucks|cad|usd|inr|rs)\b/gi;

function describe(text: string, strip: string[]): string | null {
  let d = ` ${text} `;
  for (const s of strip) d = d.replace(new RegExp(esc(s), "gi"), " ");
  d = d.replace(FILLER, " ").replace(/[,&+]/g, " ").replace(/\s+/g, " ").trim();
  return d.length > 1 ? d.charAt(0).toUpperCase() + d.slice(1) : null;
}

export function parseQuickAdd(raw: string, ctx: QuickContext): QuickIntent | null {
  const text = raw.trim();
  if (!text) return null;
  const t = text.toLowerCase();

  const friendIds = new Set(ctx.friends.map((f) => f.id));
  const everyone = Array.from(
    new Map([...ctx.friends, ...(ctx.people ?? [])].filter((p) => p.id !== ctx.meId).map((p) => [p.id, p])).values(),
  );

  let groupHit = [...ctx.groups]
    .sort((a, b) => b.name.length - a.name.length)
    .find((g) => g.name.trim().length > 1 && wordRe(g.name.trim().toLowerCase()).test(t));

  // Group names can contain digits ("Apt 4B") or people's names ("Sarah's bday"),
  // so read amounts and names after removing the group name.
  const withoutGroup = (g?: QuickGroup) => (g ? t.replace(new RegExp(esc(g.name.toLowerCase()), "g"), " ") : t);
  let personHits = findPeople(withoutGroup(groupHit), everyone);
  // A named person outside the matched group means the "group" was really just a
  // word ("dinner with srushti" when there's also a group called "Dinner"):
  // the people the user named win, and the word goes back into the description.
  if (groupHit && personHits.some((h) => !groupHit!.memberIds.includes(h.person.id))) {
    groupHit = undefined;
    personHits = findPeople(t, everyone);
  }
  const amt = extractAmount(withoutGroup(groupHit));
  const friendHits = findPeople(t, ctx.friends);
  const firstFriend = friendHits[0]?.person ?? null;

  // ── Balance question ──
  if (/^(what|how much|does|do|who)\b.*\bowe/.test(t) || /\bbalance\b/.test(t)) {
    return { type: "balance", personId: firstFriend?.id ?? null };
  }

  // ── Settle up: "paid priya 80", "settle with priya 80", "priya paid me 80" ──
  const settleOut = /^(?:i\s+)?(?:paid|pay|sent|settled?(?:\s+up)?(?:\s+with)?)\s+(.+)$/.exec(t);
  if (settleOut && firstFriend && friendHits[0].index <= settleOut[0].length - settleOut[1].length + 1) {
    return { type: "settle", friendId: firstFriend.id, amount: amt?.amount ?? null, friendIsPayer: false };
  }
  if (firstFriend && new RegExp(`^${esc(friendHits[0].key)}\\s+(?:paid|sent|settled)\\s+me\\b`).test(t)) {
    return { type: "settle", friendId: firstFriend.id, amount: amt?.amount ?? null, friendIsPayer: true };
  }

  // ── Expense ──
  // Someone named who isn't a direct friend (only a fellow group member) can
  // only be split with inside a group: use the smallest group you share.
  let impliedGroup: QuickGroup | undefined;
  if (!groupHit && personHits.some((h) => !friendIds.has(h.person.id))) {
    const need = [ctx.meId, ...personHits.map((h) => h.person.id)];
    impliedGroup = ctx.groups
      .filter((g) => need.every((id) => g.memberIds.includes(id)))
      .sort((a, b) => a.memberIds.length - b.memberIds.length)[0];
    if (!impliedGroup) personHits = personHits.filter((h) => friendIds.has(h.person.id));
  }

  // Payer: "raj paid …" at the start, or "paid by raj" anywhere.
  let payerId = ctx.meId;
  const lead = personHits[0];
  const leadPaid = lead && lead.index === 0 && new RegExp(`^${esc(lead.key)}\\s+paid\\b`).test(t);
  const paidBy = /\bpaid by\s+(\S+(?:\s+\S+)?)/.exec(t);
  if (leadPaid) payerId = lead.person.id;
  else if (paidBy) {
    const hit = findPeople(paidBy[1], everyone)[0];
    if (hit) payerId = hit.person.id;
  }

  const named = personHits.map((h) => h.person.id);
  let splitIds: string[];
  let groupId: string | null = null;
  if (groupHit) {
    groupId = groupHit.id;
    // Named members narrow the split; otherwise it's the whole group.
    splitIds = named.length ? [ctx.meId, ...named] : [...groupHit.memberIds];
  } else if (impliedGroup) {
    groupId = impliedGroup.id;
    splitIds = [ctx.meId, ...named];
  } else {
    splitIds = [ctx.meId, ...named];
  }
  if (!splitIds.includes(payerId)) splitIds.push(payerId);
  splitIds = Array.from(new Set(splitIds));

  if (!amt && splitIds.length < 2 && !groupId) return { type: "unknown" };

  const strip = [
    ...(amt ? [amt.match] : []),
    ...(groupHit ? [groupHit.name] : []),
    ...personHits.map((h) => h.key),
  ];
  // "dinner 90" in a group called "Dinner": the group name is the description too.
  const description = describe(t, strip) ?? (groupHit ? groupHit.name.charAt(0).toUpperCase() + groupHit.name.slice(1) : null);
  return {
    type: "expense",
    amount: amt?.amount ?? null,
    description,
    payerId,
    splitIds,
    groupId,
  };
}
