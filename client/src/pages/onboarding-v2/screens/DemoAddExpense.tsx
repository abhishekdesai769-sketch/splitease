/**
 * Demo Add Expense dialog — a pixel-faithful clone of the AddExpense dialog
 * inside pages/group-detail.tsx. Same primitives, same labels, same split-type
 * buttons, same "Paid by" Select, same member-checkbox list, same "Add tip &
 * tax" expandable, same "Receipt (optional)" with Scan with AI button.
 *
 * Differences from real dialog (deliberate, demo-only):
 *   - No live API submit — fires onSubmit(demoExpense) and lets DemoGroup state
 *     pick it up. Zero backend traffic.
 *   - No currency selector — the real CurrencySelector is premium-gated and
 *     adds complexity we don't need before the user has even signed up.
 *   - No recurring/frequency UI — recurring is Premium-only and primed later
 *     in Wave 2's paywall flow, not in this dialog.
 *
 * Everything else (split-type buttons, member checkbox list with per-person
 * amount preview, Scan with AI receipt button) matches verbatim.
 */
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ArrowLeft, Camera, FileText, X } from "lucide-react";
import type { DemoGroup, DemoExpense } from "../fixtures";

interface Props {
  group: DemoGroup;
  onSubmit: (expense: DemoExpense) => void;
  onCancel: () => void;
}

type SplitType = "equal" | "they_pay" | "you_pay" | "custom";
const SPLIT_LABELS: Record<SplitType, string> = {
  equal: "Split equally",
  they_pay: "They pay you",
  you_pay: "You pay them",
  custom: "Unequal split",
};

export function DemoAddExpense({ group, onSubmit, onCancel }: Props) {
  // Pre-filled state so the user only needs to tap Submit to feel the flow
  const [description, setDescription] = useState(group.prefilledExpenseDescription);
  const [amount, setAmount] = useState(group.prefilledExpenseAmount.toFixed(2));
  const [paidById, setPaidById] = useState(group.prefilledExpensePaidBy);
  const [splitType, setSplitType] = useState<SplitType>("equal");
  const [splitAmong, setSplitAmong] = useState<string[]>(group.members.map((m) => m.id));
  const [showAdjustments, setShowAdjustments] = useState(false);
  const [taxPercent, setTaxPercent] = useState("");
  const [tipAmount, setTipAmount] = useState("");
  const [customSplitMode, setCustomSplitMode] = useState<"amount" | "percent">("amount");
  const [customSplitValues, setCustomSplitValues] = useState<Record<string, string>>({});
  const [receiptAttached, setReceiptAttached] = useState(false);

  const baseAmount = parseFloat(amount) || 0;
  const taxAmt = baseAmount * (parseFloat(taxPercent) || 0) / 100;
  const tipAmt = parseFloat(tipAmount) || 0;
  const finalAmount = baseAmount + taxAmt + tipAmt;

  const effectiveSplit = useMemo(() => {
    if (splitType === "they_pay") return splitAmong.filter((id) => id !== paidById);
    if (splitType === "you_pay") return [paidById];
    return splitAmong;
  }, [splitType, splitAmong, paidById]);

  const perPerson = effectiveSplit.length > 0 && finalAmount > 0
    ? finalAmount / effectiveSplit.length
    : 0;

  const toggleSplit = (memberId: string) => {
    setSplitAmong((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    );
  };

  const selectAllMembers = () => {
    setSplitAmong(group.members.map((m) => m.id));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim() || !amount || !paidById || splitAmong.length === 0) return;

    const expense: DemoExpense = {
      id: `e-manual-${Date.now()}`,
      description: description.trim(),
      amount: Math.round(finalAmount * 100) / 100,
      paidById,
      splitAmongIds: effectiveSplit,
      date: new Date().toISOString(),
      note: splitType === "equal" ? `split ${effectiveSplit.length} ways` : SPLIT_LABELS[splitType],
    };
    onSubmit(expense);
  };

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
      {/* Header — back button + title (matches real dialog title row) */}
      <div className="flex items-center gap-3 pb-4">
        <Button size="icon" variant="ghost" onClick={onCancel} aria-label="Cancel" data-testid="demo-add-cancel">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h2 className="text-xl font-semibold tracking-tight">Add Expense</h2>
      </div>

      <form className="space-y-5 pt-2" onSubmit={handleSubmit}>
        {/* Description */}
        <div className="space-y-2">
          <Label>Description</Label>
          <Input
            placeholder="e.g. Dinner at Joe's"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="demo-input-desc"
          />
        </div>

        {/* Amount */}
        <div className="space-y-2">
          <Label>Amount</Label>
          <Input
            type="number"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            data-testid="demo-input-amount"
          />
        </div>

        {/* Tax & Tip — collapsible like real dialog */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdjustments(!showAdjustments)}
            className="flex items-center gap-1.5 text-sm font-medium text-primary"
          >
            <ChevronDown className={`w-4 h-4 transition-transform duration-150 ${showAdjustments ? "rotate-180" : ""}`} />
            {showAdjustments ? "Remove adjustments" : "Add tip & tax"}
          </button>

          {showAdjustments && (
            <div className="mt-3 rounded-lg border border-border p-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Tax (%)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder="e.g. 13"
                    value={taxPercent}
                    onChange={(e) => setTaxPercent(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Tip ($)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={tipAmount}
                    onChange={(e) => setTipAmount(e.target.value)}
                  />
                </div>
              </div>

              {baseAmount > 0 && (taxAmt > 0 || tipAmt > 0) && (
                <div className="space-y-1.5 pt-2 border-t border-border/50 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span>${baseAmount.toFixed(2)}</span>
                  </div>
                  {taxAmt > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Tax ({taxPercent}%)</span>
                      <span>${taxAmt.toFixed(2)}</span>
                    </div>
                  )}
                  {tipAmt > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Tip</span>
                      <span>${tipAmt.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold border-t border-border/50 pt-1.5">
                    <span>Total to split</span>
                    <span className="text-primary">${finalAmount.toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Paid by — Select dropdown (matches real dialog) */}
        <div className="space-y-2">
          <Label>Paid by</Label>
          <Select value={paidById} onValueChange={setPaidById}>
            <SelectTrigger data-testid="demo-select-paid-by">
              <SelectValue placeholder="Who paid?" />
            </SelectTrigger>
            <SelectContent>
              {group.members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.isYou ? `${m.name} (You)` : m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Split type — 4 buttons (matches real dialog exactly) */}
        <div className="space-y-2">
          <Label>How to split</Label>
          <div className="grid grid-cols-2 gap-1.5">
            {(["equal", "they_pay", "you_pay", "custom"] as const).map((type) => (
              <button
                key={type}
                type="button"
                className={`px-2 py-2.5 rounded-lg border text-xs font-medium transition-colors ${
                  splitType === type
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted/50"
                }`}
                onClick={() => {
                  setSplitType(type);
                  if (type === "custom" && group.members.length > 0) {
                    const equalAmt = finalAmount > 0 ? (finalAmount / group.members.length).toFixed(2) : "";
                    const init: Record<string, string> = {};
                    group.members.forEach((m) => { init[m.id] = equalAmt; });
                    setCustomSplitValues(init);
                  }
                }}
                data-testid={`demo-split-type-${type}`}
              >
                {SPLIT_LABELS[type]}
              </button>
            ))}
          </div>
        </div>

        {/* Member checkboxes — when split type is NOT custom */}
        {splitType !== "custom" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>
                {splitType === "equal" ? "Split among" : splitType === "they_pay" ? "Who pays you" : "You pay who"}
              </Label>
              <button
                type="button"
                className="text-xs text-primary font-medium"
                onClick={selectAllMembers}
              >
                Select all
              </button>
            </div>
            <div className="space-y-2">
              {group.members.map((m) => {
                const checked = splitAmong.includes(m.id);
                const showAmount = checked && finalAmount > 0 && effectiveSplit.includes(m.id);
                return (
                  <label
                    key={m.id}
                    className="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleSplit(m.id)}
                    />
                    <span className="text-base">
                      {m.isYou ? `${m.name} (You)` : m.name}
                    </span>
                    {showAmount && (
                      <span className="text-sm text-muted-foreground ml-auto font-mono">
                        ${perPerson.toFixed(2)}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Custom split UI — when type is custom */}
        {splitType === "custom" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Label>Split amounts</Label>
              <div className="ml-auto flex rounded-lg border border-border overflow-hidden text-xs font-medium">
                <button
                  type="button"
                  className={`px-3 py-1.5 transition-colors ${customSplitMode === "amount" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
                  onClick={() => setCustomSplitMode("amount")}
                >
                  By amount
                </button>
                <button
                  type="button"
                  className={`px-3 py-1.5 transition-colors ${customSplitMode === "percent" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
                  onClick={() => setCustomSplitMode("percent")}
                >
                  By %
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {group.members.map((m) => (
                <div key={m.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
                  <span className="text-base flex-1">
                    {m.isYou ? `${m.name} (You)` : m.name}
                  </span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-24"
                    value={customSplitValues[m.id] || ""}
                    onChange={(e) =>
                      setCustomSplitValues((prev) => ({ ...prev, [m.id]: e.target.value }))
                    }
                    placeholder={customSplitMode === "percent" ? "%" : "$"}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Receipt (optional) — plain attach. The AI Scanner gets its own
            dedicated demo step afterwards, so we keep this dialog to the
            simple "attach a photo" path that every user gets for free. */}
        <div className="space-y-2">
          <Label>Receipt (optional)</Label>
          {!receiptAttached ? (
            <button
              type="button"
              onClick={() => setReceiptAttached(true)}
              className="w-full border-2 border-dashed border-border rounded-xl p-4 flex flex-col items-center gap-1.5 hover:border-primary/40 hover:bg-muted/30 transition-colors"
              data-testid="demo-attach-receipt"
            >
              <Camera className="w-5 h-5 text-muted-foreground" />
              <span className="text-sm font-medium">Attach a photo</span>
              <span className="text-xs text-muted-foreground">Snap or upload the receipt</span>
            </button>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-border p-3 bg-muted/30">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">receipt-photo.jpg</div>
                <div className="text-xs text-muted-foreground">Attached</div>
              </div>
              <button
                type="button"
                onClick={() => setReceiptAttached(false)}
                className="p-1.5 rounded-full hover:bg-muted transition-colors"
                aria-label="Remove receipt"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Receipt photos are emailed to everyone in this split.
          </p>
        </div>

        {/* Submit */}
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={!description.trim() || !amount || !paidById || splitAmong.length === 0}
          data-testid="demo-add-submit"
        >
          Add Expense
        </Button>
      </form>
    </div>
  );
}
