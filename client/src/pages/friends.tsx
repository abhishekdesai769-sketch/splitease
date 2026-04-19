import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, apiFormRequest, queryClient } from "@/lib/queryClient";
import type { SafeUser, Expense } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserPlus, Plus, Users2, HandCoins, CheckCircle2, ChevronRight, Camera, X, Repeat, Crown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { calculateGroupBalances, calculatePairwiseBalances } from "@/lib/simplify";

export default function Friends() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [addFriendOpen, setAddFriendOpen] = useState(false);
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [settleUpOpen, setSettleUpOpen] = useState(false);
  const [settleUpFriend, setSettleUpFriend] = useState<{ id: string; name: string; amount: number } | null>(null);
  const [friendEmail, setFriendEmail] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidById, setPaidById] = useState("");
  const [splitWithId, setSplitWithId] = useState("");
  const [splitType, setSplitType] = useState<"equal" | "they_pay" | "you_pay">("equal");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringFrequency, setRecurringFrequency] = useState<"monthly" | "weekly">("monthly");

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

  const addExpenseMutation = useMutation({
    mutationFn: async () => {
      let actualPaidById = paidById;
      let splitAmongIds: string[];

      if (splitType === "equal") {
        splitAmongIds = [paidById, splitWithId].filter((v, i, a) => a.indexOf(v) === i);
      } else if (splitType === "they_pay") {
        splitAmongIds = [splitWithId];
      } else {
        actualPaidById = splitWithId;
        splitAmongIds = [paidById];
      }

      const formData = new FormData();
      formData.append("description", description.trim());
      formData.append("amount", String(parseFloat(amount)));
      formData.append("paidById", actualPaidById);
      formData.append("splitAmongIds", JSON.stringify(splitAmongIds));
      formData.append("date", new Date().toISOString());
      if (receiptFile) {
        formData.append("receipt", receiptFile);
      }

      const res = await apiFormRequest("POST", "/api/friends/expenses", formData);
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
      if (!settleUpFriend) throw new Error("No friend selected");
      const res = await apiRequest("POST", "/api/settle-up", {
        friendId: settleUpFriend.id,
        amount: Math.abs(settleUpFriend.amount),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/friends/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      setSettleUpOpen(false);
      setSettleUpFriend(null);
      toast({ title: "Settled up", description: "Payment recorded" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const addRecurringMutation = useMutation({
    mutationFn: async () => {
      let actualPaidById = paidById;
      let splitAmongIds: string[];

      if (splitType === "equal") {
        splitAmongIds = [paidById, splitWithId].filter((v, i, a) => a.indexOf(v) === i);
      } else if (splitType === "they_pay") {
        splitAmongIds = [splitWithId];
      } else {
        actualPaidById = splitWithId;
        splitAmongIds = [paidById];
      }

      const res = await apiRequest("POST", "/api/recurring", {
        description: description.trim(),
        amount: parseFloat(amount),
        paidById: actualPaidById,
        splitAmongIds,
        groupId: null,
        frequency: recurringFrequency,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/friends/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring"] });
      resetExpenseForm();
      setAddExpenseOpen(false);
      toast({ title: "Recurring expense created", description: `First expense added. Repeats ${recurringFrequency}.` });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const resetExpenseForm = () => {
    setDescription("");
    setAmount("");
    setPaidById("");
    setSplitWithId("");
    setSplitType("equal");
    setReceiptFile(null);
    setIsRecurring(false);
    setRecurringFrequency("monthly");
  };

  // Calculate balances across all direct (non-group) expenses
  const settlements = calculatePairwiseBalances(directExpenses);

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

  const handleSettleUp = (friend: SafeUser) => {
    const balance = getFriendBalance(friend.id);
    if (balance === 0) return;
    setSettleUpFriend({ id: friend.id, name: friend.name, amount: balance });
    setSettleUpOpen(true);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight font-serif"><em className="italic text-accent-foreground">Friends</em></h1>
          <p className="text-sm text-muted-foreground mt-0.5 font-mono">
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
                      if (isRecurring) {
                        addRecurringMutation.mutate();
                      } else {
                        addExpenseMutation.mutate();
                      }
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
                  {/* Repeat toggle (Premium) */}
                  <div className="rounded-lg border border-border p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Repeat className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium leading-tight">Repeat this expense</p>
                          <p className="text-xs text-muted-foreground">Auto-creates on schedule</p>
                        </div>
                      </div>
                      {user?.isPremium ? (
                        <Switch checked={isRecurring} onCheckedChange={setIsRecurring} />
                      ) : (
                        <span className="text-xs text-primary font-medium flex items-center gap-1">
                          <Crown className="w-3 h-3" /> Premium
                        </span>
                      )}
                    </div>
                    {isRecurring && user?.isPremium && (
                      <div className="grid grid-cols-2 gap-1.5 pt-1">
                        {(["monthly", "weekly"] as const).map((freq) => (
                          <button
                            key={freq}
                            type="button"
                            className={`py-2 rounded-lg border text-xs font-medium transition-colors ${
                              recurringFrequency === freq
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:bg-muted/50"
                            }`}
                            onClick={() => setRecurringFrequency(freq)}
                          >
                            {freq === "monthly" ? "Monthly" : "Weekly"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Receipt upload */}
                  {!isRecurring && (
                  <div className="space-y-2">
                    <Label>Receipt (optional)</Label>
                    {receiptFile ? (
                      <div className="flex items-center gap-2 rounded-lg border border-border p-2.5">
                        <Camera className="w-4 h-4 text-primary shrink-0" />
                        <span className="text-sm truncate flex-1">{receiptFile.name}</span>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => setReceiptFile(null)}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center gap-2 rounded-lg border border-dashed border-muted-foreground/30 p-3 cursor-pointer hover:bg-muted/50 transition-colors">
                        <Camera className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Attach receipt photo</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) setReceiptFile(file);
                          }}
                          data-testid="input-direct-receipt"
                        />
                      </label>
                    )}
                    <p className="text-xs text-muted-foreground">Photo will be sent via email to everyone in the split. Not stored.</p>
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
                      addExpenseMutation.isPending ||
                      addRecurringMutation.isPending
                    }
                    data-testid="submit-direct-expense"
                  >
                    {(addExpenseMutation.isPending || addRecurringMutation.isPending)
                      ? "Adding..."
                      : isRecurring && user?.isPremium
                        ? `Set Up Recurring (${recurringFrequency})`
                        : "Add Expense"}
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
                    They must have a Spliiit account first.
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

      {/* Settle Up Dialog */}
      <Dialog open={settleUpOpen} onOpenChange={(open) => { setSettleUpOpen(open); if (!open) setSettleUpFriend(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settle Up</DialogTitle>
          </DialogHeader>
          {settleUpFriend && (
            <div className="space-y-4 pt-2">
              <div className="rounded-lg bg-muted/50 p-4 text-center space-y-2">
                <p className="text-sm text-muted-foreground">
                  {settleUpFriend.amount < 0 ? (
                    <>You pay <span className="font-semibold text-foreground">{settleUpFriend.name}</span></>
                  ) : (
                    <><span className="font-semibold text-foreground">{settleUpFriend.name}</span> pays you</>
                  )}
                </p>
                <p className="text-2xl font-bold text-primary">
                  ${Math.abs(settleUpFriend.amount).toFixed(2)}
                </p>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                This will record a payment that zeros out your balance with {settleUpFriend.name}.
              </p>
              <Button
                className="w-full"
                onClick={() => settleUpMutation.mutate()}
                disabled={settleUpMutation.isPending}
                data-testid="confirm-settle-up"
              >
                <CheckCircle2 className="w-4 h-4 mr-1.5" />
                {settleUpMutation.isPending ? "Settling..." : "Confirm Settlement"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Friends list with balances */}
      {friendsList.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground font-serif">Your Friends</h2>
          {friendsList.map((friend) => {
            const balance = getFriendBalance(friend.id);
            const hasExpenses = directExpenses.some(
              (e) =>
                (e.paidById === user?.id && e.splitAmongIds.includes(friend.id)) ||
                (e.paidById === friend.id && e.splitAmongIds.includes(user?.id || ""))
            );
            return (
              <Link key={friend.id} href={`/friends/${friend.id}`}>
                <Card
                  className="p-3 flex items-center gap-3 hover-elevate cursor-pointer"
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
                      className={`text-sm font-semibold shrink-0 font-mono ${
                        balance > 0 ? "text-primary" : "text-destructive"
                      }`}
                    >
                      {balance > 0 ? `+$${balance.toFixed(2)}` : `-$${Math.abs(balance).toFixed(2)}`}
                    </span>
                  )}
                  {balance === 0 && hasExpenses && (
                    <span className="text-xs text-muted-foreground shrink-0">settled</span>
                  )}
                  {balance !== 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 text-xs"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleSettleUp(friend); }}
                      data-testid={`settle-up-${friend.id}`}
                    >
                      <HandCoins className="w-3.5 h-3.5 mr-1" />
                      Settle Up
                    </Button>
                  )}
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </Card>
              </Link>
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
          <h2 className="text-sm font-medium text-muted-foreground mb-2 font-serif">Settlements</h2>
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
                <span className="text-sm font-semibold text-primary shrink-0 font-mono">
                  ${s.amount.toFixed(2)}
                </span>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Hint to click friends */}
      {friendsList.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          Tap a friend to see all expenses and settle up
        </p>
      )}
    </div>
  );
}
