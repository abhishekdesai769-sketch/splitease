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

type Step = "receipt" | "scanning" | "assign-person" | "finalizing";

const getInitials = (name: string) =>
  name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();

// Tax + tip multiplier applied to each item's price.
// Mirrors the real ReceiptReviewSheet behavior: taxMultiplier = 1 + (tax+tip)/subtotal
const TAX_MULTIPLIER =
  (TRATTORIA_RECEIPT.tax + TRATTORIA_RECEIPT.tip) / TRATTORIA_RECEIPT.subtotal + 1;

export function DemoAIScanner({ group, onComplete, onCancel }: Props) {
  const [step, setStep] = useState<Step>("receipt");
  const startTimeRef = useRef<number | null>(null);

  // ── Derive equal vs unequal item indices from fixture defaults ────────
  // Items whose default assignment includes ALL members are pre-classified
  // as "equal" (split among all, no per-person step UI). Others are unequal.
  const { equalIndices, unequalIndices } = useMemo(() => {
    const allIds = new Set(group.members.map((m) => m.id));
    const equal = new Set<number>();
    const unequal: number[] = [];
    TRATTORIA_RECEIPT.items.forEach((item, idx) => {
      // Drop any fixture-default IDs that aren't in this persona's group
      const validIds = item.defaultAssignedTo.filter((id) => allIds.has(id));
      const coversAllMembers =
        validIds.length === group.members.length &&
        group.members.every((m) => validIds.includes(m.id));
      if (coversAllMembers) equal.add(idx);
      else unequal.push(idx);
    });
    return { equalIndices: equal, unequalIndices: unequal };
  }, [group.members]);

  // ── Assignment state: Map<itemIdx, Set<memberId>> ──
  // Pre-seed unequal items with their fixture defaults (filtered to actual
  // members). The per-person step toggles entries in/out of these sets.
  const [assignments, setAssignments] = useState<Map<number, Set<string>>>(() => {
    const init = new Map<number, Set<string>>();
    const allIds = new Set(group.members.map((m) => m.id));
    for (const idx of unequalIndices) {
      const item = TRATTORIA_RECEIPT.items[idx];
      const valid = item.defaultAssignedTo.filter((id) => allIds.has(id));
      init.set(idx, new Set(valid));
    }
    return init;
  });

  const [assigningPersonIdx, setAssigningPersonIdx] = useState(0);

  // Step-2 scan animation: auto-advance after 1500ms
  useEffect(() => {
    if (step !== "scanning") return;
    const t = setTimeout(() => setStep("assign-person"), 1500);
    return () => clearTimeout(t);
  }, [step]);

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
    else setStep("receipt");
  };

  // Build the final splits — mirrors handleCreateSplits in ReceiptReviewSheet:
  //   - Equal items combine into ONE expense, named "Item1 + N more"
  //   - Each unequal item becomes its own expense
  function buildExpensesFromAssignments(): DemoExpense[] {
    const allMemberIds = group.members.map((m) => m.id);
    const youId = group.members.find((m) => m.isYou)?.id ?? allMemberIds[0];
    const splits: DemoExpense[] = [];

    // Equal bundle
    const equalItems = Array.from(equalIndices).map((idx) => TRATTORIA_RECEIPT.items[idx]);
    if (equalItems.length > 0) {
      const preTax = equalItems.reduce((sum, it) => sum + it.price, 0);
      const withTax = Math.round(preTax * TAX_MULTIPLIER * 100) / 100;
      const desc = equalItems.length === 1
        ? equalItems[0].name
        : `${equalItems[0].name} + ${equalItems.length - 1} more`;
      splits.push({
        id: `e-ai-eq-${Date.now()}`,
        description: desc,
        amount: withTax,
        paidById: youId,
        splitAmongIds: allMemberIds,
        date: new Date().toISOString(),
        note: `AI · split ${allMemberIds.length} ways`,
      });
    }

    // Per-item unequal expenses
    let n = 0;
    for (const itemIdx of unequalIndices) {
      const item = TRATTORIA_RECEIPT.items[itemIdx];
      const assigned = Array.from(assignments.get(itemIdx) ?? []);
      const memberIds = assigned.length > 0 ? assigned : allMemberIds;
      const withTax = Math.round(item.price * TAX_MULTIPLIER * 100) / 100;
      splits.push({
        id: `e-ai-${n++}-${Date.now()}`,
        description: item.name,
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
  // Step 3 — Per-person assignment (matches ReceiptReviewSheet exactly)
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
            Person {assigningPersonIdx + 1} of {group.members.length}
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
            Tap all items that involve this person, including shared items.
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
