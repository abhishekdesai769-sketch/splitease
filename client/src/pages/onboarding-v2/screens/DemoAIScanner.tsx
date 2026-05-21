/**
 * Demo AI Receipt Scanner — step-based flow.
 *
 * The AI can read the items off a receipt photo, but it CANNOT know who ate
 * what — that always needs the user. So the demo walks the user through the
 * same steps the real ReceiptReviewSheet does:
 *
 *   1. "receipt"      — stylized 8-line bill + "Scan with AI" CTA
 *   2. "scanning"     — ~2s scan animation
 *   3. "select-equal" — "Which items did everyone share?" The user picks the
 *                       items the whole table split. These bundle into one
 *                       even-split expense.
 *   4. "assign-person"— loops through each member: "Which items did X have?"
 *                       The user checks that person's items.
 *   5. "finalizing"   — brief loader, then onComplete(expenses, durationMs)
 *
 * Receipt is 8 items (small enough to follow easily). Item assignment defaults
 * come from the receipt fixture's member INDICES, resolved to the demo group's
 * actual members — so this works for a 2/3/4-person group. The defaults are
 * only starting checkboxes; the user changes anything they like.
 *
 * Final expenses bundle by share-combo: items with an identical assignee set
 * collapse into one expense (matches the real handleCreateSplits shape).
 */
import { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sparkles, Zap, ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { DEMO_RECEIPT } from "../fixtures";
import type { DemoGroup, DemoExpense } from "../fixtures";
import { track } from "@/lib/analytics";

interface Props {
  group: DemoGroup;
  onComplete: (newExpenses: DemoExpense[], durationMs: number) => void;
  onCancel: () => void;
}

type Step = "receipt" | "scanning" | "select-equal" | "assign-person" | "finalizing";

const getInitials = (name: string) =>
  name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();

// Tax + tip multiplier — applied to each item's price so per-person totals
// include their share of tax + tip.
const TAX_MULTIPLIER =
  (DEMO_RECEIPT.tax + DEMO_RECEIPT.tip) / DEMO_RECEIPT.subtotal + 1;

export function DemoAIScanner({ group, onComplete, onCancel }: Props) {
  const [step, setStep] = useState<Step>("receipt");
  const startTimeRef = useRef<number | null>(null);

  // ── Equal items — the user picks these in step 1. NOTHING is pre-checked.
  // The demo teaches by making the user do the selecting themselves; an
  // auto-filled checklist is confusing and defeats the point. ──
  const [equalItemIds, setEqualItemIds] = useState<Set<number>>(() => new Set<number>());
  const unequalIndices = useMemo(
    () => DEMO_RECEIPT.items.map((_, i) => i).filter((i) => !equalItemIds.has(i)),
    [equalItemIds]
  );

  // ── Per-person assignment: Map<itemIdx, Set<memberId>> ──
  // Every item starts UNassigned. The user actively ticks who had what in
  // the per-person step. The "who shared this" names under an item appear
  // only once the user has assigned someone — never before.
  const [assignments, setAssignments] = useState<Map<number, Set<string>>>(() => {
    const init = new Map<number, Set<string>>();
    DEMO_RECEIPT.items.forEach((_, idx) => init.set(idx, new Set<string>()));
    return init;
  });

  const [assigningPersonIdx, setAssigningPersonIdx] = useState(0);

  // Scan animation: auto-advance to the equal-items step
  useEffect(() => {
    if (step !== "scanning") return;
    const t = setTimeout(() => setStep("select-equal"), 1800);
    return () => clearTimeout(t);
  }, [step]);

  // Finalizing: brief loader, then build splits + hand back
  useEffect(() => {
    if (step !== "finalizing") return;
    const t = setTimeout(() => {
      const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : 30_000;
      onComplete(buildExpenses(), elapsed);
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const startScan = () => {
    startTimeRef.current = Date.now();
    track("demo_ai_scanner_scan_tapped");
    setStep("scanning");
  };

  const toggleEqualItem = (itemIdx: number) => {
    setEqualItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemIdx)) next.delete(itemIdx);
      else next.add(itemIdx);
      return next;
    });
  };

  const advanceFromSelectEqual = () => {
    track("demo_ai_scanner_equal_selected", { count: equalItemIds.size });
    if (unequalIndices.length === 0) setStep("finalizing");
    else setStep("assign-person");
  };

  const toggleItemForCurrentPerson = (itemIdx: number, memberId: string) => {
    setAssignments((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(itemIdx) ?? []);
      if (current.has(memberId)) current.delete(memberId);
      else current.add(memberId);
      next.set(itemIdx, current);
      return next;
    });
    track("demo_ai_scanner_items_assigned");
  };

  const advancePerson = () => {
    if (assigningPersonIdx < group.members.length - 1) {
      setAssigningPersonIdx(assigningPersonIdx + 1);
    } else {
      setStep("finalizing");
    }
  };

  const goBackPerson = () => {
    if (assigningPersonIdx > 0) setAssigningPersonIdx(assigningPersonIdx - 1);
    else setStep("select-equal");
  };

  // Build final expenses — items grouped by identical assignee set.
  function buildExpenses(): DemoExpense[] {
    const allMemberIds = group.members.map((m) => m.id);
    const youId = group.members.find((m) => m.isYou)?.id ?? allMemberIds[0];
    const splits: DemoExpense[] = [];
    const stamp = Date.now();

    // 1. Equal bundle
    const equalItems = Array.from(equalItemIds).map((idx) => DEMO_RECEIPT.items[idx]);
    if (equalItems.length > 0) {
      const preTax = equalItems.reduce((sum, it) => sum + it.price, 0);
      const withTax = Math.round(preTax * TAX_MULTIPLIER * 100) / 100;
      const desc =
        equalItems.length === 1
          ? equalItems[0].name
          : `${equalItems[0].name} + ${equalItems.length - 1} more`;
      splits.push({
        id: `e-ai-eq-${stamp}`,
        description: desc,
        amount: withTax,
        paidById: youId,
        splitAmongIds: allMemberIds,
        date: new Date().toISOString(),
        note: `AI · split ${allMemberIds.length} ways`,
      });
    }

    // 2. Unequal items grouped by share-combo
    const buckets = new Map<string, { memberIds: string[]; items: typeof DEMO_RECEIPT.items }>();
    for (const itemIdx of unequalIndices) {
      const item = DEMO_RECEIPT.items[itemIdx];
      const assigned = Array.from(assignments.get(itemIdx) ?? []);
      const memberIds = assigned.length > 0 ? assigned : allMemberIds;
      const key = [...memberIds].sort().join("|");
      const bucket = buckets.get(key);
      if (bucket) bucket.items.push(item);
      else buckets.set(key, { memberIds, items: [item] });
    }

    let n = 0;
    for (const { memberIds, items } of buckets.values()) {
      const preTax = items.reduce((sum, it) => sum + it.price, 0);
      const withTax = Math.round(preTax * TAX_MULTIPLIER * 100) / 100;
      const desc =
        items.length === 1
          ? items[0].name
          : items.length === 2
            ? `${items[0].name} + ${items[1].name}`
            : `${items[0].name} + ${items.length - 1} more`;
      splits.push({
        id: `e-ai-${n++}-${stamp}`,
        description: desc,
        amount: withTax,
        paidById: youId,
        splitAmongIds: memberIds,
        date: new Date().toISOString(),
        note: `AI · split ${memberIds.length} ${memberIds.length === 1 ? "way" : "ways"}`,
      });
    }

    return splits;
  }

  // ──────────────────────────────────────────────────────
  // Step 1 — Receipt + Scan CTA
  // ──────────────────────────────────────────────────────
  if (step === "receipt") {
    return (
      <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
        <div className="flex items-center gap-2 pb-4">
          <Button size="icon" variant="ghost" onClick={onCancel} aria-label="Back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Scan with AI
          </h2>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          Pretend you just took a photo of tonight's dinner receipt. The AI reads
          every item — you just tell it who had what.
        </p>

        <ReceiptCard />

        <div className="mt-5 mb-3 bg-primary/10 border border-primary/30 rounded-xl px-3 py-2 text-center">
          <span className="text-primary font-semibold text-sm">↓ Tap to scan it</span>
        </div>
        <Button size="lg" className="w-full shadow-sm" onClick={startScan} data-testid="demo-scanner-start">
          <Zap className="w-4 h-4 mr-1.5" />
          Scan with AI
        </Button>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────
  // Step 2 — Scanning animation
  // ──────────────────────────────────────────────────────
  if (step === "scanning") {
    return (
      <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
        <div className="text-center py-3 mb-2">
          <div className="inline-flex items-center gap-2 text-sm text-primary font-medium">
            <Loader2 className="w-4 h-4 animate-spin" />
            Reading {DEMO_RECEIPT.items.length} items…
          </div>
        </div>

        <div className="relative">
          <ReceiptCard />
          <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
            <div
              className="absolute left-0 right-0 h-1 bg-primary/80"
              style={{
                boxShadow: "0 0 18px 6px hsl(172 63% 45% / 0.7)",
                animation: "spliiit-scanline 1.8s ease-in-out forwards",
              }}
            />
            <div className="absolute inset-0 bg-primary/5 animate-pulse" />
          </div>
          <style>{`
            @keyframes spliiit-scanline {
              0%   { top: 0%; }
              100% { top: 100%; }
            }
          `}</style>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────
  // Step 3 — Select items everyone shared
  // ──────────────────────────────────────────────────────
  if (step === "select-equal") {
    const equalCount = equalItemIds.size;
    const totalItems = DEMO_RECEIPT.items.length;
    return (
      <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
        <div className="text-left pt-2 pb-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Step 1 of 2</p>
          <h2 className="text-base font-semibold mt-1">Which items did everyone share?</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Tick the items the whole table split — like appetizers or a bottle of
            wine. We'll divide those evenly. You'll assign the rest next.
          </p>
        </div>

        <div className="flex items-center justify-between py-3">
          <span className="text-sm font-semibold">
            {equalCount} of {totalItems} shared
          </span>
          <button
            type="button"
            onClick={() => {
              if (equalItemIds.size === totalItems) setEqualItemIds(new Set());
              else setEqualItemIds(new Set(DEMO_RECEIPT.items.map((_, i) => i)));
            }}
            className="text-sm text-muted-foreground border border-border rounded-lg px-3 py-1 hover:bg-muted/40 transition-colors"
          >
            {equalItemIds.size === totalItems ? "Clear all" : "Select all"}
          </button>
        </div>

        <div className="space-y-2 mb-5 overflow-y-auto -mx-1 px-1">
          {DEMO_RECEIPT.items.map((item, idx) => {
            const isChecked = equalItemIds.has(idx);
            return (
              <label
                key={idx}
                className={`flex items-center gap-3 px-3 py-3 rounded-xl border cursor-pointer transition-colors ${
                  isChecked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                }`}
              >
                <Checkbox checked={isChecked} onCheckedChange={() => toggleEqualItem(idx)} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{item.name}</p>
                  {isChecked && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Split evenly · all {group.members.length}
                    </p>
                  )}
                </div>
                <span className="text-sm font-mono text-muted-foreground shrink-0">
                  ${item.price.toFixed(2)}
                </span>
              </label>
            );
          })}
        </div>

        <div className="flex gap-3 pt-1">
          <Button variant="outline" className="flex-1" onClick={() => setStep("receipt")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <Button
            className="flex-1"
            onClick={advanceFromSelectEqual}
            data-testid="demo-scanner-select-equal-next"
          >
            {unequalIndices.length === 0 ? (
              "Finish"
            ) : (
              <>Next: assign the rest <ArrowRight className="w-4 h-4 ml-1" /></>
            )}
          </Button>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────
  // Step 4 — Per-person assignment
  // ──────────────────────────────────────────────────────
  if (step === "assign-person") {
    const currentMember = group.members[assigningPersonIdx];
    const isLastPerson = assigningPersonIdx === group.members.length - 1;
    const selectedCount = unequalIndices.filter(
      (itemIdx) => assignments.get(itemIdx)?.has(currentMember.id) ?? false
    ).length;

    return (
      <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
        <div className="text-left pt-2 pb-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            Step 2 of 2 · Person {assigningPersonIdx + 1} of {group.members.length}
          </p>
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center mt-2 mb-1 text-white text-sm font-semibold"
            style={{ backgroundColor: currentMember.avatarColor }}
          >
            {getInitials(currentMember.name)}
          </div>
          <h2 className="text-base font-semibold">
            Which items did {currentMember.isYou ? "you" : currentMember.name} have?
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Tick {currentMember.isYou ? "your" : `${currentMember.name}'s`} items.
            Shared items from step 1 aren't shown — they're already handled.
          </p>
        </div>

        <div className="py-3">
          <span className="text-sm font-semibold">{selectedCount} selected</span>
        </div>

        <div className="space-y-2 mb-5 overflow-y-auto -mx-1 px-1">
          {unequalIndices.map((itemIdx) => {
            const item = DEMO_RECEIPT.items[itemIdx];
            const isChecked = assignments.get(itemIdx)?.has(currentMember.id) ?? false;
            const sharedWith = Array.from(assignments.get(itemIdx) ?? [])
              .map((id) => {
                const m = group.members.find((mm) => mm.id === id);
                return m ? (m.isYou ? "You" : m.name) : null;
              })
              .filter(Boolean) as string[];

            return (
              <label
                key={itemIdx}
                className={`flex items-center gap-3 px-3 py-3 rounded-xl border cursor-pointer transition-colors ${
                  isChecked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                }`}
              >
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={() => toggleItemForCurrentPerson(itemIdx, currentMember.id)}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{item.name}</p>
                  {sharedWith.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {sharedWith.join(", ")}
                    </p>
                  )}
                </div>
                <span className="text-sm font-mono text-muted-foreground shrink-0">
                  ${item.price.toFixed(2)}
                </span>
              </label>
            );
          })}
        </div>

        <div className="flex gap-3 pt-1">
          <Button variant="outline" className="flex-1" onClick={goBackPerson}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <Button className="flex-1" onClick={advancePerson} data-testid="demo-scanner-next-person">
            {selectedCount === 0 ? (
              "Skip this person"
            ) : isLastPerson ? (
              "Finish"
            ) : (
              <>Next person <ArrowRight className="w-4 h-4 ml-1" /></>
            )}
          </Button>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────
  // Step 5 — Finalizing
  // ──────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto w-full text-center gap-4">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
      <div>
        <div className="text-base font-semibold">Splitting your bill…</div>
        <div className="text-xs text-muted-foreground mt-1">
          Bundling shared items + individual ones
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// Stylized receipt (used in step 1 and step 2)
// ──────────────────────────────────────────────────────
function ReceiptCard() {
  return (
    <div
      className="rounded-2xl border border-border p-4 font-mono text-xs"
      style={{ background: "#FBF6EC", color: "#1f1f1f" }}
    >
      <div className="text-center pb-2 border-b border-dashed border-stone-400/50">
        <div className="font-bold text-sm">{DEMO_RECEIPT.restaurant}</div>
        <div className="text-[10px] opacity-70">{DEMO_RECEIPT.date}</div>
        <div className="text-[10px] opacity-70">{DEMO_RECEIPT.cover}</div>
      </div>
      <div className="py-2 space-y-0.5">
        {DEMO_RECEIPT.items.map((item) => (
          <div key={item.id} className="flex justify-between leading-tight">
            <span className="truncate pr-2">{item.name}</span>
            <span className="tabular-nums shrink-0">{item.price.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div className="pt-2 border-t border-dashed border-stone-400/50 space-y-0.5">
        <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{DEMO_RECEIPT.subtotal.toFixed(2)}</span></div>
        <div className="flex justify-between opacity-80"><span>Tax (13%)</span><span className="tabular-nums">{DEMO_RECEIPT.tax.toFixed(2)}</span></div>
        <div className="flex justify-between opacity-80"><span>Tip (18%)</span><span className="tabular-nums">{DEMO_RECEIPT.tip.toFixed(2)}</span></div>
        <div className="flex justify-between font-bold pt-1 border-t border-dashed border-stone-400/50 mt-1">
          <span>TOTAL</span><span className="tabular-nums">{DEMO_RECEIPT.total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
