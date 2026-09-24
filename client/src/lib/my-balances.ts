// The current user's net balance with each person — the numbers behind the
// dashboard's "Your balances" list, the quick-add pill's balance card, and
// Voice Mode's get_balances tool. One source so they can never disagree.

import { calculateGroupBalances, calculatePairwiseBalances, simplifyDebts, type Balance } from "@/lib/simplify";
import { isEffectivelySettled } from "@/lib/balance-display";

type BalanceExpense = { amount: number; paidById: string; splitAmongIds: string[]; splitAmounts?: string | null; groupId?: string | null };
type BalanceGroup = { id: string; simplifyDebts: boolean };

/** One entry per person the user has an open balance with.
 *  amount > 0 = they owe you; amount < 0 = you owe them. */
export function computeMyNetBalances(expenses: BalanceExpense[], groups: BalanceGroup[], userId: string): Balance[] {
  const allSettlements: { from: string; to: string; amount: number }[] = [];

  // Group expenses — respect each group's simplifyDebts setting
  for (const group of groups) {
    const groupExpenses = expenses.filter((e) => e.groupId === group.id);
    if (groupExpenses.length === 0) continue;
    allSettlements.push(...(group.simplifyDebts
      ? simplifyDebts(calculateGroupBalances(groupExpenses))
      : calculatePairwiseBalances(groupExpenses)));
  }

  // Direct (non-group) expenses — always pairwise
  const directExpenses = expenses.filter((e) => !e.groupId);
  if (directExpenses.length > 0) allSettlements.push(...calculatePairwiseBalances(directExpenses));

  // Merge all settlements with the same person into one net balance per person
  const netMap = new Map<string, number>();
  for (const s of allSettlements) {
    if (s.from === userId) netMap.set(s.to, (netMap.get(s.to) ?? 0) - s.amount);         // you owe them → negative
    else if (s.to === userId) netMap.set(s.from, (netMap.get(s.from) ?? 0) + s.amount);  // they owe you → positive
  }
  const out: Balance[] = [];
  for (const [personId, net] of Array.from(netMap)) {
    // Skip phantom-cent residuals from rounding ("You owe X $0.01").
    if (isEffectivelySettled(net)) continue;
    out.push({ personId, amount: Math.sign(net) * Math.round(Math.abs(net) * 100) / 100 });
  }
  return out;
}
