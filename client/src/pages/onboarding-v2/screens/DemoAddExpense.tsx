/**
 * Demo Add Expense modal — mirrors the real Add Expense dialog visually but
 * is fully self-contained (no API calls, no balance recompute). Pre-fills
 * description + amount + paid-by based on the persona so the user only has
 * to tap Submit to feel the flow.
 *
 * A prominent "Try Scan with AI" button at the top routes to the AI Scanner
 * sub-flow — this is the on-ramp to the magic moment.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles, X, Check } from "lucide-react";
import type { DemoGroup as DemoGroupType } from "../fixtures";

interface Props {
  group: DemoGroupType;
  onSubmit: (description: string, amount: number, paidById: string) => void;
  onCancel: () => void;
  onTryScanner: () => void;
}

export function DemoAddExpense({ group, onSubmit, onCancel, onTryScanner }: Props) {
  const [description, setDescription] = useState(group.prefilledExpenseDescription);
  const [amount, setAmount] = useState(String(group.prefilledExpenseAmount.toFixed(2)));
  const [paidById, setPaidById] = useState(group.prefilledExpensePaidBy);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (!description.trim() || !isFinite(parsedAmount) || parsedAmount <= 0) return;
    onSubmit(description.trim(), parsedAmount, paidById);
  };

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-4">
        <h2 className="text-xl font-semibold">Add expense</h2>
        <button
          onClick={onCancel}
          className="p-2 -mr-2 rounded-full hover:bg-muted transition-colors"
          aria-label="Cancel"
          data-testid="demo-add-cancel"
        >
          <X className="w-5 h-5 text-muted-foreground" />
        </button>
      </div>

      {/* AI Scanner pitch — the on-ramp to the magic moment */}
      <button
        type="button"
        onClick={onTryScanner}
        className="relative mb-5 w-full bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/30 rounded-2xl p-4 flex items-center gap-3 text-left hover:border-primary/50 active:scale-[0.99] transition-all"
        data-testid="demo-try-scanner"
      >
        <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">Try Scan with AI</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            17-item dinner bill? It's faster than typing.
          </div>
        </div>
        <span className="text-[10px] uppercase tracking-wider font-mono text-primary font-semibold shrink-0">
          Premium
        </span>
      </button>

      {/* Visual divider */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 h-px bg-border" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
          or do it manually
        </span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Manual entry form */}
      <form onSubmit={handleSubmit} className="space-y-4 flex-1 flex flex-col">
        <div className="space-y-1.5">
          <Label htmlFor="demo-desc">Description</Label>
          <Input
            id="demo-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Dinner at Joe's"
            data-testid="demo-desc-input"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="demo-amount">Amount</Label>
          <Input
            id="demo-amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            data-testid="demo-amount-input"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Paid by</Label>
          <div className="grid grid-cols-2 gap-2">
            {group.members.map((m) => {
              const active = m.id === paidById;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPaidById(m.id)}
                  className={`p-2.5 rounded-xl border text-sm font-medium transition-colors ${
                    active
                      ? "bg-primary/10 border-primary/40 text-primary"
                      : "bg-card border-border text-foreground hover:border-primary/30"
                  }`}
                  data-testid={`demo-paid-by-${m.id}`}
                >
                  <span className="flex items-center justify-center gap-1.5">
                    {active && <Check className="w-3.5 h-3.5" />}
                    {m.isYou ? "You" : m.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Split among</Label>
          <div className="text-xs text-muted-foreground bg-muted/40 rounded-xl p-2.5">
            Everyone in the group · split equally
          </div>
        </div>

        <div className="flex-1" />

        <div className="text-center text-sm" style={{ fontFamily: "'Caveat', cursive", color: "hsl(172 63% 45%)" }}>
          ↓ Tap submit — it's already filled in
        </div>
        <Button
          type="submit"
          size="lg"
          className="w-full"
          data-testid="demo-add-submit"
        >
          Submit
        </Button>
      </form>
    </div>
  );
}
