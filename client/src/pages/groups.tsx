import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Group, Expense } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { UsersRound, ChevronRight, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { calculateGroupBalances } from "@/lib/simplify";
import { displayBalance, AMOUNT_IN_CLASS, AMOUNT_OUT_CLASS } from "@/lib/balance-display";
import { formatMoney } from "@/components/CurrencySelector";
import { track } from "@/lib/analytics";
import { triggerReview } from "@/lib/reviewPrompt";

export default function Groups() {
  const { user } = useAuth();
  const userCurrency = user?.defaultCurrency;
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [groupName, setGroupName] = useState("");

  const { data: groups = [] } = useQuery<Group[]>({ queryKey: ["/api/groups"] });
  const { data: expenses = [] } = useQuery<Expense[]>({ queryKey: ["/api/expenses"] });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/groups", {
        name: groupName.trim(),
        memberIds: [], // creator is added automatically on server
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      track("group_created", { name: groupName.trim() });
      setGroupName("");
      setOpen(false);
      toast({ title: "Group created" });
      setTimeout(() => triggerReview("group"), 1500);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const getGroupExpenseCount = (groupId: string) =>
    expenses.filter((e) => e.groupId === groupId).length;

  const getMyNetBalance = (groupId: string) => {
    if (!user) return 0;
    const groupExpenses = expenses.filter((e) => e.groupId === groupId);
    if (groupExpenses.length === 0) return 0;
    const balances = calculateGroupBalances(groupExpenses);
    const myBalance = balances.find((b) => b.personId === user.id);
    const raw = myBalance ? Math.round(myBalance.amount * 100) / 100 : 0;
    // Snap sub-$0.05 rounding residuals to 0 so the groups list shows
    // "settled" for fully-paid-up groups instead of phantom $0.01 chips.
    return displayBalance(raw);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="font-serif text-5xl tracking-tight leading-none">Groups</h1>
          <p className="text-sm text-muted-foreground mt-1.5 font-mono">{groups.length} groups</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="rounded-full px-4 shrink-0" data-testid="create-group-btn">
              <Plus className="w-4 h-4 mr-1.5" />
              Create
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a Group</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-4 pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (groupName.trim()) createMutation.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="group-name">Group Name</Label>
                <Input
                  id="group-name"
                  placeholder="e.g. Road Trip 2026"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  data-testid="input-group-name"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                You'll be added as a member automatically. You can invite friends by email after creating the group.
              </p>
              <Button
                type="submit"
                className="w-full"
                disabled={!groupName.trim() || createMutation.isPending}
                data-testid="submit-group"
              >
                {createMutation.isPending ? "Creating..." : "Create Group"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Hairline separates the page header from the list. */}
      {groups.length > 0 && <div className="h-px bg-border" />}

      {groups.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <UsersRound className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-base font-semibold mb-1">No groups yet</h3>
          <p className="text-sm text-muted-foreground">
            Create a group and invite your friends to start splitting expenses.
          </p>
        </Card>
      ) : (
        <div className="space-y-5">
          {[...groups]
            .sort((a, b) => (getMyNetBalance(a.id) !== 0 ? 0 : 1) - (getMyNetBalance(b.id) !== 0 ? 0 : 1))
            .map((group) => {
            const expenseCount = getGroupExpenseCount(group.id);
            const netBalance = getMyNetBalance(group.id);
            return (
              <Link key={group.id} href={`/groups/${group.id}`}>
                <Card className="p-[18px] rounded-[26px] flex items-center gap-3 hover-elevate cursor-pointer" data-testid={`group-card-${group.id}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-[17px] font-semibold tracking-tight leading-tight">{group.name}</p>
                    <p className="text-xs text-muted-foreground font-mono mt-1.5 truncate">
                      {group.memberIds.length} members · {expenseCount} expenses
                    </p>
                  </div>
                  {netBalance !== 0 ? (
                    <span className={`text-base font-semibold shrink-0 font-mono ${netBalance > 0 ? AMOUNT_IN_CLASS : AMOUNT_OUT_CLASS}`}>
                      {formatMoney(Math.abs(netBalance), userCurrency)}
                    </span>
                  ) : expenseCount > 0 ? (
                    <span className="text-sm text-muted-foreground shrink-0 font-mono">settled</span>
                  ) : null}
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
