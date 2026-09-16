import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { Group, Expense, SafeUser, RecurringExpense } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UsersRound, Users2, TrendingDown, TrendingUp, MailPlus, Check, X, Repeat, Trash2, Sparkles, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { calculateGroupBalances, calculatePairwiseBalances, simplifyDebts } from "@/lib/simplify";
import { displayBalance, isEffectivelySettled, AMOUNT_IN_CLASS, AMOUNT_OUT_CLASS } from "@/lib/balance-display";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CelebrationBanner } from "@/components/CelebrationBanner";
import { WhatsNewModal } from "@/components/WhatsNewModal";
import { formatMoney } from "@/components/CurrencySelector";

// Warm, on-brand avatar colour derived from a person's id — ignores any stale
// teal/blue values still stored on legacy accounts from the old theme, so
// avatars are always in the cream/terracotta palette. Deterministic per person.
const WARM_AVATARS = ["#7A3E32", "#8C5A3C", "#9A4A2A", "#A6674A", "#8A6A32", "#B04A34", "#6B4A3A", "#B5794A"];
function warmAvatar(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return WARM_AVATARS[h % WARM_AVATARS.length];
}

function StatCard({ label, value, href, variant = "count", accent }: { label: string; value: string; href?: string; variant?: "count" | "money"; accent?: boolean }) {
  const money = variant === "money";
  const inner = (
    <div className={`rounded-2xl p-4 border ${money ? "bg-foreground border-foreground" : `bg-card border-border ${href ? "hover-elevate cursor-pointer" : ""}`}`}>
      <p className={`text-xs font-medium ${money ? "text-background/70" : "text-muted-foreground"}`}>{label}</p>
      <p
        className={`mt-1.5 ${money ? `text-[26px] leading-none font-mono tabular-nums ${accent ? "text-[#E8B98C]" : "text-background"}` : "text-3xl font-serif text-foreground"}`}
        data-testid={`stat-${label.toLowerCase().replace(/\s/g, "-")}`}
      >{value}</p>
    </div>
  );
  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
}

export default function Dashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const userCurrency = user?.defaultCurrency;
  const { data: groups = [] } = useQuery<Group[]>({ queryKey: ["/api/groups"] });
  const { data: expenses = [] } = useQuery<Expense[]>({ queryKey: ["/api/expenses"] });
  const { data: friendsList = [] } = useQuery<SafeUser[]>({ queryKey: ["/api/friends"] });

  // Recurring expenses (premium only — skip fetch if not premium)
  const { data: recurringList = [] } = useQuery<RecurringExpense[]>({
    queryKey: ["/api/recurring"],
    enabled: !!user?.isPremium,
  });

  const cancelRecurringMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/recurring/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring"] });
      toast({ title: "Recurring expense cancelled" });
    },
    onError: () => {
      toast({ title: "Error", description: "Could not cancel.", variant: "destructive" });
    },
  });

  // Incoming group invites
  const { data: incomingInvites = [] } = useQuery<any[]>({
    queryKey: ["/api/invites/incoming"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/invites/incoming");
      return res.json();
    },
  });

  const acceptInviteMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      const res = await apiRequest("POST", `/api/invites/${inviteId}/accept`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invites/incoming"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      toast({ title: "Invite accepted", description: "You've joined the group!" });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const declineInviteMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      const res = await apiRequest("POST", `/api/invites/${inviteId}/decline`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invites/incoming"] });
      toast({ title: "Invite declined" });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  // Get recent expenses (last 5)
  // Recent Expenses on the dashboard should only include expenses the user
  // is actually INVOLVED in — either they paid, or they're in the split.
  // Without this filter, group expenses + settlements between OTHER members
  // (e.g. "Krishna paid Srushti $10") clutter the user's dashboard with
  // activity that's not relevant to their balances. Those still belong in
  // the group's own expense list, just not here.
  const recentExpenses = [...expenses]
    .filter((e) => {
      if (!user?.id) return false;
      if (e.paidById === user.id) return true;                  // I paid
      if (Array.isArray(e.splitAmongIds) && e.splitAmongIds.includes(user.id)) return true;  // I'm in the split
      return false;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  // Calculate what the current user owes / is owed (net balance is always the same regardless of simplify).
  // displayBalance() snaps sub-$0.05 rounding residuals to 0 so the stat cards
  // don't show "You're Owed $0.01" after the user has settled everything.
  const balances = calculateGroupBalances(expenses);
  const myBalance = balances.find((b) => b.personId === user?.id);
  const rawAmount = myBalance ? myBalance.amount : 0;
  const youOwe = rawAmount < 0 ? Math.abs(displayBalance(rawAmount)) : 0;
  const youAreOwed = rawAmount > 0 ? displayBalance(rawAmount) : 0;

  // Per-group settlements: use simplified or pairwise based on each group's setting
  const mySettlements = (() => {
    const allSettlements: { from: string; to: string; amount: number }[] = [];

    // Group expenses — respect each group's simplifyDebts setting
    for (const group of groups) {
      const groupExpenses = expenses.filter(e => e.groupId === group.id);
      if (groupExpenses.length === 0) continue;
      const settlements = group.simplifyDebts
        ? simplifyDebts(calculateGroupBalances(groupExpenses))
        : calculatePairwiseBalances(groupExpenses);
      allSettlements.push(...settlements);
    }

    // Direct (non-group) expenses — always pairwise
    const directExpenses = expenses.filter(e => !e.groupId);
    if (directExpenses.length > 0) {
      allSettlements.push(...calculatePairwiseBalances(directExpenses));
    }

    // Merge all settlements with the same person into one net balance per person
    const netMap = new Map<string, number>();
    for (const s of allSettlements) {
      if (s.from === user?.id) {
        const cur = netMap.get(s.to) ?? 0;
        netMap.set(s.to, cur - s.amount);      // you owe them → negative
      } else if (s.to === user?.id) {
        const cur = netMap.get(s.from) ?? 0;
        netMap.set(s.from, cur + s.amount);    // they owe you → positive
      }
    }
    const merged: { from: string; to: string; amount: number }[] = [];
    for (const [otherId, net] of netMap) {
      // Skip phantom-cent residuals from rounding so the dashboard's
      // "Your Balances" doesn't list "You owe X $0.01" rows.
      if (isEffectivelySettled(net)) continue;
      if (net > 0) merged.push({ from: otherId, to: user!.id, amount: Math.round(net * 100) / 100 });
      else merged.push({ from: user!.id, to: otherId, amount: Math.round(Math.abs(net) * 100) / 100 });
    }
    return merged;
  })();

  // Batch-fetch all group members in one request (avoids N+1)
  const { data: groupMembersData } = useQuery<SafeUser[]>({
    queryKey: ["/api/members/all"],
    enabled: groups.length > 0,
  });

  // Combine group members + friends for name lookups, dedup by id
  const allMembersData = (() => {
    const combined = [...(groupMembersData || []), ...friendsList];
    const seen = new Set<string>();
    return combined.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  })();

  const allMembers = allMembersData;
  const getPersonName = (id: string) => {
    if (id === user?.id) return "You";
    return allMembers.find((m) => m.id === id)?.name || "Someone";
  };

  const getRecurringSplitLabel = (rec: RecurringExpense): string => {
    if (rec.groupId) {
      const grp = groups.find(g => g.id === rec.groupId);
      return grp ? `in ${grp.name}` : "in a group";
    }
    const others = rec.splitAmongIds.filter(id => id !== user?.id);
    if (others.length === 0) return "";
    if (others.length === 1) return `with ${getPersonName(others[0])}`;
    if (others.length === 2) return `with ${getPersonName(others[0])} & ${getPersonName(others[1])}`;
    return `with ${others.length} people`;
  };

  return (
    <div className="space-y-6">
      {/* One-time "what's new" feature carousel — shown once per user, ever. */}
      <WhatsNewModal />

      {/* Milestone / promo banner — only renders if user has an active campaign */}
      <CelebrationBanner />

      {/* Incoming Group Invites — shown at top if any */}
      {incomingInvites.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <MailPlus className="w-4 h-4 text-primary" />
            <h2 className="text-base font-semibold font-serif">Group Invites</h2>
          </div>
          {incomingInvites.map((invite: any) => (
            <Card
              key={invite.id}
              className="p-3 border-primary/30 bg-primary/5"
              data-testid={`incoming-invite-${invite.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    <span className="text-primary">{invite.inviterName}</span>
                    {" invited you to "}
                    <span className="font-semibold">{invite.groupName}</span>
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 px-2 text-xs"
                    onClick={() => acceptInviteMutation.mutate(invite.id)}
                    disabled={acceptInviteMutation.isPending || declineInviteMutation.isPending}
                    data-testid={`accept-invite-${invite.id}`}
                  >
                    <Check className="w-3 h-3 mr-1" />
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={() => declineInviteMutation.mutate(invite.id)}
                    disabled={acceptInviteMutation.isPending || declineInviteMutation.isPending}
                    data-testid={`decline-invite-${invite.id}`}
                  >
                    <X className="w-3 h-3 mr-1" />
                    Decline
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div>
        <h1 className="text-4xl font-serif tracking-tight leading-none">
          Hey, <em className="italic text-accent-foreground">{user?.name?.split(" ")[0] || "there"}</em>
        </h1>
        <p className="text-[15px] text-muted-foreground mt-2">Here's your expense overview</p>
      </div>

      {/* Overview — money cards weighted (dark) so the balance you care about
          is the focal point; Friends/Groups stay quiet tappable nav tiles. */}
      <div>
        <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground mb-2">Overview</p>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="You're Owed" value={formatMoney(youAreOwed, userCurrency)} variant="money" accent />
          <StatCard label="You Owe" value={formatMoney(youOwe, userCurrency)} variant="money" />
          <StatCard label="Friends" value={String(friendsList.length)} href="/friends" />
          <StatCard label="Groups" value={String(groups.length)} href="/groups" />
        </div>
      </div>

      {/* AI Mode tile — full-width, gradient, dashboard-prominent. Visible
          to all users; the page itself shows a Premium-gate teaser for
          non-Premium users (same psychology as Money tab). TWA users get
          it too — the page handles gating internally. */}
      <Link href="/ai">
        <button
          type="button"
          className="w-full group rounded-2xl border border-border bg-card p-4 text-left transition-all active:scale-[0.99] hover:border-foreground/25"
          data-testid="dashboard-ai-mode-tile"
        >
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-foreground flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-background" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-serif">AI Mode</h3>
                <span className="text-[9px] uppercase tracking-wider font-mono font-semibold text-background bg-accent-foreground px-1.5 py-0.5 rounded">
                  New
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Describe a split, drop a PDF receipt, or send screenshots — split in seconds.
              </p>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </button>
      </Link>

      {/* Your settlements — two-column rows: person left, amount right (tabular). */}
      {mySettlements.length > 0 && (
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground mb-1">Your Balances</p>
          <div>
            {mySettlements.map((s, i) => {
              const theyOweMe = s.to === user?.id;
              const otherId = theyOweMe ? s.from : s.to;
              const other = allMembers.find((m) => m.id === otherId);
              const initial = (other?.name || "?").charAt(0).toUpperCase();
              return (
                <div key={i} className="flex items-center justify-between gap-3 py-3 border-b border-border last:border-b-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-serif shrink-0"
                      style={{ backgroundColor: warmAvatar(otherId) }}
                    >{initial}</div>
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium truncate">{getPersonName(otherId)}</p>
                      <p className="text-xs text-muted-foreground">{theyOweMe ? "owes you" : "you pay"}</p>
                    </div>
                  </div>
                  <span className={`font-mono tabular-nums text-base font-semibold shrink-0 ${theyOweMe ? AMOUNT_IN_CLASS : AMOUNT_OUT_CLASS}`}>{formatMoney(s.amount, userCurrency)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recurring expenses (premium) */}
      {user?.isPremium && recurringList.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Repeat className="w-4 h-4 text-primary" />
            <h2 className="text-base font-semibold font-serif">Recurring</h2>
          </div>
          <div className="space-y-2">
            {recurringList.map((rec) => (
              <Card key={rec.id} className="p-3 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{rec.description}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {formatMoney(rec.amount, userCurrency)} · {rec.frequency}
                    {getRecurringSplitLabel(rec) && ` · ${getRecurringSplitLabel(rec)}`}
                  </p>
                  <p className="text-xs text-muted-foreground/60 font-mono">next {rec.nextRunDate}</p>
                </div>
                <button
                  onClick={() => cancelRecurringMutation.mutate(rec.id)}
                  disabled={cancelRecurringMutation.isPending}
                  className="text-muted-foreground hover:text-destructive transition-colors shrink-0 p-1"
                  title="Cancel recurring expense"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Recent expenses */}
      {recentExpenses.length > 0 && (
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground mb-2">Recent Expenses</p>
          <div className="space-y-2">
            {recentExpenses.map((expense) => (
              <Card key={expense.id} className="p-4 flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-base font-medium truncate">{expense.description}</p>
                  <p className="text-sm text-muted-foreground font-mono mt-0.5">
                    Paid by {getPersonName(expense.paidById)} · {new Date(expense.date).toLocaleDateString()}
                  </p>
                </div>
                <p className="text-base font-semibold text-primary shrink-0 font-mono">{formatMoney(expense.amount, userCurrency, expense.currency, expense.originalAmount)}</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* No empty-state card on Dashboard.
          Rationale: users who skipped the first-run wizard explicitly told us
          they didn't want to be walked through. Re-showing the same "Create
          your first group" CTA on Dashboard is a second nag — and the 4 stat
          cards above are already tappable nav (Friends 0 → /friends,
          Groups 0 → /groups). Trust the user's choice. */}
    </div>
  );
}
