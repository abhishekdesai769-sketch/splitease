import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SafeUser, Expense } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Trash2, Receipt, CheckCircle2, HandCoins } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { calculateGroupBalances } from "@/lib/simplify";

export default function FriendDetail({ friendId }: { friendId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [settleUpOpen, setSettleUpOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidById, setPaidById] = useState("");
  const [splitType, setSplitType] = useState<"equal" | "they_pay" | "you_pay">("equal");

  const { data: friendsList = [] } = useQuery<SafeUser[]>({
    queryKey: ["/api/friends"],
  });

  const { data: directExpenses = [] } = useQuery<Expense[]>({
    queryKey: ["/api/friends/expenses"],
  });

  const friend = friendsList.find((f) => f.id === friendId);

  // Filter expenses to only those between the current user and this friend
  const friendExpenses = directExpenses.filter(
    (e) =>
      (e.paidById === user?.id && e.splitAmongIds.includes(friendId)) ||
      (e.paidById === friendId && e.splitAmongIds.includes(user?.id || ""))
  );

  const sortedExpenses = [...friendExpenses].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // Calculate balance between just this user and this friend
  const friendBalances = calculateGroupBalances(friendExpenses);
  const myBalance = friendBalances.find((b) => b.personId === user?.id)?.amount || 0;

  const addExpenseMutation = useMutation({
    mutationFn: async () => {
      let actualPaidById = paidById;
      let splitAmongIds: string[];

      if (splitType === "equal") {
        splitAmongIds = [user?.id || "", friendId].filter((v, i, a) => a.indexOf(v) === i);
      } else if (splitType === "they_pay") {
        splitAmongIds = [friendId];
      } else {
        actualPaidById = friendId;
        splitAmongIds = [user?.id || ""];
      }

      const res = await apiRequest("POST", "/api/friends/expenses", {
        description: description.trim(),
        amount: parseFloat(amount),
        paidById: actualPaidById,
        splitAmongIds,
        date: new Date().toISOString(),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/friends/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      resetExpenseForm();
      setAddExpenseOpen(false);
      toast({ title: "Expense added" });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const settleUpMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settle-up", {
        friendId: friendId,
        amount: Math.abs(myBalance),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/friends/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      setSettleUpOpen(false);
      toast({ title: "Settled up", description: "Payment recorded" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/expenses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/friends/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      toast({ title: "Expense removed" });
    },
  });

  const resetExpenseForm = () => {
    setDescription("");
    setAmount("");
    setPaidById("");
    setSplitType("equal");
  };

  if (!friend) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-48 bg-muted animate-pulse rounded" />
        <div className="h-20 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/friends">
          <Button size="icon" variant="ghost" data-testid="back-to-friends">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
          style={{ backgroundColor: friend.avatarColor }}
        >
          {friend.name[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold tracking-tight truncate">{friend.name}</h1>
          <p className="text-sm text-muted-foreground truncate">{friend.email}</p>
        </div>
        <Dialog open={addExpenseOpen} onOpenChange={setAddExpenseOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="add-friend-expense-btn">
              <Plus className="w-4 h-4 mr-1.5" />
              Expense
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Split with {friend.name}</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-4 pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (description.trim() && amount && paidById) {
                  addExpenseMutation.mutate();
                }
              }}
            >
              <div className="space-y-2">
                <Label>Description</Label>
                <Input
                  placeholder="e.g. Coffee, Uber ride"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  data-testid="input-friend-detail-desc"
                />
              </div>
              <div className="space-y-2">
                <Label>Amount ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  data-testid="input-friend-detail-amount"
                />
              </div>
              <div className="space-y-2">
                <Label>Paid by</Label>
                <Select value={paidById} onValueChange={setPaidById}>
                  <SelectTrigger data-testid="select-friend-detail-paid-by">
                    <SelectValue placeholder="Who paid?" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={user?.id || "me"}>
                      {user?.name} (You)
                    </SelectItem>
                    <SelectItem value={friendId}>
                      {friend.name}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Split type toggle */}
              <div className="space-y-2">
                <Label>How to split</Label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(["equal", "they_pay", "you_pay"] as const).map((type) => {
                    const labels = {
                      equal: "Split equally",
                      they_pay: "They pay you",
                      you_pay: "You pay them",
                    };
                    return (
                      <button
                        key={type}
                        type="button"
                        className={`px-2 py-2.5 rounded-lg border text-xs font-medium transition-colors ${
                          splitType === type
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:bg-muted/50"
                        }`}
                        onClick={() => setSplitType(type)}
                        data-testid={`friend-detail-split-type-${type}`}
                      >
                        {labels[type]}
                      </button>
                    );
                  })}
                </div>
              </div>
              {amount && paidById && (
                <div className="rounded-lg bg-muted/50 p-3 text-center">
                  {splitType === "equal" ? (
                    <p className="text-sm text-muted-foreground">
                      Split equally — <span className="font-medium text-foreground">${(parseFloat(amount) / 2).toFixed(2)}</span> each
                    </p>
                  ) : splitType === "they_pay" ? (
                    <p className="text-sm text-muted-foreground">
                      {paidById === user?.id
                        ? <>{friend.name} pays you <span className="font-semibold text-primary">${parseFloat(amount).toFixed(2)}</span></>
                        : <>You pay {friend.name} <span className="font-semibold text-destructive">${parseFloat(amount).toFixed(2)}</span></>
                      }
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {paidById === user?.id
                        ? <>You pay {friend.name} <span className="font-semibold text-destructive">${parseFloat(amount).toFixed(2)}</span></>
                        : <>{friend.name} pays you <span className="font-semibold text-primary">${parseFloat(amount).toFixed(2)}</span></>
                      }
                    </p>
                  )}
                </div>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={
                  !description.trim() ||
                  !amount ||
                  !paidById ||
                  addExpenseMutation.isPending
                }
                data-testid="submit-friend-detail-expense"
              >
                {addExpenseMutation.isPending ? "Adding..." : "Add Expense"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Balance summary */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Balance</p>
            {myBalance === 0 ? (
              <p className="text-lg font-semibold text-muted-foreground">All settled up</p>
            ) : myBalance > 0 ? (
              <p className="text-lg font-semibold text-primary">
                {friend.name} pays you ${myBalance.toFixed(2)}
              </p>
            ) : (
              <p className="text-lg font-semibold text-destructive">
                You pay {friend.name} ${Math.abs(myBalance).toFixed(2)}
              </p>
            )}
          </div>
          {myBalance !== 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSettleUpOpen(true)}
              data-testid="friend-detail-settle-up"
            >
              <HandCoins className="w-4 h-4 mr-1.5" />
              Settle Up
            </Button>
          )}
        </div>
      </Card>

      {/* Settle Up Dialog */}
      <Dialog open={settleUpOpen} onOpenChange={setSettleUpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settle Up</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="rounded-lg bg-muted/50 p-4 text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                {myBalance < 0 ? (
                  <>You pay <span className="font-semibold text-foreground">{friend.name}</span></>
                ) : (
                  <><span className="font-semibold text-foreground">{friend.name}</span> pays you</>
                )}
              </p>
              <p className="text-2xl font-bold text-primary">
                ${Math.abs(myBalance).toFixed(2)}
              </p>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              This will record a payment that zeros out your balance with {friend.name}.
            </p>
            <Button
              className="w-full"
              onClick={() => settleUpMutation.mutate()}
              disabled={settleUpMutation.isPending}
              data-testid="confirm-friend-detail-settle-up"
            >
              <CheckCircle2 className="w-4 h-4 mr-1.5" />
              {settleUpMutation.isPending ? "Settling..." : "Confirm Settlement"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Expenses list */}
      {sortedExpenses.length > 0 ? (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-2">
            Expenses with {friend.name}
          </h2>
          <div className="space-y-2">
            {sortedExpenses.map((expense) => {
              const paidByName = expense.paidById === user?.id ? "You" : friend.name;
              return (
                <Card
                  key={expense.id}
                  className={`p-3 ${expense.isSettlement ? "border-primary/30 bg-primary/5" : ""}`}
                  data-testid={`friend-expense-${expense.id}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${expense.isSettlement ? "bg-primary/20" : "bg-primary/10"}`}>
                      {expense.isSettlement ? (
                        <CheckCircle2 className="w-4 h-4 text-primary" />
                      ) : (
                        <Receipt className="w-4 h-4 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {expense.isSettlement ? "Settlement" : expense.description}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {paidByName} paid · {new Date(expense.date).toLocaleDateString()}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-foreground shrink-0">
                      ${expense.amount.toFixed(2)}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteExpenseMutation.mutate(expense.id)}
                    >
                      <Trash2 className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ) : (
        <Card className="p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Receipt className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-base font-semibold mb-1">No expenses yet</h3>
          <p className="text-sm text-muted-foreground">
            Add an expense to start tracking splits with {friend.name}.
          </p>
        </Card>
      )}
    </div>
  );
}
