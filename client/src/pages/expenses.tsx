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
import { Plus, Receipt, Trash2, ImagePlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Expenses() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidById, setPaidById] = useState("");
  const [splitAmong, setSplitAmong] = useState<string[]>([]);
  const [groupId, setGroupId] = useState<string>("none");
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);

  const { data: people = [] } = useQuery<Person[]>({ queryKey: ["/api/people"] });
  const { data: groups = [] } = useQuery<Group[]>({ queryKey: ["/api/groups"] });
  const { data: expenses = [] } = useQuery<Expense[]>({ queryKey: ["/api/expenses"] });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/expenses", {
        description: description.trim(),
        amount: parseFloat(amount),
        paidById,
        splitAmongIds: splitAmong,
        groupId: groupId === "none" ? null : groupId,
        receiptUrl: receiptPreview,
        date: new Date().toISOString(),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      resetForm();
      setOpen(false);
      toast({ title: "Expense added" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/expenses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      toast({ title: "Expense removed" });
    },
  });

  const resetForm = () => {
    setDescription("");
    setAmount("");
    setPaidById("");
    setSplitAmong([]);
    setGroupId("none");
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

  // When group changes, auto-set split members
  const handleGroupChange = (val: string) => {
    setGroupId(val);
    if (val !== "none") {
      const group = groups.find((g) => g.id === val);
      if (group) setSplitAmong(group.memberIds);
    } else {
      setSplitAmong([]);
    }
  };

  const getPersonName = (id: string) => people.find((p) => p.id === id)?.name || "Unknown";
  const getGroupName = (id: string | null) => {
    if (!id) return "Direct";
    return groups.find((g) => g.id === id)?.name || "Unknown Group";
  };

  const sortedExpenses = [...expenses].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Expenses</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {expenses.length} expenses · ${totalExpenses.toFixed(2)} total
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" disabled={people.length < 2} data-testid="add-expense-global-btn">
              <Plus className="w-4 h-4 mr-1.5" />
              Add
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
                  createMutation.mutate();
                }
              }}
            >
              <div className="space-y-2">
                <Label>Description</Label>
                <Input
                  placeholder="e.g. Lunch, Uber, Groceries"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  data-testid="input-expense-desc-global"
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
                  data-testid="input-expense-amount-global"
                />
              </div>

              {groups.length > 0 && (
                <div className="space-y-2">
                  <Label>Group (optional)</Label>
                  <Select value={groupId} onValueChange={handleGroupChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="No group (direct)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No group (direct split)</SelectItem>
                      {groups.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label>Paid by</Label>
                <Select value={paidById} onValueChange={setPaidById}>
                  <SelectTrigger data-testid="select-paid-by-global">
                    <SelectValue placeholder="Who paid?" />
                  </SelectTrigger>
                  <SelectContent>
                    {people.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Split among</Label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {people.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        checked={splitAmong.includes(p.id)}
                        onCheckedChange={() => toggleSplit(p.id)}
                      />
                      <span className="text-sm">{p.name}</span>
                      {splitAmong.includes(p.id) && amount && splitAmong.length > 0 && (
                        <span className="text-xs text-muted-foreground ml-auto">
                          ${(parseFloat(amount) / splitAmong.length).toFixed(2)}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              {/* Receipt */}
              <div className="space-y-2">
                <Label>Receipt (optional)</Label>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border cursor-pointer hover:bg-muted/50 transition-colors text-sm text-muted-foreground">
                    <ImagePlus className="w-4 h-4" />
                    {receiptPreview ? "Change" : "Upload"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleReceiptUpload}
                    />
                  </label>
                  {receiptPreview && (
                    <img
                      src={receiptPreview}
                      alt="Receipt"
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
                  createMutation.isPending
                }
                data-testid="submit-expense-global"
              >
                {createMutation.isPending ? "Adding..." : "Add Expense"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {sortedExpenses.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Receipt className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-base font-semibold mb-1">No expenses yet</h3>
          <p className="text-sm text-muted-foreground">
            {people.length < 2
              ? "Add at least 2 friends to start adding expenses."
              : "Add your first expense to start tracking."}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {sortedExpenses.map((expense) => (
            <Card key={expense.id} className="p-3" data-testid={`expense-item-${expense.id}`}>
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
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => deleteMutation.mutate(expense.id)}
                >
                  <Trash2 className="w-4 h-4 text-muted-foreground" />
                </Button>
              </div>
              {expense.receiptUrl && (
                <div className="mt-2 ml-12">
                  <img
                    src={expense.receiptUrl}
                    alt="Receipt"
                    className="w-full max-w-[200px] rounded-lg border border-border"
                  />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
