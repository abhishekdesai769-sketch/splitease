import { useQuery } from "@tanstack/react-query";
import type { Group, Expense, SafeUser } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { UsersRound, Receipt, Users2, TrendingDown, TrendingUp } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { calculateGroupBalances, simplifyDebts } from "@/lib/simplify";

function StatCard({ icon: Icon, label, value, href, color }: { icon: any; label: string; value: string; href?: string; color?: string }) {
  const inner = (
    <Card className={`p-4 ${href ? "hover-elevate cursor-pointer" : ""}`}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className={`w-5 h-5 ${color || "text-primary"}`} />
        </div>
        <div>
          <p className="text-xl font-semibold text-foreground" data-testid={`stat-${label.toLowerCase().replace(/\s/g, "-")}`}>{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
      </div>
    </Card>
  );
  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data: groups = [] } = useQuery<Group[]>({ queryKey: ["/api/groups"] });
  const { data: expenses = [] } = useQuery<Expense[]>({ queryKey: ["/api/expenses"] });
  const { data: friendsList = [] } = useQuery<SafeUser[]>({ queryKey: ["/api/friends"] });

  // Get recent expenses (last 5)
  const recentExpenses = [...expenses]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  // Calculate what the current user owes / is owed across ALL expenses (groups + direct)
  const balances = calculateGroupBalances(expenses);
  const myBalance = balances.find((b) => b.personId === user?.id);
  const youOwe = myBalance && myBalance.amount < 0 ? Math.abs(myBalance.amount) : 0;
  const youAreOwed = myBalance && myBalance.amount > 0 ? myBalance.amount : 0;

  // Settlement summary across all expenses
  const settlements = simplifyDebts(balances);
  const mySettlements = settlements.filter(
    (s) => s.from === user?.id || s.to === user?.id
  );

  // Collect all unique member IDs for name lookup
  const { data: allMembersData } = useQuery<SafeUser[]>({
    queryKey: ["/api/groups/all-members"],
    queryFn: async () => {
      const allMembers: SafeUser[] = [];
      const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
      for (const g of groups) {
        try {
          const res = await fetch(`${API_BASE}/api/groups/${g.id}/members`, { credentials: "include" });
          if (res.ok) {
            const members = await res.json();
            allMembers.push(...members);
          }
        } catch {}
      }
      // Also include friends for direct expense name lookups
      allMembers.push(...friendsList);
      const seen = new Set<string>();
      return allMembers.filter((m) => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });
    },
    enabled: groups.length > 0 || friendsList.length > 0,
  });

  const allMembers = allMembersData || [];
  const getPersonName = (id: string) => {
    if (id === user?.id) return "You";
    return allMembers.find((m) => m.id === id)?.name || "Someone";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Hey, {user?.name?.split(" ")[0] || "there"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Here's your expense overview</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard icon={Users2} label="Friends" value={String(friendsList.length)} href="/friends" />
        <StatCard icon={UsersRound} label="Groups" value={String(groups.length)} href="/groups" />
        <StatCard icon={TrendingDown} label="You Owe" value={`$${youOwe.toFixed(2)}`} color="text-destructive" />
        <StatCard icon={TrendingUp} label="You're Owed" value={`$${youAreOwed.toFixed(2)}`} color="text-primary" />
      </div>

      {/* Your settlements */}
      {mySettlements.length > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-3">Your Settlements</h2>
          <div className="space-y-2">
            {mySettlements.map((s, i) => (
              <Card key={i} className="p-3">
                <p className="text-sm">
                  {s.from === user?.id ? (
                    <>
                      <span className="text-destructive font-medium">You</span>
                      {" pay "}
                      <span className="text-primary font-medium">{getPersonName(s.to)}</span>
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-muted-foreground">{getPersonName(s.from)}</span>
                      {" pays "}
                      <span className="text-primary font-medium">you</span>
                    </>
                  )}
                  {" "}
                  <span className="font-semibold">${s.amount.toFixed(2)}</span>
                </p>
              </Card>
            ))}
          </div>
        </div>
      )}

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

      {/* Empty state */}
      {expenses.length === 0 && groups.length === 0 && friendsList.length === 0 && (
        <Card className="p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Receipt className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-base font-semibold mb-1">Welcome to SplitEase</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Add friends for 1-on-1 splits or create a group for trips and shared expenses.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/friends">
              <span className="text-sm text-primary font-medium cursor-pointer">Add Friends →</span>
            </Link>
            <Link href="/groups">
              <span className="text-sm text-primary font-medium cursor-pointer">Create Group →</span>
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
