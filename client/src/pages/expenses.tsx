import { useQuery } from "@tanstack/react-query";
import type { Group, Expense, SafeUser } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Receipt, Download } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Link } from "wouter";

export default function Expenses() {
  const { user } = useAuth();
  const { data: groups = [] } = useQuery<Group[]>({ queryKey: ["/api/groups"] });
  const { data: expenses = [] } = useQuery<Expense[]>({ queryKey: ["/api/expenses"] });
  const { data: friendsList = [] } = useQuery<SafeUser[]>({ queryKey: ["/api/friends"] });

  // Get all members across groups for name lookup
  const { data: allMembersData } = useQuery<SafeUser[]>({
    queryKey: ["/api/groups/all-members-expenses"],
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
      // Also include friends data for direct expense name resolution
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
  const getGroupName = (groupId: string | null) => {
    if (!groupId) return "Direct";
    return groups.find((g) => g.id === groupId)?.name || "Unknown Group";
  };

  const sortedExpenses = [...expenses].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">All Expenses</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {expenses.length} expenses · ${totalExpenses.toFixed(2)} total
          </p>
        </div>
        {expenses.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
              window.open(`${API_BASE}/api/export/expenses`, "_blank");
            }}
            data-testid="export-expenses-btn"
          >
            <Download className="w-4 h-4 mr-1.5" />
            Export CSV
          </Button>
        )}
      </div>

      {sortedExpenses.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Receipt className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-base font-semibold mb-1">No expenses yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Add expenses through Friends or Groups to start tracking.
          </p>
          <Link href="/groups">
            <span className="text-sm text-primary font-medium cursor-pointer">Go to Groups →</span>
          </Link>
        </Card>
      ) : (
        <div className="space-y-2">
          {sortedExpenses.map((expense) => {
            const href = expense.groupId ? `/groups/${expense.groupId}` : "/friends";
            return (
              <Link key={expense.id} href={href}>
                <Card className="p-3 hover-elevate cursor-pointer" data-testid={`expense-item-${expense.id}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Receipt className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{expense.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {getPersonName(expense.paidById)} · {getGroupName(expense.groupId)} · {new Date(expense.date).toLocaleDateString()}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-foreground shrink-0">
                      ${expense.amount.toFixed(2)}
                    </span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
