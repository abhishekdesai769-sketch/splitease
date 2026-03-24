// Simplify debts algorithm
// Given a list of balances {personId, amount}, where positive = owed money, negative = owes money
// Returns minimal list of transactions to settle all debts

export interface Balance {
  personId: string;
  amount: number; // positive = is owed, negative = owes
}

export interface Settlement {
  from: string;   // person who pays
  to: string;     // person who receives
  amount: number;
}

export function simplifyDebts(balances: Balance[]): Settlement[] {
  // Filter out zero balances
  const nonZero = balances.filter(b => Math.abs(b.amount) > 0.01);

  // Separate into creditors (positive) and debtors (negative) — deep copy to avoid mutating input
  const creditors = nonZero.filter(b => b.amount > 0).map(b => ({ ...b })).sort((a, b) => b.amount - a.amount);
  const debtors = nonZero.filter(b => b.amount < 0).map(b => ({ ...b })).sort((a, b) => a.amount - b.amount);

  const settlements: Settlement[] = [];

  let i = 0; // creditor index
  let j = 0; // debtor index

  while (i < creditors.length && j < debtors.length) {
    const credit = creditors[i].amount;
    const debt = Math.abs(debtors[j].amount);
    const minAmount = Math.min(credit, debt);

    settlements.push({
      from: debtors[j].personId,
      to: creditors[i].personId,
      amount: Math.round(minAmount * 100) / 100,
    });

    creditors[i].amount -= minAmount;
    debtors[j].amount += minAmount;

    if (creditors[i].amount < 0.01) i++;
    if (Math.abs(debtors[j].amount) < 0.01) j++;
  }

  return settlements;
}

// Calculate pairwise balances (who owes whom, without simplification)
// Returns one settlement per unique pair of people
export function calculatePairwiseBalances(
  expenses: { amount: number; paidById: string; splitAmongIds: string[]; splitAmounts?: string | null }[]
): Settlement[] {
  // Track net balance between every pair: pairMap["A->B"] = how much A owes B
  const pairMap = new Map<string, number>();

  for (const expense of expenses) {
    const splitCount = expense.splitAmongIds.length;
    if (splitCount === 0) continue;

    // Parse custom split amounts if available
    let customSplits: Record<string, number> | null = null;
    if (expense.splitAmounts) {
      try { customSplits = JSON.parse(expense.splitAmounts); } catch { /* ignore */ }
    }

    const payer = expense.paidById;

    for (const personId of expense.splitAmongIds) {
      if (personId === payer) continue; // payer doesn't owe themselves

      const share = customSplits
        ? (customSplits[personId] || 0)
        : expense.amount / splitCount;

      // personId owes payer this share
      const key = `${personId}->${payer}`;
      const reverseKey = `${payer}->${personId}`;
      pairMap.set(key, (pairMap.get(key) || 0) + share);
      // Subtract from reverse direction if exists
      pairMap.set(reverseKey, (pairMap.get(reverseKey) || 0) - share);
    }
  }

  // Convert to settlements (net positive direction only)
  const settlements: Settlement[] = [];
  const seen = new Set<string>();

  for (const [key, amount] of pairMap) {
    const [from, to] = key.split("->");
    const pairId = [from, to].sort().join("|");
    if (seen.has(pairId)) continue;
    seen.add(pairId);

    const net = Math.round(amount * 100) / 100;
    if (Math.abs(net) < 0.01) continue;

    if (net > 0) {
      settlements.push({ from, to, amount: net });
    } else {
      settlements.push({ from: to, to: from, amount: Math.abs(net) });
    }
  }

  return settlements;
}

// Calculate net balances from expenses for a group
// Supports both equal splits (splitAmounts = null) and custom splits
export function calculateGroupBalances(
  expenses: { amount: number; paidById: string; splitAmongIds: string[]; splitAmounts?: string | null }[]
): Balance[] {
  const balanceMap = new Map<string, number>();

  for (const expense of expenses) {
    const splitCount = expense.splitAmongIds.length;
    if (splitCount === 0) continue;

    // Parse custom split amounts if available
    let customSplits: Record<string, number> | null = null;
    if (expense.splitAmounts) {
      try { customSplits = JSON.parse(expense.splitAmounts); } catch { /* ignore */ }
    }

    // Payer gets credited the full amount
    balanceMap.set(
      expense.paidById,
      (balanceMap.get(expense.paidById) || 0) + expense.amount
    );

    // Each person in the split gets debited their share
    for (const personId of expense.splitAmongIds) {
      const share = customSplits
        ? (customSplits[personId] || 0)
        : expense.amount / splitCount;

      balanceMap.set(
        personId,
        (balanceMap.get(personId) || 0) - share
      );
    }
  }

  return Array.from(balanceMap.entries()).map(([personId, amount]) => ({
    personId,
    amount: Math.round(amount * 100) / 100,
  }));
}
