import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Group, Expense, SafeUser } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Receipt, FileDown, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { formatMoney } from "@/components/CurrencySelector";

export default function Expenses() {
  const { user } = useAuth();
  const { toast } = useToast();
  const userCurrency = user?.defaultCurrency;
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
  // "You paid" / "Nikhil paid" — first name keeps the subtitle to one line.
  const getPayerLabel = (id: string) => {
    const name = getPersonName(id);
    return name === "You" ? "You paid" : `${name.split(" ")[0]} paid`;
  };
  const getGroupName = (groupId: string | null) => {
    if (!groupId) return "Direct";
    return groups.find((g) => g.id === groupId)?.name || "Unknown Group";
  };

  const sortedExpenses = [...expenses].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // Group the (already date-desc) expenses into months for clean scanning.
  const monthGroups: { key: string; label: string; items: Expense[] }[] = [];
  const monthIndex: Record<string, number> = {};
  for (const e of sortedExpenses) {
    const d = new Date(e.date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (monthIndex[key] === undefined) {
      monthIndex[key] = monthGroups.length;
      monthGroups.push({
        key,
        label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
        items: [],
      });
    }
    monthGroups[monthIndex[key]].items.push(e);
  }

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  const exportMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/export/expenses", { scope: "all" });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Export sent", description: data.message || `CSV sent to your email` });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-5xl tracking-tight leading-none">Expenses</h1>
          <p className="text-sm text-muted-foreground mt-1.5 font-mono">
            {expenses.length} · {formatMoney(totalExpenses, userCurrency)}
          </p>
        </div>
        {expenses.length > 0 && (
          <Button
            size="icon"
            variant="outline"
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
            className="rounded-full h-11 w-11 shrink-0"
            aria-label="Export expenses as CSV to your email"
            title="Export CSV to email"
            data-testid="export-expenses-btn"
          >
            {exportMutation.isPending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <FileDown className="w-5 h-5" />
            )}
          </Button>
        )}
      </div>

      {/* Hairline separates the page header from the list. */}
      {sortedExpenses.length > 0 && <div className="h-px bg-border" />}

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
        <div>
          {monthGroups.map((mg) => (
            <div key={mg.key} className="mt-6 first:mt-1">
              <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-muted-foreground mb-1 px-0.5">
                {mg.label}
              </p>
              {mg.items.map((expense) => {
                const href = expense.groupId ? `/groups/${expense.groupId}` : "/friends";
                const d = new Date(expense.date);
                const mo = d.toLocaleDateString("en-US", { month: "short" });
                const dy = d.getDate();
                return (
                  <Link key={expense.id} href={href}>
                    <div
                      className="flex items-center gap-3.5 py-[15px] border-b border-border cursor-pointer transition-colors hover:bg-foreground/[0.025] active:bg-foreground/[0.05]"
                      data-testid={`expense-item-${expense.id}`}
                    >
                      <div className="w-11 text-center shrink-0">
                        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{mo}</div>
                        <div className="font-serif text-[21px] leading-none">{dy}</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[15.5px] font-semibold tracking-tight truncate">{expense.description}</p>
                        <p className="font-mono text-xs text-muted-foreground mt-0.5 truncate">
                          {getPayerLabel(expense.paidById)} · {getGroupName(expense.groupId)}
                        </p>
                      </div>
                      <span className="font-mono text-base font-semibold text-foreground shrink-0">
                        {formatMoney(expense.amount, userCurrency, expense.currency, expense.originalAmount)}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
