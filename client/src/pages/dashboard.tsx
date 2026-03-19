import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Person, Group, Expense } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Users, UsersRound, Receipt, ArrowUpDown } from "lucide-react";
import { Link } from "wouter";
import { calculateGroupBalances, simplifyDebts } from "@/lib/simplify";

function StatCard({ icon: Icon, label, value, href }: { icon: any; label: string; value: number; href: string }) {
  return (
    <Link href={href}>
      <Card className="p-4 hover-elevate cursor-pointer">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-semibold text-foreground" data-testid={`stat-${label.toLowerCase()}`}>{value}</p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
        </div>
      </Card>
    </Link>
  );
}

export default function Dashboard() {
  const { data: people = [] } = useQuery<Person[]>({ queryKey: ["/api/people"] });
  const { data: groups = [] } = useQuery<Group[]>({ queryKey: ["/api/groups"] });
  const { data: expenses = [] } = useQuery<Expense[]>({ queryKey: ["/api/expenses"] });

  const totalSpent = expenses.reduce((sum, e) => sum + e.amount, 0);

  // Get recent expenses (last 5)
  const recentExpenses = [...expenses]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  // Quick overall balance summary
  const balances = calculateGroupBalances(expenses);
  const settlements = simplifyDebts(balances);

  const getPersonName = (id: string) => people.find(p => p.id === id)?.name || "Unknown";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Overview of your splits</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard icon={Users} label="Friends" value={people.length} href="/friends" />
        <StatCard icon={UsersRound} label="Groups" value={groups.length} href="/groups" />
        <StatCard icon={Receipt} label="Expenses" value={expenses.length} href="/expenses" />
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <ArrowUpDown className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-foreground" data-testid="stat-total">${totalSpent.toFixed(2)}</p>
              <p className="text-sm text-muted-foreground">Total Split</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Recent expenses */}
      {recentExpenses.length > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-3">Recent Expenses</h2>
          <div className="space-y-2">
            {recentExpenses.map((expense) => (
              <Card key={expense.id} className="p-3 flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{expense.description}</p>
                  <p className="text-xs text-muted-foreground">
                    Paid by {getPersonName(expense.paidById)} · {new Date(expense.date).toLocaleDateString()}
                  </p>
                </div>
                <p className="text-sm font-semibold text-primary shrink-0">${expense.amount.toFixed(2)}</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Settlement summary */}
      {settlements.length > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-3">Settlement Summary</h2>
          <div className="space-y-2">
            {settlements.map((s, i) => (
              <Card key={i} className="p-3">
                <p className="text-sm">
                  <span className="font-medium text-destructive">{getPersonName(s.from)}</span>
                  {" owes "}
                  <span className="font-medium text-primary">{getPersonName(s.to)}</span>
                  {" "}
                  <span className="font-semibold">${s.amount.toFixed(2)}</span>
                </p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {expenses.length === 0 && people.length === 0 && (
        <Card className="p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Receipt className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-base font-semibold mb-1">No expenses yet</h3>
          <p className="text-sm text-muted-foreground mb-4">Start by adding some friends, then add your first expense.</p>
          <Link href="/friends">
            <span className="text-sm text-primary font-medium cursor-pointer">Add Friends →</span>
          </Link>
        </Card>
      )}
    </div>
  );
}
