/**
 * Personal Finance (Premium) — the Money tab's main experience.
 *
 * User-private income/expense tracking, fully separate from group splitting.
 * Data lives in personal_transactions/personal_categories (never the expenses
 * table). Rendered only for Premium users inside money.tsx.
 *
 * Phase 1: manual entry, keyword auto-categorize, monthly dashboard +
 * spending donut, edit/delete, onboarding intro, and a "Split this" bridge
 * that hands a personal expense to the friend/group split flow.
 */

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Plus, TrendingUp, TrendingDown, Wallet, Trash2,
  ChevronLeft, ChevronRight, Split, Sparkles, X,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { AMOUNT_IN_CLASS, AMOUNT_OUT_CLASS } from "@/lib/balance-display";
import type { PersonalCategory, PersonalTransaction } from "@shared/schema";

const PF_ONBOARDED_KEY = "spliiit_pf_onboarded";
const SPLIT_DRAFT_KEY = "spliiit_split_draft";

// ── helpers ────────────────────────────────────────────────────────────
function fmt(n: number): string {
  return `$${Math.abs(n).toFixed(2)}`;
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}

// Lightweight, free keyword auto-categorization — no AI cost.
const KEYWORD_MAP: Array<{ re: RegExp; cat: string }> = [
  { re: /uber|lyft|transit|gas|fuel|parking|\bbus\b|train|metro|presto/i, cat: "Transport" },
  { re: /grocer|supermarket|costco|walmart|loblaws|sobeys|food basics|no frills|superstore/i, cat: "Groceries" },
  { re: /restaurant|cafe|coffee|starbucks|tim hortons|mcdonald|pizza|sushi|dinner|lunch|\bbar\b|\bpub\b/i, cat: "Dining" },
  { re: /rent|landlord|mortgage/i, cat: "Rent" },
  { re: /hydro|electric|water bill|internet|wifi|phone bill|rogers|\bbell\b|telus|fido/i, cat: "Utilities" },
  { re: /amazon|\bshop\b|\bstore\b|\bmall\b|clothes|nike|zara|best buy/i, cat: "Shopping" },
  { re: /netflix|spotify|disney|subscription|\bprime\b|youtube|icloud|\bgym\b/i, cat: "Subscriptions" },
  { re: /movie|cinema|concert|\bgame\b|steam|entertain/i, cat: "Entertainment" },
  { re: /pharma|doctor|dentist|clinic|health|medical|\bdrug\b/i, cat: "Health" },
  { re: /salary|paycheck|payroll|wage|deposit|refund/i, cat: "Salary" },
];
function suggestCategoryId(desc: string, cats: PersonalCategory[]): string | null {
  for (const { re, cat } of KEYWORD_MAP) {
    if (re.test(desc)) {
      const match = cats.find((c) => c.name === cat);
      if (match) return match.id;
    }
  }
  return null;
}

interface SavePayload {
  type: "expense" | "income";
  amount: number;
  description: string;
  categoryId: string | null;
  date: string;
  notes: string | null;
}

export function PersonalFinance() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<PersonalTransaction | null>(null);
  const [showIntro, setShowIntro] = useState(() => {
    try { return localStorage.getItem(PF_ONBOARDED_KEY) !== "1"; } catch { return false; }
  });

  const dismissIntro = () => {
    try { localStorage.setItem(PF_ONBOARDED_KEY, "1"); } catch {}
    setShowIntro(false);
  };

  const categoriesQuery = useQuery<{ categories: PersonalCategory[] }>({
    queryKey: ["/api/personal/categories"],
    staleTime: 10 * 60 * 1000,
  });
  const txQuery = useQuery<{ transactions: PersonalTransaction[] }>({
    queryKey: ["/api/personal/transactions", month],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/personal/transactions?month=${month}`);
      return res.json();
    },
    staleTime: 30 * 1000,
  });

  const categories = categoriesQuery.data?.categories ?? [];
  const catById = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])) as Record<string, PersonalCategory>,
    [categories],
  );
  const transactions = txQuery.data?.transactions ?? [];

  const { income, expense, net, byCat } = useMemo(() => {
    let inc = 0, exp = 0;
    const map = new Map<string, number>();
    for (const t of transactions) {
      if (t.type === "income") { inc += t.amount; }
      else {
        exp += t.amount;
        const key = t.categoryId || "uncat";
        map.set(key, (map.get(key) || 0) + t.amount);
      }
    }
    const segs = Array.from(map.entries())
      .map(([id, value]) => ({
        id,
        value,
        name: id === "uncat" ? "Uncategorized" : (catById[id]?.name ?? "Other"),
        color: id === "uncat" ? "#94a3b8" : (catById[id]?.color ?? "#64748b"),
      }))
      .sort((a, b) => b.value - a.value);
    return { income: inc, expense: exp, net: inc - exp, byCat: segs };
  }, [transactions, catById]);

  const saveMutation = useMutation({
    mutationFn: async (payload: SavePayload) => {
      if (editing) {
        const res = await apiRequest("PATCH", `/api/personal/transactions/${editing.id}`, payload);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/personal/transactions", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/personal/transactions"] });
      toast({ title: editing ? "Transaction updated" : "Transaction added" });
      setSheetOpen(false);
      setEditing(null);
    },
    onError: (err: Error) => toast({ title: "Couldn't save", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/personal/transactions/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/personal/transactions"] });
      toast({ title: "Deleted" });
      setSheetOpen(false);
      setEditing(null);
    },
    onError: (err: Error) => toast({ title: "Couldn't delete", description: err.message, variant: "destructive" }),
  });

  const openNew = () => { setEditing(null); setSheetOpen(true); };
  const openEdit = (t: PersonalTransaction) => { setEditing(t); setSheetOpen(true); };

  // Bridge: stash a draft and head to Friends to turn this into a split.
  const splitToGroup = (t: PersonalTransaction) => {
    try {
      sessionStorage.setItem(SPLIT_DRAFT_KEY, JSON.stringify({ amount: t.amount, description: t.description }));
    } catch {}
    toast({ title: "Let's split it", description: "Pick who to split this with." });
    setLocation("/friends");
  };

  const thisMonth = monthKey(new Date());
  const isFuture = month >= thisMonth;
  const isLoading = txQuery.isLoading || categoriesQuery.isLoading;
  const isError = txQuery.isError || categoriesQuery.isError;

  return (
    <div className="space-y-5">
      {showIntro && (
        <Card className="p-4 bg-primary/5 border-primary/30 relative">
          <button onClick={dismissIntro} className="absolute top-2 right-2 p-1 text-muted-foreground hover:text-foreground" aria-label="Dismiss intro">
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-start gap-3">
            <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 shrink-0">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div className="pr-5">
              <p className="text-sm font-semibold mb-1">Welcome to Money</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Track your own income &amp; spending here — separate from anything you split with friends.
                Add a transaction, see where your money goes, and tap <Split className="w-3 h-3 inline -mt-0.5" /> on any
                expense to split it with your group.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Month switcher */}
      <div className="flex items-center justify-between">
        <button onClick={() => setMonth((m) => shiftMonth(m, -1))} className="p-2 rounded-lg hover:bg-muted transition-colors" aria-label="Previous month">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h2 className="text-base font-semibold">{monthLabel(month)}</h2>
        <button onClick={() => !isFuture && setMonth((m) => shiftMonth(m, 1))} disabled={isFuture} className="p-2 rounded-lg hover:bg-muted transition-colors disabled:cursor-not-allowed" aria-label="Next month">
          <ChevronRight className={`w-5 h-5 ${isFuture ? "opacity-30" : ""}`} />
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2">
        <Card className="p-3 text-center">
          <TrendingUp className={`w-4 h-4 mx-auto mb-1 ${AMOUNT_IN_CLASS}`} />
          <p className="text-[11px] text-muted-foreground">Income</p>
          <p className={`text-sm font-semibold font-mono ${AMOUNT_IN_CLASS}`}>{fmt(income)}</p>
        </Card>
        <Card className="p-3 text-center">
          <TrendingDown className={`w-4 h-4 mx-auto mb-1 ${AMOUNT_OUT_CLASS}`} />
          <p className="text-[11px] text-muted-foreground">Spent</p>
          <p className={`text-sm font-semibold font-mono ${AMOUNT_OUT_CLASS}`}>{fmt(expense)}</p>
        </Card>
        <Card className="p-3 text-center">
          <Wallet className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
          <p className="text-[11px] text-muted-foreground">Net</p>
          <p className={`text-sm font-semibold font-mono ${net >= 0 ? AMOUNT_IN_CLASS : AMOUNT_OUT_CLASS}`}>
            {net < 0 ? "-" : ""}{fmt(net)}
          </p>
        </Card>
      </div>

      {/* Spending donut */}
      {byCat.length > 0 && (
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Where it went</p>
          <div className="flex items-center gap-4">
            <div className="w-32 h-32 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={byCat} dataKey="value" nameKey="name" innerRadius={38} outerRadius={60} paddingAngle={2} stroke="none">
                    {byCat.map((s) => <Cell key={s.id} fill={s.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 min-w-0 space-y-1.5">
              {byCat.slice(0, 5).map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="truncate flex-1">{s.name}</span>
                  <span className="font-mono text-muted-foreground">{fmt(s.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Transactions */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Transactions</h3>
          <Button size="sm" onClick={openNew}><Plus className="w-4 h-4 mr-1" />Add</Button>
        </div>

        {isError ? (
          <Card className="p-6 text-center space-y-2">
            <p className="text-sm font-medium">Couldn't load your transactions</p>
            <Button size="sm" variant="outline" onClick={() => { txQuery.refetch(); categoriesQuery.refetch(); }}>Try again</Button>
          </Card>
        ) : isLoading ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">Loading…</Card>
        ) : transactions.length === 0 ? (
          <Card className="p-8 text-center space-y-3">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10"><Wallet className="w-6 h-6 text-primary" /></div>
            <p className="text-sm font-medium">Nothing logged for {monthLabel(month)}</p>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">Add your income and spending to see where your money goes.</p>
            <Button size="sm" onClick={openNew}><Plus className="w-4 h-4 mr-1" />Add your first</Button>
          </Card>
        ) : (
          <Card className="divide-y divide-border overflow-hidden">
            {transactions.map((t) => {
              const cat = t.categoryId ? catById[t.categoryId] : null;
              const isIncome = t.type === "income";
              return (
                <div key={t.id} className="flex items-center gap-2 px-3 py-2.5">
                  <button onClick={() => openEdit(t)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                    <span className="text-lg shrink-0">{cat?.emoji ?? (isIncome ? "💰" : "💸")}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{t.description}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{cat?.name ?? "Uncategorized"} · {t.date.slice(5)}</p>
                    </div>
                    <span className={`text-sm font-semibold font-mono shrink-0 ${isIncome ? AMOUNT_IN_CLASS : AMOUNT_OUT_CLASS}`}>
                      {isIncome ? "+" : "-"}{fmt(t.amount)}
                    </span>
                  </button>
                  {!isIncome && (
                    <button onClick={() => splitToGroup(t)} title="Split with friends" aria-label="Split with friends" className="p-1.5 text-muted-foreground hover:text-primary shrink-0">
                      <Split className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </Card>
        )}
      </div>

      <TransactionSheet
        open={sheetOpen}
        onOpenChange={(o) => { setSheetOpen(o); if (!o) setEditing(null); }}
        editing={editing}
        categories={categories}
        onSave={(payload) => saveMutation.mutate(payload)}
        onDelete={(id) => deleteMutation.mutate(id)}
        saving={saveMutation.isPending}
        deleting={deleteMutation.isPending}
      />
    </div>
  );
}

// ── Add / edit form ─────────────────────────────────────────────────────
function TransactionSheet({
  open, onOpenChange, editing, categories, onSave, onDelete, saving, deleting,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: PersonalTransaction | null;
  categories: PersonalCategory[];
  onSave: (p: SavePayload) => void;
  onDelete: (id: string) => void;
  saving: boolean;
  deleting: boolean;
}) {
  const [type, setType] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [touchedCat, setTouchedCat] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setType(editing.type === "income" ? "income" : "expense");
      setAmount(String(editing.amount));
      setDescription(editing.description);
      setCategoryId(editing.categoryId);
      setDate(editing.date);
      setNotes(editing.notes ?? "");
      setTouchedCat(true);
    } else {
      setType("expense"); setAmount(""); setDescription(""); setCategoryId(null);
      setDate(todayISO()); setNotes(""); setTouchedCat(false);
    }
  }, [open, editing]);

  // Auto-suggest a category from the description until the user picks one.
  useEffect(() => {
    if (!touchedCat && description.trim().length >= 3) {
      const suggested = suggestCategoryId(description, categories);
      if (suggested) setCategoryId(suggested);
    }
  }, [description, touchedCat, categories]);

  const visibleCats = categories.filter((c) => c.kind === type);
  const canSave = Number(amount) > 0 && description.trim().length > 0;

  const submit = () => {
    if (!canSave) return;
    onSave({
      type,
      amount: Number(amount),
      description: description.trim(),
      categoryId: categoryId || null,
      date,
      notes: notes.trim() || null,
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>{editing ? "Edit transaction" : "Add transaction"}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => { setType("expense"); setCategoryId(null); setTouchedCat(false); }}
              className={`py-2 rounded-lg text-sm font-medium border transition-colors ${type === "expense" ? "bg-destructive/10 border-destructive/40 text-destructive" : "border-border text-muted-foreground"}`}
            >Expense</button>
            <button
              onClick={() => { setType("income"); setCategoryId(null); setTouchedCat(false); }}
              className={`py-2 rounded-lg text-sm font-medium border transition-colors ${type === "income" ? `bg-green-500/10 border-green-500/40 ${AMOUNT_IN_CLASS}` : "border-border text-muted-foreground"}`}
            >Income</button>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Amount</label>
            <Input type="number" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-lg font-mono mt-1" />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <Input placeholder={type === "income" ? "e.g. Paycheck" : "e.g. Groceries at Costco"} value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1" maxLength={200} />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Category</label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {visibleCats.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setCategoryId(c.id); setTouchedCat(true); }}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${categoryId === c.id ? "border-primary bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground"}`}
                >{c.emoji} {c.name}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Date</label>
            <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} className="mt-1" />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
            <Input placeholder="Anything to remember" value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" maxLength={500} />
          </div>

          <div className="flex gap-2 pt-1">
            {editing && (
              <Button variant="outline" className="text-destructive shrink-0" onClick={() => onDelete(editing.id)} disabled={deleting} aria-label="Delete transaction">
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
            <Button className="flex-1" onClick={submit} disabled={!canSave || saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Add transaction"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
