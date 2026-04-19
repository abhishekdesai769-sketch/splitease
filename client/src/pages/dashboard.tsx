import { useQuery, useMutation } from "@tanstack/react-query";
import type { Group, Expense, SafeUser } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UsersRound, Receipt, Users2, TrendingDown, TrendingUp, MailPlus, Check, X } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { calculateGroupBalances, calculatePairwiseBalances, simplifyDebts } from "@/lib/simplify";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function StatCard({ icon: Icon, label, value, href, color }: { icon: any; label: string; value: string; href?: string; color?: string }) {
  const inner = (
    <Card className={`p-4 ${href ? "hover-elevate cursor-pointer" : ""}`}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className={`w-5 h-5 ${color || "text-primary"}`} />
        </div>
        <div>
          <p className="text-xl font-semibold text-foreground font-mono" data-testid={`stat-${label.toLowerCase().replace(/\s/g, "-")}`}>{value}</p>
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
  const { toast } = useToast();
  const { data: groups = [] } = useQuery<Group[]>({ queryKey: ["/api/groups"] });
  const { data: expenses = [] } = useQuery<Expense[]>({ queryKey: ["/api/expenses"] });
  const { data: friendsList = [] } = useQuery<SafeUser[]>({ queryKey: ["/api/friends"] });

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
  const recentExpenses = [...expenses]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  // Calculate what the current user owes / is owed (net balance is always the same regardless of simplify)
  const balances = calculateGroupBalances(expenses);
  const myBalance = balances.find((b) => b.personId === user?.id);
  const youOwe = myBalance && myBalance.amount < 0 ? Math.abs(myBalance.amount) : 0;
  const youAreOwed = myBalance && myBalance.amount > 0 ? myBalance.amount : 0;

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
      if (Math.abs(net) < 0.01) continue;
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

  return (
    <div className="space-y-6">
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
        <h1 className="text-xl font-semibold tracking-tight font-serif">
          Hey, <em className="italic text-accent-foreground">{user?.name?.split(" ")[0] || "there"}</em>
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
          <h2 className="text-base font-semibold mb-3 font-serif">Your Balances</h2>
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
          <h2 className="text-base font-semibold mb-3 font-serif">Recent Expenses</h2>
          <div className="space-y-2">
            {recentExpenses.map((expense) => (
              <Card key={expense.id} className="p-3 flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{expense.description}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    Paid by {getPersonName(expense.paidById)} · {new Date(expense.date).toLocaleDateString()}
                  </p>
                </div>
                <p className="text-sm font-semibold text-primary shrink-0 font-mono">${expense.amount.toFixed(2)}</p>
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
          <h3 className="text-base font-semibold mb-1">Welcome to Spliiit</h3>
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
