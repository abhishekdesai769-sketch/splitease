import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, ArrowRight, Receipt, Users2, CheckCircle2 } from "lucide-react";

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
  | "assign-item"
  | "summary";

// ─── Component ────────────────────────────────────────────────────────────────

export function ReceiptReviewSheet({ open, data, members, onConfirm, onItemSplit, onClose }: Props) {
  // Editable fields
  const [merchant, setMerchant] = useState(data.merchant);
  const [total, setTotal] = useState(String(data.total ?? ""));

  // Step machine
  const [step, setStep] = useState<Step>("merchant");

  // Item splitting state
  const [equalIndices, setEqualIndices] = useState<Set<number>>(new Set(data.items.map((_, i) => i)));
  const [assigningIdx, setAssigningIdx] = useState(0); // index into unequalIndices
  const [assignments, setAssignments] = useState<Map<number, Set<string>>>(new Map());

  const hasItems = data.items.length > 0;
  const canSplitByItems = hasItems && members && members.length > 1 && !!onItemSplit;

  // Items NOT in equalIndices — need per-person assignment
  const unequalIndices = data.items.map((_, i) => i).filter((i) => !equalIndices.has(i));

  // ── Step navigation helpers ──────────────────────────────────────────────

  const goBack = () => {
    if (step === "total") return setStep("merchant");
    if (step === "items-overview") return setStep("total");
    if (step === "equal-select") return setStep("items-overview");
    if (step === "assign-item") {
      if (assigningIdx === 0) return setStep("equal-select");
      setAssigningIdx((i) => i - 1);
    }
    if (step === "summary") {
      if (unequalIndices.length > 0) {
        setAssigningIdx(unequalIndices.length - 1);
        setStep("assign-item");
      } else {
        setStep("equal-select");
      }
    }
  };

  const advanceFromAssignItem = () => {
    const nextIdx = assigningIdx + 1;
    if (nextIdx < unequalIndices.length) {
      setAssigningIdx(nextIdx);
    } else {
      setStep("summary");
    }
  };

  // ── Confirm (use total) ─────────────────────────────────────────────────

  const handleConfirmTotal = () => {
    const parsedTotal = parseFloat(total);
    if (isNaN(parsedTotal) || parsedTotal <= 0) return;
    onConfirm(merchant.trim() || data.merchant, parsedTotal, data.date ?? undefined);
  };

  // ── Build final splits and submit ───────────────────────────────────────

  const handleCreateSplits = () => {
    if (!members || !onItemSplit) return;
    const allMemberIds = members.map((m) => m.id);
    const splits: ItemSplit[] = [];

    // Equal items → one combined expense
    const equalItems = data.items.filter((_, i) => equalIndices.has(i));
    if (equalItems.length > 0) {
      const equalTotal = equalItems.reduce((sum, it) => sum + Number(it.price), 0);
      const desc =
        equalItems.length === 1
          ? equalItems[0].name
          : `${equalItems[0].name} + ${equalItems.length - 1} more`;
      splits.push({ description: desc, amount: Math.round(equalTotal * 100) / 100, splitAmongIds: allMemberIds });
    }

    // Unequal items → individual expenses
    for (const itemIdx of unequalIndices) {
      const item = data.items[itemIdx];
      const memberIds = Array.from(assignments.get(itemIdx) ?? new Set(allMemberIds));
      splits.push({
        description: item.name,
        amount: Number(item.price),
        splitAmongIds: memberIds.length > 0 ? memberIds : allMemberIds,
      });
    }

    onItemSplit(splits);
  };

  // ── Merchant member toggle helper ───────────────────────────────────────

  const toggleMember = (itemIdx: number, memberId: string) => {
    setAssignments((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(itemIdx) ?? members?.map((m) => m.id) ?? []);
      if (current.has(memberId)) {
        current.delete(memberId);
      } else {
        current.add(memberId);
      }
      next.set(itemIdx, current);
      return next;
    });
  };

  // ── Render ──────────────────────────────────────────────────────────────

  const parsedTotal = parseFloat(total);
  const totalIsValid = !isNaN(parsedTotal) && parsedTotal > 0;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-8 px-5 max-h-[88vh] overflow-y-auto">

        {/* ── STEP: Merchant ── */}
        {step === "merchant" && (
          <>
            <SheetHeader className="text-left pt-2 pb-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Step 1 of {hasItems ? "3" : "2"}</p>
              <SheetTitle className="text-base">Is this the right merchant?</SheetTitle>
            </SheetHeader>
            <Input
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              placeholder="Merchant name"
              className="mb-5"
              autoFocus
            />
            {data.date && (
              <p className="text-xs text-muted-foreground mb-5">
                Receipt date: <span className="text-foreground font-medium">{data.date}</span>
              </p>
            )}
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

        {/* ── STEP: Items overview ── */}
        {step === "items-overview" && (
          <>
            <SheetHeader className="text-left pt-2 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Step 3 of 3</p>
              <SheetTitle className="flex items-center gap-2 text-base">
                <Receipt className="w-4 h-4" /> Here's what was detected
              </SheetTitle>
            </SheetHeader>
            <div className="rounded-lg border border-border divide-y divide-border mb-4 text-sm">
              {data.items.map((item, i) => (
                <div key={i} className="flex justify-between px-3 py-2">
                  <span className="truncate flex-1 pr-4">{item.name}</span>
                  <span className="font-mono text-muted-foreground">${Number(item.price).toFixed(2)}</span>
                </div>
              ))}
              {data.subtotal != null && (
                <div className="flex justify-between px-3 py-2 text-muted-foreground">
                  <span>Subtotal</span><span className="font-mono">${Number(data.subtotal).toFixed(2)}</span>
                </div>
              )}
              {data.tax != null && (
                <div className="flex justify-between px-3 py-2 text-muted-foreground">
                  <span>Tax</span><span className="font-mono">${Number(data.tax).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between px-3 py-2 font-semibold">
                <span>Total</span><span className="font-mono">${parsedTotal.toFixed(2)}</span>
              </div>
            </div>
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
                onClick={() => { setAssigningIdx(0); setStep("equal-select"); }}
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
              <p className="text-xs text-muted-foreground">Select all that apply — the rest you'll assign one by one.</p>
            </SheetHeader>
            <div className="space-y-2 mb-5">
              {data.items.map((item, i) => (
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
                  <span className="flex-1 text-sm">{item.name}</span>
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
                    setAssigningIdx(0);
                    setStep("assign-item");
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

        {/* ── STEP: Assign item (one by one) ── */}
        {step === "assign-item" && (() => {
          const currentItemIdx = unequalIndices[assigningIdx];
          const currentItem = data.items[currentItemIdx];
          const currentAssignment = assignments.get(currentItemIdx) ?? new Set(members?.map((m) => m.id) ?? []);
          const isLast = assigningIdx === unequalIndices.length - 1;
          return (
            <>
              <SheetHeader className="text-left pt-2 pb-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Item {assigningIdx + 1} of {unequalIndices.length}
                </p>
                <SheetTitle className="text-base">
                  Who shares "{currentItem.name}"?
                </SheetTitle>
                <p className="text-sm text-muted-foreground font-mono">${Number(currentItem.price).toFixed(2)}</p>
              </SheetHeader>
              <div className="space-y-2 mb-5">
                {members?.map((member) => (
                  <label key={member.id} className="flex items-center gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/40 transition-colors">
                    <Checkbox
                      checked={currentAssignment.has(member.id)}
                      onCheckedChange={() => toggleMember(currentItemIdx, member.id)}
                    />
                    <span className="text-sm">{member.name}</span>
                  </label>
                ))}
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={goBack}>
                  <ArrowLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                <Button
                  className="flex-1"
                  disabled={currentAssignment.size === 0}
                  onClick={advanceFromAssignItem}
                >
                  {isLast ? "Review" : <><span>Next</span><ArrowRight className="w-4 h-4 ml-1" /></>}
                </Button>
              </div>
            </>
          );
        })()}

        {/* ── STEP: Summary ── */}
        {step === "summary" && (() => {
          const allMemberIds = members?.map((m) => m.id) ?? [];
          const equalItems = data.items.filter((_, i) => equalIndices.has(i));
          const equalTotal = equalItems.reduce((sum, it) => sum + Number(it.price), 0);

          return (
            <>
              <SheetHeader className="text-left pt-2 pb-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Review & confirm</p>
                <SheetTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 className="w-5 h-5 text-primary" />
                  Creating {(equalItems.length > 0 ? 1 : 0) + unequalIndices.length} expense{(equalItems.length > 0 ? 1 : 0) + unequalIndices.length !== 1 ? "s" : ""}
                </SheetTitle>
              </SheetHeader>
              <div className="rounded-lg border border-border divide-y divide-border mb-5 text-sm">
                {equalItems.length > 0 && (
                  <div className="px-3 py-3">
                    <div className="flex justify-between mb-1">
                      <span className="font-medium truncate flex-1 pr-4">
                        {equalItems.length === 1 ? equalItems[0].name : `${equalItems[0].name} + ${equalItems.length - 1} more`}
                      </span>
                      <span className="font-mono">${Math.round(equalTotal * 100) / 100}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Split equally — {members?.length} people</p>
                  </div>
                )}
                {unequalIndices.map((itemIdx, j) => {
                  const item = data.items[itemIdx];
                  const assignedIds = Array.from(assignments.get(itemIdx) ?? new Set(allMemberIds));
                  const assignedNames = assignedIds
                    .map((id) => members?.find((m) => m.id === id)?.name ?? id)
                    .join(", ");
                  return (
                    <div key={j} className="px-3 py-3">
                      <div className="flex justify-between mb-1">
                        <span className="font-medium truncate flex-1 pr-4">{item.name}</span>
                        <span className="font-mono">${Number(item.price).toFixed(2)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{assignedNames}</p>
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
