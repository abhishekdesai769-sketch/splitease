/**
 * Demo AI Receipt Scanner — "AI does the work, you confirm" flow.
 *
 * The whole point of this screen is to make AI scanning feel POWERFUL, not
 * tedious. So the demo does NOT make the user assign 17 items. Instead:
 *
 *   1. "receipt"     — stylized 17-line Trattoria bill + "Scan with AI" CTA
 *   2. "scanning"    — ~2.4s animation; AI "thinking" text cycles through
 *   3. "result"      — AI INSTANTLY shows the finished split: each person's
 *                      total. Two buttons: "See how it split it" (optional
 *                      review) + "Looks good — save N expenses" (primary)
 *   4. "review"      — optional, read-only: shows the expense bundles the AI
 *                      created and who each is split among
 *   5. "finalizing"  — brief loader, then onComplete(expenses, durationMs)
 *
 * Assignments come straight from the receipt fixture's defaultAssignedTo
 * (filtered to this persona's members) — the AI "decided" them. The user
 * never has to tap an item. That's the magic.
 *
 * Expense bundling matches the real ReceiptReviewSheet shape: items sharing
 * an identical assignee set collapse into ONE expense.
 */
import { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, Zap, ArrowLeft, Loader2, Check } from "lucide-react";
import { TRATTORIA_RECEIPT } from "../fixtures";
import type { DemoGroup, DemoExpense } from "../fixtures";
import { track } from "@/lib/analytics";

interface Props {
  group: DemoGroup;
  onComplete: (newExpenses: DemoExpense[], durationMs: number) => void;
  onCancel: () => void;
}

type Step = "receipt" | "scanning" | "result" | "review" | "finalizing";

// Tax + tip multiplier — mirrors the real ReceiptReviewSheet's taxMultiplier.
const TAX_MULTIPLIER =
  (TRATTORIA_RECEIPT.tax + TRATTORIA_RECEIPT.tip) / TRATTORIA_RECEIPT.subtotal + 1;

// AI "thinking" lines shown during the scan animation
const THINKING_LINES = [
  "Reading 17 items…",
  "Working out who ordered what…",
  "Splitting tax & tip per person…",
];

export function DemoAIScanner({ group, onComplete, onCancel }: Props) {
  const [step, setStep] = useState<Step>("receipt");
  const [thinkingIdx, setThinkingIdx] = useState(0);
  const startTimeRef = useRef<number | null>(null);

  // ── AI assignment: resolved straight from fixture defaults ──
  // Each item's assignee list is its defaultAssignedTo filtered to members
  // that actually exist in this persona's group. Empty → falls back to
  // everyone (so non-Trip personas still get a sensible split).
  const itemAssignees = useMemo(() => {
    const allIds = group.members.map((m) => m.id);
    return TRATTORIA_RECEIPT.items.map((item) => {
      const valid = item.defaultAssignedTo.filter((id) => allIds.includes(id));
      return valid.length > 0 ? valid : allIds;
    });
  }, [group.members]);

  // ── Per-person totals (for the result screen) ──
  const perPersonTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const m of group.members) totals[m.id] = 0;
    TRATTORIA_RECEIPT.items.forEach((item, idx) => {
      const assignees = itemAssignees[idx];
      const share = item.price / assignees.length;
      for (const id of assignees) totals[id] += share;
    });
    // apply tax + tip proportionally
    const out: Record<string, number> = {};
    for (const m of group.members) {
      out[m.id] = Math.round(totals[m.id] * TAX_MULTIPLIER * 100) / 100;
    }
    return out;
  }, [group.members, itemAssignees]);

  // ── Expense bundles (items grouped by identical assignee set) ──
  const bundledExpenses = useMemo<DemoExpense[]>(() => {
    const youId = group.members.find((m) => m.isYou)?.id ?? group.members[0].id;
    const buckets = new Map<string, { memberIds: string[]; items: typeof TRATTORIA_RECEIPT.items }>();
    TRATTORIA_RECEIPT.items.forEach((item, idx) => {
      const assignees = itemAssignees[idx];
      const key = [...assignees].sort().join("|");
      const bucket = buckets.get(key);
      if (bucket) bucket.items.push(item);
      else buckets.set(key, { memberIds: assignees, items: [item] });
    });

    const stamp = Date.now();
    let n = 0;
    const out: DemoExpense[] = [];
    for (const { memberIds, items } of buckets.values()) {
      const preTax = items.reduce((sum, it) => sum + it.price, 0);
      const withTax = Math.round(preTax * TAX_MULTIPLIER * 100) / 100;
      const desc =
        items.length === 1
          ? items[0].name
          : items.length === 2
            ? `${items[0].name} + ${items[1].name}`
            : `${items[0].name} + ${items.length - 1} more`;
      out.push({
        id: `e-ai-${n++}-${stamp}`,
        description: desc,
        amount: withTax,
        paidById: youId,
        splitAmongIds: memberIds,
        date: new Date().toISOString(),
        note: `AI · split ${memberIds.length} ${memberIds.length === 1 ? "way" : "ways"}`,
      });
    }
    return out;
  }, [group.members, itemAssignees]);

  // Scan-animation: cycle thinking text, then advance to result
  useEffect(() => {
    if (step !== "scanning") return;
    setThinkingIdx(0);
    const i1 = setTimeout(() => setThinkingIdx(1), 800);
    const i2 = setTimeout(() => setThinkingIdx(2), 1600);
    const done = setTimeout(() => setStep("result"), 2400);
    return () => {
      clearTimeout(i1);
      clearTimeout(i2);
      clearTimeout(done);
    };
  }, [step]);

  // Finalizing: brief loader, then hand the bundled expenses back
  useEffect(() => {
    if (step !== "finalizing") return;
    const t = setTimeout(() => {
      const elapsed = startTimeRef.current ? Date.now() - startTimeRef.current : 30_000;
      onComplete(bundledExpenses, elapsed);
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const startScan = () => {
    startTimeRef.current = Date.now();
    track("demo_ai_scanner_scan_tapped");
    setStep("scanning");
  };

  const memberName = (id: string) => {
    const m = group.members.find((mm) => mm.id === id);
    return m ? (m.isYou ? "You" : m.name) : "—";
  };
  const memberColor = (id: string) =>
    group.members.find((mm) => mm.id === id)?.avatarColor ?? "#999";

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
          Pretend you just took a photo of tonight's dinner receipt. The AI will
          read every item and split it for you.
        </p>

        <ReceiptCard />

        <div className="mt-5 mb-3 bg-primary/10 border border-primary/30 rounded-xl px-3 py-2 text-center">
          <span className="text-primary font-semibold text-sm">
            ↓ Tap scan — the AI does the rest
          </span>
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
            {THINKING_LINES[thinkingIdx]}
          </div>
        </div>

        <div className="relative">
          <ReceiptCard />
          <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
            <div
              className="absolute left-0 right-0 h-1 bg-primary/80"
              style={{
                boxShadow: "0 0 18px 6px hsl(172 63% 45% / 0.7)",
                animation: "spliiit-scanline 2.4s ease-in-out forwards",
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
  // Step 3 — Result: the AI's finished split
  // ──────────────────────────────────────────────────────
  if (step === "result") {
    return (
      <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
        <div className="flex flex-col items-center text-center pt-2 pb-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/15 flex items-center justify-center mb-3">
            <Check className="w-6 h-6 text-primary" />
          </div>
          <div className="text-[10px] uppercase tracking-wider font-mono text-primary font-semibold">
            Scan complete
          </div>
          <h2 className="text-xl font-semibold tracking-tight mt-1">
            Done. AI split your ${TRATTORIA_RECEIPT.total.toFixed(2)} bill.
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Every item, tax and tip — sorted per person.
          </p>
        </div>

        {/* Per-person totals */}
        <div className="rounded-2xl border border-border bg-card divide-y divide-border">
          {group.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 p-3.5">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                style={{ backgroundColor: m.avatarColor }}
              >
                {m.isYou ? "Y" : m.name[0]?.toUpperCase()}
              </div>
              <span className="flex-1 text-base font-medium">
                {m.isYou ? "You" : m.name}
              </span>
              <span className="text-base font-semibold font-mono tabular-nums">
                ${perPersonTotals[m.id].toFixed(2)}
              </span>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground text-center mt-3">
          The AI assigned all {TRATTORIA_RECEIPT.items.length} items automatically.
        </p>

        <div className="flex-1" />

        <div className="space-y-2.5 pt-4">
          <Button
            size="lg"
            className="w-full shadow-sm"
            onClick={() => {
              track("demo_ai_scanner_result_accepted");
              setStep("finalizing");
            }}
            data-testid="demo-scanner-accept"
          >
            Looks good — save {bundledExpenses.length} expenses
          </Button>
          <button
            type="button"
            onClick={() => {
              track("demo_ai_scanner_review_opened");
              setStep("review");
            }}
            className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-1.5"
            data-testid="demo-scanner-review"
          >
            See how it split it
          </button>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────
  // Step 4 — Review (optional, read-only)
  // ──────────────────────────────────────────────────────
  if (step === "review") {
    return (
      <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
        <div className="flex items-center gap-2 pb-3">
          <Button size="icon" variant="ghost" onClick={() => setStep("result")} aria-label="Back to summary">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">How the AI split it</h2>
            <p className="text-xs text-muted-foreground">
              {bundledExpenses.length} expenses · items grouped by who shared them
            </p>
          </div>
        </div>

        <div className="space-y-2 overflow-y-auto -mx-1 px-1">
          {bundledExpenses.map((exp) => (
            <div key={exp.id} className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{exp.description}</p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {exp.splitAmongIds.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
                      >
                        <span
                          className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-semibold"
                          style={{ backgroundColor: memberColor(id) }}
                        >
                          {memberName(id)[0]?.toUpperCase()}
                        </span>
                        {memberName(id)}
                      </span>
                    ))}
                  </div>
                </div>
                <span className="text-sm font-semibold font-mono tabular-nums shrink-0">
                  ${exp.amount.toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex-1" />

        <Button
          size="lg"
          className="w-full shadow-sm mt-4"
          onClick={() => {
            track("demo_ai_scanner_result_accepted", { from: "review" });
            setStep("finalizing");
          }}
          data-testid="demo-scanner-accept-from-review"
        >
          Looks good — save {bundledExpenses.length} expenses
        </Button>
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
        <div className="text-base font-semibold">Saving to your group…</div>
        <div className="text-xs text-muted-foreground mt-1">
          Adding {bundledExpenses.length} expenses
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
