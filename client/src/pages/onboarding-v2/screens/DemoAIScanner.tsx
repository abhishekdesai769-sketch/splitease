/**
 * Demo AI Receipt Scanner — faithful clone of components/ReceiptReviewSheet.tsx
 *
 * The user lands on this in two ways:
 *   (a) Add Expense dialog → "Scan with AI" button
 *   (b) (Wave 2) Direct scanner CTA from group view
 *
 * Internal steps mirror the real flow:
 *   1. "receipt"        — stylized 17-line receipt + "Scan with AI" CTA
 *   2. "scanning"       — 1.5s scan animation (teal sweep)
 *   3. "assign-person"  — loops through members one-by-one with the EXACT
 *                         "Which items include {Name}?" checkbox UI from the
 *                         real ReceiptReviewSheet (lines 458–604)
 *   4. "finalizing"     — brief 800ms loader, matches real "splitting…" pause
 *   5. → done           — calls onComplete with the produced splits (multiple
 *                         DemoExpense entries) + total scanner duration
 *
 * Split shape matches the real `handleCreateSplits` in ReceiptReviewSheet:
 *   - Items every member is assigned to    → bundled into ONE expense
 *     (e.g. "Bruschetta al pomodoro + 5 more")
 *   - Each other item                       → its OWN expense
 *
 * IMPORTANT: zero backend calls. The "scan" is theater. Final amounts include
 * proportional tax + tip (matches the real ReceiptReviewSheet's taxMultiplier).
 */
import { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sparkles, X as XIcon, Zap, ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { TRATTORIA_RECEIPT } from "../fixtures";
import type { DemoGroup, DemoExpense, ReceiptItem } from "../fixtures";
import { track } from "@/lib/analytics";

interface Props {
  group: DemoGroup;
  onComplete: (newExpenses: DemoExpense[], durationMs: number) => void;
  onCancel: () => void;
}

type Step = "receipt" | "scanning" | "select-equal" | "assign-person" | "finalizing";

const getInitials = (name: string) =>
  name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();

// Tax + tip multiplier applied to each item's price.
// Mirrors the real ReceiptReviewSheet behavior: taxMultiplier = 1 + (tax+tip)/subtotal
const TAX_MULTIPLIER =
  (TRATTORIA_RECEIPT.tax + TRATTORIA_RECEIPT.tip) / TRATTORIA_RECEIPT.subtotal + 1;

export function DemoAIScanner({ group, onComplete, onCancel }: Props) {
  const [step, setStep] = useState<Step>("receipt");
  const startTimeRef = useRef<number | null>(null);

  // ── Equal vs unequal classification — now USER-CONTROLLED ──
  // We seed it from fixture defaults (items where defaultAssignedTo = all
  // members start as "equal"), but the user toggles which items are
  // "shared by everyone" in the select-equal step. Items still in equalIds
  // bundle into one expense; the rest go through per-person assignment.
  const seededEqualIds = useMemo(() => {
    const allIds = new Set(group.members.map((m) => m.id));
    const equal = new Set<number>();
    TRATTORIA_RECEIPT.items.forEach((item, idx) => {
      const validIds = item.defaultAssignedTo.filter((id) => allIds.has(id));
      const coversAllMembers =
        validIds.length === group.members.length &&
        group.members.every((m) => validIds.includes(m.id));
      if (coversAllMembers) equal.add(idx);
    });
    return equal;
  }, [group.members]);

  const [equalItemIds, setEqualItemIds] = useState<Set<number>>(seededEqualIds);
  // Derived live: every item NOT in equalItemIds goes through per-person.
  const unequalIndices = useMemo(
    () => TRATTORIA_RECEIPT.items.map((_, i) => i).filter((i) => !equalItemIds.has(i)),
    [equalItemIds]
  );

  // ── Per-person assignment state: Map<itemIdx, Set<memberId>> ──
  // Pre-seeded from fixture defaults but only for items that are unequal.
  const [assignments, setAssignments] = useState<Map<number, Set<string>>>(() => {
    const init = new Map<number, Set<string>>();
    const allIds = new Set(group.members.map((m) => m.id));
    TRATTORIA_RECEIPT.items.forEach((item, idx) => {
      const valid = item.defaultAssignedTo.filter((id) => allIds.has(id));
      init.set(idx, new Set(valid));
    });
    return init;
  });

  const [assigningPersonIdx, setAssigningPersonIdx] = useState(0);

  // Step-2 scan animation: auto-advance to the equal-items step
  useEffect(() => {
    if (step !== "scanning") return;
    const t = setTimeout(() => setStep("select-equal"), 1500);
    return () => clearTimeout(t);
  }, [step]);

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
    // If everything is marked equal, skip per-person entirely
    if (unequalIndices.length === 0) setStep("finalizing");
    else setStep("assign-person");
  };

  // Step-4 finalizing: brief loader, then build splits + call onComplete
  useEffect(() => {
    if (step !== "finalizing") return;
    const t = setTimeout(() => {
      const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : 30_000;
      const newExpenses = buildExpensesFromAssignments();
      onComplete(newExpenses, elapsed);
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const startScan = () => {
    startTimeRef.current = Date.now();
    setStep("scanning");
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

  const toggleSelectAllForCurrentPerson = (memberId: string, allSelected: boolean) => {
    setAssignments((prev) => {
      const next = new Map(prev);
      unequalIndices.forEach((itemIdx) => {
        const current = new Set(next.get(itemIdx) ?? []);
        if (allSelected) current.delete(memberId);
        else current.add(memberId);
        next.set(itemIdx, current);
      });
      return next;
    });
    track("demo_ai_scanner_auto_assigned");
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

  // Build the final splits — smarter bundling than the v1.
  //   - All "everyone-shared" items combine into ONE expense
  //   - Unequal items are grouped by IDENTICAL share-combo: every item with
  //     the same Set<memberId> becomes ONE expense whose description lists
  //     the item names (truncated to "Item1 + N more" if it gets long).
  // Result: a Trattoria dinner produces ~4-6 expenses instead of 12.
  function buildExpensesFromAssignments(): DemoExpense[] {
    const allMemberIds = group.members.map((m) => m.id);
    const youId = group.members.find((m) => m.isYou)?.id ?? allMemberIds[0];
    const splits: DemoExpense[] = [];
    const stamp = Date.now();

    // 1. Equal bundle — everyone shared these
    const equalItems = Array.from(equalItemIds).map((idx) => TRATTORIA_RECEIPT.items[idx]);
    if (equalItems.length > 0) {
      const preTax = equalItems.reduce((sum, it) => sum + it.price, 0);
      const withTax = Math.round(preTax * TAX_MULTIPLIER * 100) / 100;
      const desc = equalItems.length === 1
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

    // 2. Group unequal items by their share-combo (sorted member IDs).
    //    Items with the same set of assignees end up in the same bucket.
    const buckets = new Map<string, { memberIds: string[]; items: typeof TRATTORIA_RECEIPT.items }>();
    for (const itemIdx of unequalIndices) {
      const item = TRATTORIA_RECEIPT.items[itemIdx];
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
      // Description lists the items — readable up to 2 names, then "+ N more"
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
        <div className="flex items-center justify-between pb-4">
          <div className="flex items-center gap-2">
            <Button size="icon" variant="ghost" onClick={onCancel} aria-label="Back">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Scan with AI
            </h2>
          </div>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          Pretend you just took a photo of tonight's dinner receipt.
        </p>

        <ReceiptCard />

        <div
          className="mt-5 mb-3 text-center text-sm"
          style={{ fontFamily: "'Caveat', cursive", color: "hsl(172 63% 45%)" }}
        >
          ↓ Tap to scan it
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
          <div className="text-sm text-muted-foreground">Scanning receipt…</div>
        </div>

        <div className="relative">
          <ReceiptCard />
          <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
            <div
              className="absolute left-0 right-0 h-1 bg-primary/80"
              style={{
                boxShadow: "0 0 18px 6px hsl(172 63% 45% / 0.7)",
                animation: "spliiit-scanline 1.5s ease-in-out forwards",
              }}
            />
            <div className="absolute inset-0 bg-primary/5 animate-pulse" />
          </div>
          <style>{`
            @keyframes spliiit-scanline {
              from { top: 0%; }
              to   { top: 100%; }
            }
          `}</style>
        </div>

        <div className="mt-4 text-center text-xs font-mono uppercase tracking-wider text-primary">
          {TRATTORIA_RECEIPT.items.length} items · ${TRATTORIA_RECEIPT.total.toFixed(2)} total
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────
  // Step 3a — Select items everyone shared (BEFORE per-person)
  // Mirrors the real flow: classify equal items first, then per-person for
  // the rest. Pre-seeded from fixture defaults so the user usually just
  // hits Continue → unless they want to tweak.
  // ──────────────────────────────────────────────────────
  if (step === "select-equal") {
    const equalCount = equalItemIds.size;
    const totalItems = TRATTORIA_RECEIPT.items.length;
    return (
      <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
        <div className="text-left pt-2 pb-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            Step 1 of 2
          </p>
          <h2 className="text-base font-semibold mt-1">
            Which items did everyone share?
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            We'll split these equally among all {group.members.length} of you. The
            rest get assigned per person in the next step.
          </p>
        </div>

        <div className="flex items-center justify-between py-3">
          <span className="text-sm font-semibold">
            {equalCount} of {totalItems} marked shared
          </span>
          <button
            type="button"
            onClick={() => {
              if (equalItemIds.size === totalItems) setEqualItemIds(new Set());
              else setEqualItemIds(new Set(TRATTORIA_RECEIPT.items.map((_, i) => i)));
            }}
            className="text-sm text-muted-foreground border border-border rounded-lg px-3 py-1 hover:bg-muted/40 transition-colors"
          >
            {equalItemIds.size === totalItems ? "Deselect all" : "Select all"}
          </button>
        </div>

        <div className="space-y-2 mb-5 overflow-y-auto -mx-1 px-1">
          {TRATTORIA_RECEIPT.items.map((item, idx) => {
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
                      Split among all {group.members.length}
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
          <Button className="flex-1" onClick={advanceFromSelectEqual} data-testid="demo-scanner-select-equal-next">
            {unequalIndices.length === 0 ? "Finish" : (
              <>Next: assign the rest <ArrowRight className="w-4 h-4 ml-1" /></>
            )}
          </Button>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────
  // Step 3b — Per-person assignment (matches ReceiptReviewSheet exactly)
  // ──────────────────────────────────────────────────────
  if (step === "assign-person") {
    const currentMember = group.members[assigningPersonIdx];
    const isLastPerson = assigningPersonIdx === group.members.length - 1;
    const selectedCount = unequalIndices.filter(
      (itemIdx) => assignments.get(itemIdx)?.has(currentMember.id) ?? false
    ).length;
    const allSelected = unequalIndices.length > 0 && selectedCount === unequalIndices.length;

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
            Which items include {currentMember.isYou ? "you" : currentMember.name}?
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Tap all the items {currentMember.isYou ? "you" : currentMember.name} had —
            shared items are already handled from step 1.
          </p>
        </div>

        {/* Count + select-all row */}
        <div className="flex items-center justify-between py-3">
          <span className="text-sm font-semibold">{selectedCount} items selected</span>
          <button
            type="button"
            onClick={() => toggleSelectAllForCurrentPerson(currentMember.id, allSelected)}
            className="text-sm text-muted-foreground border border-border rounded-lg px-3 py-1 hover:bg-muted/40 transition-colors"
          >
            {allSelected ? "Deselect all" : "Select all"}
          </button>
        </div>

        {/* Item list (unequal items only — equal items are bundled separately) */}
        <div className="space-y-2 mb-5 overflow-y-auto -mx-1 px-1">
          {unequalIndices.map((itemIdx) => {
            const item = TRATTORIA_RECEIPT.items[itemIdx];
            const isChecked = assignments.get(itemIdx)?.has(currentMember.id) ?? false;
            const assignedInitials = Array.from(assignments.get(itemIdx) ?? [])
              .map((id) => {
                const m = group.members.find((mm) => mm.id === id);
                return m ? (m.isYou ? "You" : getInitials(m.name)) : null;
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
                  {assignedInitials.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">{assignedInitials.join(", ")}</p>
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
              `Assign ${selectedCount} item${selectedCount !== 1 ? "s" : ""}`
            ) : (
              <>
                Next person <ArrowRight className="w-4 h-4 ml-1" />
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────
  // Step 4 — Finalizing loader
  // ──────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto w-full text-center gap-4">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
      <div>
        <div className="text-base font-semibold">Splitting items…</div>
        <div className="text-xs text-muted-foreground mt-1">
          Bundling shared items + breaking out individual ones
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// Stylized receipt (used in both step 1 and step 2)
// ──────────────────────────────────────────────────────
function ReceiptCard() {
  return (
    <div
      className="rounded-2xl border border-border p-4 font-mono text-xs"
      style={{ background: "#FBF6EC", color: "#1f1f1f" }}
    >
      <div className="text-center pb-2 border-b border-dashed border-stone-400/50">
        <div className="font-bold text-sm">{TRATTORIA_RECEIPT.restaurant}</div>
        <div className="text-[10px] opacity-70">{TRATTORIA_RECEIPT.date}</div>
        <div className="text-[10px] opacity-70">{TRATTORIA_RECEIPT.cover}</div>
      </div>
      <div className="py-2 space-y-0.5">
        {TRATTORIA_RECEIPT.items.map((item) => (
          <div key={item.id} className="flex justify-between leading-tight">
            <span className="truncate pr-2">{item.name}</span>
            <span className="tabular-nums shrink-0">{item.price.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div className="pt-2 border-t border-dashed border-stone-400/50 space-y-0.5">
        <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{TRATTORIA_RECEIPT.subtotal.toFixed(2)}</span></div>
        <div className="flex justify-between opacity-80"><span>Tax (13%)</span><span className="tabular-nums">{TRATTORIA_RECEIPT.tax.toFixed(2)}</span></div>
        <div className="flex justify-between opacity-80"><span>Tip (18%)</span><span className="tabular-nums">{TRATTORIA_RECEIPT.tip.toFixed(2)}</span></div>
        <div className="flex justify-between font-bold pt-1 border-t border-dashed border-stone-400/50 mt-1">
          <span>TOTAL</span><span className="tabular-nums">{TRATTORIA_RECEIPT.total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
