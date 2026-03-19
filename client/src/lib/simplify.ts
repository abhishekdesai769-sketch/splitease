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

// Calculate net balances from expenses for a group
export function calculateGroupBalances(
  expenses: { amount: number; paidById: string; splitAmongIds: string[] }[]
): Balance[] {
  const balanceMap = new Map<string, number>();
  
  for (const expense of expenses) {
    const splitCount = expense.splitAmongIds.length;
    if (splitCount === 0) continue;
    
    const perPerson = expense.amount / splitCount;
    
    // Payer gets credited the full amount
    balanceMap.set(
      expense.paidById,
      (balanceMap.get(expense.paidById) || 0) + expense.amount
    );
    
    // Each person in the split gets debited their share
    for (const personId of expense.splitAmongIds) {
      balanceMap.set(
        personId,
        (balanceMap.get(personId) || 0) - perPerson
      );
    }
  }
  
  return Array.from(balanceMap.entries()).map(([personId, amount]) => ({
    personId,
    amount: Math.round(amount * 100) / 100,
  }));
}
