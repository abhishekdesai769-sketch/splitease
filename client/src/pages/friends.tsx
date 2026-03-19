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
import { UserPlus, Receipt, Trash2, Plus, Users2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { calculateGroupBalances, simplifyDebts } from "@/lib/simplify";

export default function Friends() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [addFriendOpen, setAddFriendOpen] = useState(false);
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [friendEmail, setFriendEmail] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidById, setPaidById] = useState("");
  const [splitWithId, setSplitWithId] = useState("");
  const [splitType, setSplitType] = useState<"equal" | "they_pay" | "you_pay">("equal");

  const { data: friendsList = [], isLoading } = useQuery<SafeUser[]>({
    queryKey: ["/api/friends"],
  });

  const { data: directExpenses = [] } = useQuery<Expense[]>({
    queryKey: ["/api/friends/expenses"],
  });

  const addFriendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/friends", {
        email: friendEmail.trim().toLowerCase(),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/friends"] });
      setFriendEmail("");
      setAddFriendOpen(false);
      toast({ title: "Friend added" });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const removeFriendMutation = useMutation({
    mutationFn: async (friendId: string) => {
      await apiRequest("DELETE", `/api/friends/${friendId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/friends"] });
      toast({ title: "Friend removed" });
    },
  });

  const addExpenseMutation = useMutation({
    mutationFn: async () => {
      // Determine who actually paid and who is in the split
      let actualPaidById = paidById;
      let splitAmongIds: string[];

      if (splitType === "equal") {
        // Both share the cost
        splitAmongIds = [paidById, splitWithId].filter((v, i, a) => a.indexOf(v) === i);
      } else if (splitType === "they_pay") {
        // "They pay you" = you paid, they need to pay you the full amount
        // payer = paidById, only the friend is in the split
        splitAmongIds = [splitWithId];
      } else {
        // "You pay them" = they paid for you, you need to pay them back
        // Flip: the friend is the payer, you are in the split
        actualPaidById = splitWithId;
        splitAmongIds = [paidById];
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
    setSplitWithId("");
    setSplitType("equal");
  };

  // Calculate balances across all direct (non-group) expenses
  const balances = calculateGroupBalances(directExpenses);
  const settlements = simplifyDebts(balances);

  // Per-friend balance
  const getFriendBalance = (friendId: string) => {
    const relevantExpenses = directExpenses.filter(
      (e) =>
        (e.paidById === user?.id && e.splitAmongIds.includes(friendId)) ||
        (e.paidById === friendId && e.splitAmongIds.includes(user?.id || ""))
    );
    const friendBalances = calculateGroupBalances(relevantExpenses);
    const myBalance = friendBalances.find((b) => b.personId === user?.id);
    return myBalance?.amount || 0;
  };

  const getPersonName = (id: string) => {
    if (id === user?.id) return "You";
    return friendsList.find((f) => f.id === id)?.name || "Someone";
  };

  const sortedExpenses = [...directExpenses].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Friends</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {friendsList.length} friend{friendsList.length !== 1 ? "s" : ""} · Direct splits
          </p>
        </div>
        <div className="flex items-center gap-2">
          {friendsList.length > 0 && (
            <Dialog open={addExpenseOpen} onOpenChange={setAddExpenseOpen}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="add-direct-expense-btn">
                  <Plus className="w-4 h-4 mr-1.5" />
                  Expense
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Split with a Friend</DialogTitle>
                </DialogHeader>
                <form
                  className="space-y-4 pt-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (description.trim() && amount && paidById && splitWithId) {
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
                      data-testid="input-direct-desc"
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
                      data-testid="input-direct-amount"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Paid by</Label>
                    <Select value={paidById} onValueChange={setPaidById}>
                      <SelectTrigger data-testid="select-direct-paid-by">
                        <SelectValue placeholder="Who paid?" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={user?.id || "me"}>
                          {user?.name} (You)
                        </SelectItem>
                        {friendsList.map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Split with</Label>
                    <Select value={splitWithId} onValueChange={setSplitWithId}>
                      <SelectTrigger data-testid="select-direct-split-with">
                        <SelectValue placeholder="Which friend?" />
                      </SelectTrigger>
                      <SelectContent>
                        {paidById !== user?.id && user?.id && (
                          <SelectItem value={user.id}>
                            {user.name} (You)
                          </SelectItem>
                        )}
                        {friendsList
                          .filter((f) => f.id !== paidById)
                          .map((f) => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.name}
                            </SelectItem>
                          ))}
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
                            data-testid={`split-type-${type}`}
                          >
                            {labels[type]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {amount && paidById && splitWithId && (
                    <div className="rounded-lg bg-muted/50 p-3 text-center">
                      {splitType === "equal" ? (
                        <p className="text-sm text-muted-foreground">
                          Split equally — <span className="font-medium text-foreground">${(parseFloat(amount) / 2).toFixed(2)}</span> each
                        </p>
                      ) : splitType === "they_pay" ? (
                        <p className="text-sm text-muted-foreground">
                          {paidById === user?.id
                            ? <>{friendsList.find(f => f.id === splitWithId)?.name || "They"} pays you <span className="font-semibold text-primary">${parseFloat(amount).toFixed(2)}</span></>
                            : <>You pay {friendsList.find(f => f.id === paidById)?.name || "them"} <span className="font-semibold text-destructive">${parseFloat(amount).toFixed(2)}</span></>
                          }
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {paidById === user?.id
                            ? <>You pay {friendsList.find(f => f.id === splitWithId)?.name || "them"} <span className="font-semibold text-destructive">${parseFloat(amount).toFixed(2)}</span></>
                            : <>{friendsList.find(f => f.id === paidById)?.name || "They"} pays you <span className="font-semibold text-primary">${parseFloat(amount).toFixed(2)}</span></>
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
                      !splitWithId ||
                      addExpenseMutation.isPending
                    }
                    data-testid="submit-direct-expense"
                  >
                    {addExpenseMutation.isPending ? "Adding..." : "Add Expense"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
          <Dialog open={addFriendOpen} onOpenChange={setAddFriendOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="secondary" data-testid="add-friend-btn">
                <UserPlus className="w-4 h-4 mr-1.5" />
                Add Friend
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a Friend</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-4 pt-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (friendEmail.trim()) addFriendMutation.mutate();
                }}
              >
                <div className="space-y-2">
                  <Label>Friend's Email</Label>
                  <Input
                    type="email"
                    placeholder="friend@example.com"
                    value={friendEmail}
                    onChange={(e) => setFriendEmail(e.target.value)}
                    data-testid="input-friend-email"
                  />
                  <p className="text-xs text-muted-foreground">
                    They must have a SplitEase account first.
                  </p>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={!friendEmail.trim() || addFriendMutation.isPending}
                  data-testid="submit-add-friend"
                >
                  {addFriendMutation.isPending ? "Adding..." : "Add Friend"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Friends list with balances */}
      {friendsList.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Your Friends</h2>
          {friendsList.map((friend) => {
            const balance = getFriendBalance(friend.id);
            return (
              <Card
                key={friend.id}
                className="p-3 flex items-center gap-3"
                data-testid={`friend-card-${friend.id}`}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                  style={{ backgroundColor: friend.avatarColor }}
                >
                  {friend.name[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{friend.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{friend.email}</p>
                </div>
                {balance !== 0 && (
                  <span
                    className={`text-sm font-semibold shrink-0 ${
                      balance > 0 ? "text-primary" : "text-destructive"
                    }`}
                  >
                    {balance > 0 ? `+$${balance.toFixed(2)}` : `-$${Math.abs(balance).toFixed(2)}`}
                  </span>
                )}
                {balance === 0 && directExpenses.some(
                  (e) =>
                    (e.paidById === user?.id && e.splitAmongIds.includes(friend.id)) ||
                    (e.paidById === friend.id && e.splitAmongIds.includes(user?.id || ""))
                ) && (
                  <span className="text-xs text-muted-foreground shrink-0">settled</span>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => removeFriendMutation.mutate(friend.id)}
                  data-testid={`remove-friend-${friend.id}`}
                >
                  <Trash2 className="w-4 h-4 text-muted-foreground" />
                </Button>
              </Card>
            );
          })}
        </div>
      ) : (
        !isLoading && (
          <Card className="p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Users2 className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-base font-semibold mb-1">No friends yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Add a friend by their email to start splitting expenses 1-on-1.
            </p>
          </Card>
        )
      )}

      {/* Settlements summary */}
      {settlements.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-2">Settlements</h2>
          <div className="space-y-2">
            {settlements.map((s, i) => (
              <Card key={i} className="p-3 flex items-center gap-2">
                <div className="flex-1 min-w-0">
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
                  </p>
                </div>
                <span className="text-sm font-semibold text-primary shrink-0">
                  ${s.amount.toFixed(2)}
                </span>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Direct expenses list */}
      {sortedExpenses.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-2">Direct Expenses</h2>
          <div className="space-y-2">
            {sortedExpenses.map((expense) => (
              <Card
                key={expense.id}
                className="p-3"
                data-testid={`direct-expense-${expense.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Receipt className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{expense.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {getPersonName(expense.paidById)} paid · {new Date(expense.date).toLocaleDateString()}
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
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
