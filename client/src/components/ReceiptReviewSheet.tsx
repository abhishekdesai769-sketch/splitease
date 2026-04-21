import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, ArrowRight, Receipt, Users2, CheckCircle2, X, Plus, AlertTriangle } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReceiptItem {
  name: string;
  price: number;
}

export interface ReceiptData {
  merchant: string;
  date: string | null;
  items: ReceiptItem[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
}

export interface Member {
  id: string;
  name: string;
}

export interface ItemSplit {
  description: string;
  amount: number;
  splitAmongIds: string[];
}

interface Props {
  open: boolean;
  data: ReceiptData;
  /** Pass group/friend members to enable the "Split by items" flow */
  members?: Member[];
  /** Called when user confirms a single expense (use total) */
  onConfirm: (merchant: string, total: number, date?: string) => void;
  /** Called when user completes per-item assignment */
  onItemSplit?: (splits: ItemSplit[]) => void;
  onClose: () => void;
}

type Step =
  | "merchant"
  | "total"
  | "items-overview"
  | "equal-select"
  | "assign-person"
  | "summary";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ReceiptReviewSheet({ open, data, members, onConfirm, onItemSplit, onClose }: Props) {
  // Editable top-level fields
  const [merchant, setMerchant] = useState(data.merchant);
  const [total, setTotal] = useState(String(data.total ?? ""));
  const [editableDate, setEditableDate] = useState(data.date ?? "");

  // Step machine
  const [step, setStep] = useState<Step>("merchant");

  // Editable items (mutable copy of scanned items)
  const [editableItems, setEditableItems] = useState<ReceiptItem[]>(data.items);

  // Item splitting state
  const [equalIndices, setEqualIndices] = useState<Set<number>>(new Set(data.items.map((_, i) => i)));
  const [assigningPersonIdx, setAssigningPersonIdx] = useState(0);
  const [assignments, setAssignments] = useState<Map<number, Set<string>>>(new Map());

  // Alert when unassigned items remain
  const [unassignedAlert, setUnassignedAlert] = useState(false);

  // Derived
  const parsedTotal = parseFloat(total);
  const totalIsValid = !isNaN(parsedTotal) && parsedTotal > 0;
  const hasItems = editableItems.length > 0;
  const canSplitByItems = hasItems && members && members.length > 1 && !!onItemSplit;

  const unequalIndices = editableItems.map((_, i) => i).filter((i) => !equalIndices.has(i));

  // Sum mismatch detection
  const itemsSum = Math.round(editableItems.reduce((sum, item) => sum + Number(item.price), 0) * 100) / 100;
  const referenceAmount = data.subtotal != null ? data.subtotal : (totalIsValid ? parsedTotal : null);
  const hasMismatch = referenceAmount != null && Math.abs(itemsSum - referenceAmount) > 0.02;
  const mismatchLabel = data.subtotal != null
    ? `subtotal ($${Number(data.subtotal).toFixed(2)})`
    : `total ($${parsedTotal.toFixed(2)})`;

  // Proportional tax: taxMultiplier = total / subtotal (e.g. 34.19 / 29.73 = 1.1500...)
  // Each item expense will be multiplied by this so tax is distributed by purchase weight.
  const hasTaxData = data.subtotal != null && data.tax != null && Number(data.subtotal) > 0;
  const taxMultiplier = hasTaxData ? Number(data.total!) / Number(data.subtotal!) : 1;

  // ── Step navigation ──────────────────────────────────────────────────────

  const goBack = () => {
    if (step === "total") return setStep("merchant");
    if (step === "items-overview") return setStep("total");
    if (step === "equal-select") return setStep("items-overview");
    if (step === "assign-person") {
      if (assigningPersonIdx === 0) return setStep("equal-select");
      setAssigningPersonIdx((i) => i - 1);
    }
    if (step === "summary") {
      if (unequalIndices.length > 0 && members && members.length > 0) {
        setAssigningPersonIdx(members.length - 1);
        setStep("assign-person");
      } else {
        setStep("equal-select");
      }
    }
  };

  const advanceFromAssignPerson = () => {
    const isLastPerson = assigningPersonIdx === (members?.length ?? 1) - 1;
    if (isLastPerson) {
      // Validate: every unequal item must have at least one member assigned
      const hasUnassigned = unequalIndices.some((idx) => (assignments.get(idx)?.size ?? 0) === 0);
      if (hasUnassigned) {
        setUnassignedAlert(true);
        return;
      }
      setStep("summary");
    } else {
      setAssigningPersonIdx((p) => p + 1);
    }
  };

  // ── Item editing helpers ─────────────────────────────────────────────────

  const updateItem = (idx: number, field: keyof ReceiptItem, value: string | number) => {
    setEditableItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  };

  const removeItem = (idx: number) => {
    setEditableItems(prev => prev.filter((_, i) => i !== idx));
    // Shift equalIndices: remove deleted, decrement higher indices
    setEqualIndices(prev => {
      const next = new Set<number>();
      for (const i of prev) {
        if (i < idx) next.add(i);
        else if (i > idx) next.add(i - 1);
      }
      return next;
    });
  };

  const addItem = () => {
    const newIdx = editableItems.length;
    setEditableItems(prev => [...prev, { name: "", price: 0 }]);
    setEqualIndices(prev => new Set([...prev, newIdx]));
  };

  // ── Confirm (use total) ─────────────────────────────────────────────────

  const handleConfirmTotal = () => {
    if (!totalIsValid) return;
    onConfirm(merchant.trim() || data.merchant, parsedTotal, editableDate || undefined);
  };

  // ── Build final splits and submit ───────────────────────────────────────

  const handleCreateSplits = () => {
    if (!members || !onItemSplit) return;
    const allMemberIds = members.map((m) => m.id);
    const splits: ItemSplit[] = [];

    const equalItems = editableItems.filter((_, i) => equalIndices.has(i));
    if (equalItems.length > 0) {
      const preTax = equalItems.reduce((sum, it) => sum + Number(it.price), 0);
      const withTax = Math.round(preTax * taxMultiplier * 100) / 100;
      const desc = equalItems.length === 1
        ? equalItems[0].name
        : `${equalItems[0].name} + ${equalItems.length - 1} more`;
      splits.push({ description: desc, amount: withTax, splitAmongIds: allMemberIds });
    }

    for (const itemIdx of unequalIndices) {
      const item = editableItems[itemIdx];
      const memberIds = Array.from(assignments.get(itemIdx) ?? new Set(allMemberIds));
      const withTax = Math.round(Number(item.price) * taxMultiplier * 100) / 100;
      splits.push({
        description: item.name,
        amount: withTax,
        splitAmongIds: memberIds.length > 0 ? memberIds : allMemberIds,
      });
    }

    onItemSplit(splits);
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-8 px-5 max-h-[92vh] overflow-y-auto">

        {/* ── STEP: Merchant + Date ── */}
        {step === "merchant" && (
          <>
            <SheetHeader className="text-left pt-2 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Step 1 of {hasItems ? "3" : "2"}</p>
              <SheetTitle className="text-base">Verify merchant & date</SheetTitle>
            </SheetHeader>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Merchant name</label>
                <Input
                  value={merchant}
                  onChange={(e) => setMerchant(e.target.value)}
                  placeholder="e.g. Sobeys"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Receipt date (optional)</label>
                <Input
                  value={editableDate}
                  onChange={(e) => setEditableDate(e.target.value)}
                  placeholder="e.g. Apr 20, 2026"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button className="flex-1" onClick={() => setStep("total")} disabled={!merchant.trim()}>
                Next <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </>
        )}

        {/* ── STEP: Total ── */}
        {step === "total" && (
          <>
            <SheetHeader className="text-left pt-2 pb-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Step 2 of {hasItems ? "3" : "2"}</p>
              <SheetTitle className="text-base">Does the total look right?</SheetTitle>
            </SheetHeader>
            <div className="relative mb-5">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                type="number"
                inputMode="decimal"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                className="pl-7"
                placeholder="0.00"
                autoFocus
              />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={goBack}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button
                className="flex-1"
                disabled={!totalIsValid}
                onClick={() => hasItems ? setStep("items-overview") : handleConfirmTotal()}
              >
                {hasItems ? <><span>Next</span><ArrowRight className="w-4 h-4 ml-1" /></> : "Use This"}
              </Button>
            </div>
          </>
        )}

        {/* ── STEP: Items overview (editable) ── */}
        {step === "items-overview" && (
          <>
            <SheetHeader className="text-left pt-2 pb-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Step 3 of 3</p>
              <SheetTitle className="flex items-center gap-2 text-base">
                <Receipt className="w-4 h-4" /> Review & edit items
              </SheetTitle>
            </SheetHeader>

            {/* AI disclaimer */}
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5 mb-3">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                AI scanning can make mistakes — please verify each item and price before continuing.
              </p>
            </div>

            {/* Tax distribution note */}
            {hasTaxData && (
              <div className="flex items-start gap-2 rounded-lg bg-muted/60 border border-border p-2.5 mb-3">
                <p className="text-xs text-muted-foreground">
                  Tax of <strong className="text-foreground">${Number(data.tax).toFixed(2)}</strong> will be split proportionally — each expense pays tax based on its share of the subtotal.
                </p>
              </div>
            )}

            {/* Sum mismatch warning */}
            {hasMismatch && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 p-2.5 mb-3">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-destructive" />
                <p className="text-xs text-destructive">
                  Items total <strong>${itemsSum.toFixed(2)}</strong> but the receipt {mismatchLabel} — an item may be missing or have the wrong price.
                </p>
              </div>
            )}

            {/* Editable item list */}
            <div className="rounded-lg border border-border overflow-hidden mb-2">
              {editableItems.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No items — add one below.</p>
              )}
              {editableItems.map((item, i) => (
                <div key={i} className="flex items-center gap-1 px-2 py-1 border-b border-border last:border-0">
                  <Input
                    value={item.name}
                    onChange={(e) => updateItem(i, "name", e.target.value)}
                    className="flex-1 h-8 border-0 px-1 text-sm focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent"
                    placeholder="Item name"
                  />
                  <div className="relative w-[4.5rem] shrink-0">
                    <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none select-none">$</span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={item.price === 0 ? "" : item.price}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        updateItem(i, "price", isNaN(v) ? 0 : v);
                      }}
                      className="pl-4 pr-1 h-8 border-0 text-sm text-right focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent"
                      placeholder="0.00"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    className="p-1 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    aria-label="Remove item"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}

              {/* Subtotal / tax rows */}
              {(data.subtotal != null || data.tax != null) && (
                <div className="border-t border-border bg-muted/30">
                  <div className="flex justify-between px-3 py-1.5 text-xs text-muted-foreground">
                    <span>Items total</span>
                    <span className={`font-mono ${hasMismatch ? "text-destructive font-semibold" : ""}`}>
                      ${itemsSum.toFixed(2)}
                    </span>
                  </div>
                  {data.tax != null && (
                    <div className="flex justify-between px-3 py-1.5 text-xs text-muted-foreground">
                      <span>Tax (from receipt)</span>
                      <span className="font-mono">${Number(data.tax).toFixed(2)}</span>
                    </div>
                  )}
                </div>
              )}
              <div className="flex justify-between px-3 py-2 font-semibold text-sm border-t border-border">
                <span>Total</span>
                <span className="font-mono">${parsedTotal.toFixed(2)}</span>
              </div>
            </div>

            {/* Add item */}
            <button
              type="button"
              onClick={addItem}
              className="flex items-center gap-1.5 text-xs text-primary mb-4 px-1 hover:underline"
            >
              <Plus className="w-3.5 h-3.5" /> Add item
            </button>

            <div className="flex gap-3 mb-3">
              <Button variant="outline" className="flex-1" onClick={goBack}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button className="flex-1" onClick={handleConfirmTotal}>Use Total</Button>
            </div>
            {canSplitByItems && (
              <Button
                variant="outline"
                className="w-full border-primary text-primary hover:bg-primary/5"
                onClick={() => {
                  // Re-initialize equal set from current editable items
                  setEqualIndices(new Set(editableItems.map((_, i) => i)));
                  setAssignments(new Map());
                  setAssigningPersonIdx(0);
                  setStep("equal-select");
                }}
              >
                <Users2 className="w-4 h-4 mr-2" /> Split by items
              </Button>
            )}
          </>
        )}

        {/* ── STEP: Equal-select ── */}
        {step === "equal-select" && (
          <>
            <SheetHeader className="text-left pt-2 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Item splitting</p>
              <SheetTitle className="text-base">Which items are split equally among everyone?</SheetTitle>
              <p className="text-xs text-muted-foreground">Select all that apply — you'll assign the rest per person.</p>
            </SheetHeader>
            <div className="space-y-2 mb-5">
              {editableItems.map((item, i) => (
                <label key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/40 transition-colors">
                  <Checkbox
                    checked={equalIndices.has(i)}
                    onCheckedChange={(checked) => {
                      setEqualIndices((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(i); else next.delete(i);
                        return next;
                      });
                    }}
                  />
                  <span className="flex-1 text-sm">{item.name || <em className="text-muted-foreground">unnamed item</em>}</span>
                  <span className="text-sm font-mono text-muted-foreground">${Number(item.price).toFixed(2)}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={goBack}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  if (unequalIndices.length > 0) {
                    setAssigningPersonIdx(0);
                    setStep("assign-person");
                  } else {
                    setStep("summary");
                  }
                }}
              >
                Next <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </>
        )}

        {/* ── STEP: Assign by person ── */}
        {step === "assign-person" && members && (() => {
          const currentMember = members[assigningPersonIdx];
          const isLastPerson = assigningPersonIdx === members.length - 1;

          const selectedCount = unequalIndices.filter((itemIdx) =>
            assignments.get(itemIdx)?.has(currentMember.id) ?? false
          ).length;

          const allSelected = unequalIndices.length > 0 && selectedCount === unequalIndices.length;

          const toggleSelectAll = () => {
            setAssignments((prev) => {
              const next = new Map(prev);
              unequalIndices.forEach((itemIdx) => {
                const current = new Set(next.get(itemIdx) ?? []);
                if (allSelected) current.delete(currentMember.id);
                else current.add(currentMember.id);
                next.set(itemIdx, current);
              });
              return next;
            });
          };

          return (
            <>
              <SheetHeader className="text-left pt-2 pb-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Person {assigningPersonIdx + 1} of {members.length}
                </p>
                {/* Avatar */}
                <div className="w-11 h-11 rounded-full bg-primary/20 flex items-center justify-center mt-2 mb-1">
                  <span className="text-sm font-bold text-primary">{getInitials(currentMember.name)}</span>
                </div>
                <SheetTitle className="text-base">Which items include {currentMember.name}?</SheetTitle>
                <p className="text-xs text-muted-foreground">Tap all items that involve this person, including shared items.</p>
              </SheetHeader>

              {/* Count row + Select all */}
              <div className="flex items-center justify-between py-3">
                <span className="text-sm font-semibold">{selectedCount} items selected</span>
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="text-sm text-muted-foreground border border-border rounded-lg px-3 py-1 hover:bg-muted/40 transition-colors"
                >
                  {allSelected ? "Deselect all" : "Select all"}
                </button>
              </div>

              {/* Item list */}
              <div className="space-y-2 mb-5">
                {unequalIndices.map((itemIdx) => {
                  const item = editableItems[itemIdx];
                  const isChecked = assignments.get(itemIdx)?.has(currentMember.id) ?? false;

                  // Initials of ALL members assigned to this item (reflects real-time state)
                  const assignedInitials = Array.from(assignments.get(itemIdx) ?? [])
                    .map((id) => {
                      const m = members.find((m) => m.id === id);
                      return m ? getInitials(m.name) : null;
                    })
                    .filter(Boolean) as string[];

                  return (
                    <label
                      key={itemIdx}
                      className={`flex items-center gap-3 px-3 py-3 rounded-xl border cursor-pointer transition-colors ${
                        isChecked
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/40"
                      }`}
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => {
                          setAssignments((prev) => {
                            const next = new Map(prev);
                            const current = new Set(next.get(itemIdx) ?? []);
                            if (current.has(currentMember.id)) current.delete(currentMember.id);
                            else current.add(currentMember.id);
                            next.set(itemIdx, current);
                            return next;
                          });
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">
                          {item.name || <em className="text-muted-foreground">unnamed item</em>}
                        </p>
                        {assignedInitials.length > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {assignedInitials.join(", ")}
                          </p>
                        )}
                      </div>
                      <span className="text-sm font-mono text-muted-foreground shrink-0">
                        ${Number(item.price).toFixed(2)}
                      </span>
                    </label>
                  );
                })}
              </div>

              {/* Unassigned items alert */}
              {unassignedAlert && (
                <div
                  className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50"
                  onClick={() => setUnassignedAlert(false)}
                >
                  <div
                    className="bg-background rounded-2xl p-6 mx-8 shadow-xl max-w-sm w-full"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3 className="font-semibold text-base mb-2">You have unassigned items</h3>
                    <p className="text-sm text-muted-foreground mb-5">
                      All receipt items must be assigned to at least one person. Please try again.
                    </p>
                    <button
                      className="w-full text-center text-primary font-semibold text-sm py-1"
                      onClick={() => setUnassignedAlert(false)}
                    >
                      OK
                    </button>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={goBack}>
                  <ArrowLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                <Button className="flex-1" onClick={advanceFromAssignPerson}>
                  {selectedCount === 0 ? (
                    "Skip this person"
                  ) : isLastPerson ? (
                    `Assign ${selectedCount} item${selectedCount !== 1 ? "s" : ""}`
                  ) : (
                    <>
                      {`Assign ${selectedCount} item${selectedCount !== 1 ? "s" : ""}`}
                      <ArrowRight className="w-4 h-4 ml-1" />
                    </>
                  )}
                </Button>
              </div>
            </>
          );
        })()}

        {/* ── STEP: Summary ── */}
        {step === "summary" && (() => {
          const allMemberIds = members?.map((m) => m.id) ?? [];
          const equalItems = editableItems.filter((_, i) => equalIndices.has(i));
          const equalTotal = equalItems.reduce((sum, it) => sum + Number(it.price), 0);
          const expenseCount = (equalItems.length > 0 ? 1 : 0) + unequalIndices.length;

          return (
            <>
              <SheetHeader className="text-left pt-2 pb-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Review & confirm</p>
                <SheetTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 className="w-5 h-5 text-primary" />
                  Creating {expenseCount} expense{expenseCount !== 1 ? "s" : ""}
                </SheetTitle>
              </SheetHeader>
              <div className="rounded-lg border border-border divide-y divide-border mb-5 text-sm">
                {equalItems.length > 0 && (() => {
                  const preTax = Math.round(equalTotal * 100) / 100;
                  const taxAmt = hasTaxData ? Math.round(preTax * (taxMultiplier - 1) * 100) / 100 : 0;
                  const withTax = Math.round(preTax * taxMultiplier * 100) / 100;
                  return (
                    <div className="px-3 py-3">
                      <div className="flex justify-between mb-0.5">
                        <span className="font-medium truncate flex-1 pr-4">
                          {equalItems.length === 1 ? equalItems[0].name : `${equalItems[0].name} + ${equalItems.length - 1} more`}
                        </span>
                        <span className="font-mono font-semibold">${withTax.toFixed(2)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Split equally — {members?.length} people</p>
                      {hasTaxData && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Pre-tax ${preTax.toFixed(2)} + Tax ${taxAmt.toFixed(2)}
                        </p>
                      )}
                    </div>
                  );
                })()}
                {unequalIndices.map((itemIdx, j) => {
                  const item = editableItems[itemIdx];
                  const assignedIds = Array.from(assignments.get(itemIdx) ?? new Set(allMemberIds));
                  const assignedNames = assignedIds
                    .map((id) => members?.find((m) => m.id === id)?.name ?? id)
                    .join(", ");
                  const preTax = Number(item.price);
                  const taxAmt = hasTaxData ? Math.round(preTax * (taxMultiplier - 1) * 100) / 100 : 0;
                  const withTax = Math.round(preTax * taxMultiplier * 100) / 100;
                  return (
                    <div key={j} className="px-3 py-3">
                      <div className="flex justify-between mb-0.5">
                        <span className="font-medium truncate flex-1 pr-4">{item.name}</span>
                        <span className="font-mono font-semibold">${withTax.toFixed(2)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{assignedNames}</p>
                      {hasTaxData && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Pre-tax ${preTax.toFixed(2)} + Tax ${taxAmt.toFixed(2)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={goBack}>
                  <ArrowLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                <Button className="flex-1" onClick={handleCreateSplits}>
                  Create Expenses
                </Button>
              </div>
            </>
          );
        })()}

      </SheetContent>
    </Sheet>
  );
}
