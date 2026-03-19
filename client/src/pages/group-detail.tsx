import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Person, Group, Expense } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, ArrowLeft, Trash2, Shuffle, Receipt, ImagePlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { calculateGroupBalances, simplifyDebts } from "@/lib/simplify";

export default function GroupDetail({ groupId }: { groupId: string }) {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [showSimplified, setShowSimplified] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidById, setPaidById] = useState("");
  const [splitAmong, setSplitAmong] = useState<string[]>([]);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);

  const { data: group } = useQuery<Group>({ queryKey: ["/api/groups", groupId] });
  const { data: people = [] } = useQuery<Person[]>({ queryKey: ["/api/people"] });
  const { data: expenses = [] } = useQuery<Expense[]>({ queryKey: ["/api/expenses/group", groupId] });

  const members = people.filter((p) => group?.memberIds.includes(p.id));

  const createExpenseMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/expenses", {
        description: description.trim(),
        amount: parseFloat(amount),
        paidById,
        splitAmongIds: splitAmong,
        groupId,
        receiptUrl: receiptPreview,
        date: new Date().toISOString(),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/group", groupId] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      resetForm();
      setAddOpen(false);
      toast({ title: "Expense added" });
    },
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/expenses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/group", groupId] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      toast({ title: "Expense removed" });
    },
  });

  const resetForm = () => {
    setDescription("");
    setAmount("");
    setPaidById("");
    setSplitAmong([]);
    setReceiptPreview(null);
  };

  const handleReceiptUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 5MB", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setReceiptPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const toggleSplit = (id: string) => {
    setSplitAmong((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const selectAllMembers = () => {
    setSplitAmong(members.map((m) => m.id));
  };

  // Balance calculations
  const balances = calculateGroupBalances(expenses);
  const settlements = simplifyDebts(balances);
  const getPersonName = (id: string) => people.find((p) => p.id === id)?.name || "Unknown";
  const getPersonColor = (id: string) => people.find((p) => p.id === id)?.avatarColor || "#666";

  const totalGroupSpend = expenses.reduce((sum, e) => sum + e.amount, 0);

  if (!group) {
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
        <Link href="/groups">
          <Button size="icon" variant="ghost" data-testid="back-to-groups">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold tracking-tight truncate">{group.name}</h1>
          <p className="text-sm text-muted-foreground">
            {members.length} members · ${totalGroupSpend.toFixed(2)} total
          </p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="add-expense-btn">
              <Plus className="w-4 h-4 mr-1.5" />
              Expense
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Expense</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-4 pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (description.trim() && amount && paidById && splitAmong.length > 0) {
                  createExpenseMutation.mutate();
                }
              }}
            >
              <div className="space-y-2">
                <Label>Description</Label>
                <Input
                  placeholder="e.g. Dinner at Joe's"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  data-testid="input-expense-desc"
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
                  data-testid="input-expense-amount"
                />
              </div>
              <div className="space-y-2">
                <Label>Paid by</Label>
                <Select value={paidById} onValueChange={setPaidById}>
                  <SelectTrigger data-testid="select-paid-by">
                    <SelectValue placeholder="Who paid?" />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Split among</Label>
                  <button
                    type="button"
                    className="text-xs text-primary font-medium"
                    onClick={selectAllMembers}
                  >
                    Select all
                  </button>
                </div>
                <div className="space-y-1.5">
                  {members.map((m) => (
                    <label
                      key={m.id}
                      className="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        checked={splitAmong.includes(m.id)}
                        onCheckedChange={() => toggleSplit(m.id)}
                      />
                      <span className="text-sm">{m.name}</span>
                      {splitAmong.includes(m.id) && amount && splitAmong.length > 0 && (
                        <span className="text-xs text-muted-foreground ml-auto">
                          ${(parseFloat(amount) / splitAmong.length).toFixed(2)}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              {/* Receipt upload */}
              <div className="space-y-2">
                <Label>Receipt (optional)</Label>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border cursor-pointer hover:bg-muted/50 transition-colors text-sm text-muted-foreground">
                    <ImagePlus className="w-4 h-4" />
                    {receiptPreview ? "Change photo" : "Upload photo"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleReceiptUpload}
                      data-testid="input-receipt"
                    />
                  </label>
                  {receiptPreview && (
                    <img
                      src={receiptPreview}
                      alt="Receipt preview"
                      className="w-12 h-12 rounded-lg object-cover border border-border"
                    />
                  )}
                </div>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={
                  !description.trim() ||
                  !amount ||
                  !paidById ||
                  splitAmong.length === 0 ||
                  createExpenseMutation.isPending
                }
                data-testid="submit-expense"
              >
                {createExpenseMutation.isPending ? "Adding..." : "Add Expense"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Members bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {members.map((m) => (
          <div key={m.id} className="flex flex-col items-center gap-1 shrink-0">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold"
              style={{ backgroundColor: m.avatarColor }}
            >
              {m.name[0]?.toUpperCase()}
            </div>
            <span className="text-xs text-muted-foreground truncate max-w-[48px]">
              {m.name.split(" ")[0]}
            </span>
          </div>
        ))}
      </div>

      {/* Simplify Debts */}
      {expenses.length > 0 && (
        <div>
          <Button
            variant="secondary"
            size="sm"
            className="w-full mb-3"
            onClick={() => setShowSimplified(!showSimplified)}
            data-testid="simplify-debts-btn"
          >
            <Shuffle className="w-4 h-4 mr-1.5" />
            {showSimplified ? "Hide Simplified Debts" : "Simplify Debts"}
          </Button>

          {showSimplified && settlements.length > 0 && (
            <div className="space-y-2 mb-4">
              <h3 className="text-sm font-medium text-muted-foreground">Simplified settlements:</h3>
              {settlements.map((s, i) => (
                <Card key={i} className="p-3 flex items-center gap-2">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                    style={{ backgroundColor: getPersonColor(s.from) }}
                  >
                    {getPersonName(s.from)[0]?.toUpperCase()}
                  </div>
                  <span className="text-sm text-muted-foreground">→</span>
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                    style={{ backgroundColor: getPersonColor(s.to) }}
                  >
                    {getPersonName(s.to)[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{getPersonName(s.from)}</span>
                      <span className="text-muted-foreground"> pays </span>
                      <span className="font-medium">{getPersonName(s.to)}</span>
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-primary shrink-0">
                    ${s.amount.toFixed(2)}
                  </span>
                </Card>
              ))}
              {settlements.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">All settled up.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Expense list */}
      {expenses.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Expenses</h3>
          {[...expenses]
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .map((expense) => (
              <Card key={expense.id} className="p-3" data-testid={`expense-card-${expense.id}`}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Receipt className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{expense.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {getPersonName(expense.paidById)} paid · split {expense.splitAmongIds.length} ways
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
                {expense.receiptUrl && (
                  <div className="mt-2 ml-12">
                    <img
                      src={expense.receiptUrl}
                      alt="Receipt"
                      className="w-full max-w-[200px] rounded-lg border border-border cursor-pointer"
                      onClick={() => window.open(expense.receiptUrl!, "_blank")}
                    />
                  </div>
                )}
              </Card>
            ))}
        </div>
      ) : (
        <Card className="p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Receipt className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-base font-semibold mb-1">No expenses yet</h3>
          <p className="text-sm text-muted-foreground">
            Add your first expense to this group.
          </p>
        </Card>
      )}

      {/* Per-member balances */}
      {balances.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Member Balances</h3>
          <div className="space-y-1.5">
            {balances.map((b) => (
              <div key={b.personId} className="flex items-center justify-between gap-2 px-1">
                <span className="text-sm">{getPersonName(b.personId)}</span>
                <span
                  className={`text-sm font-semibold ${
                    b.amount > 0 ? "text-primary" : b.amount < 0 ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  {b.amount > 0 ? "gets back" : b.amount < 0 ? "owes" : "settled"}{" "}
                  {b.amount !== 0 && `$${Math.abs(b.amount).toFixed(2)}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
