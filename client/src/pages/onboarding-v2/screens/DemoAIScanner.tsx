/**
 * Demo AI Receipt Scanner — THE magic moment of onboarding v2.
 *
 * 4 internal steps:
 *   1. "receipt"   — Show the stylized 17-line Trattoria bill + "Scan with AI" CTA
 *   2. "scanning"  — 1.5s scan animation (teal sweep + items lighting up)
 *   3. "assign"    — Interactive item-by-item assignment. Pre-seeded so the user
 *                    can either tweak or hit Auto-Assign and skip ahead. Running
 *                    totals per person update live at the bottom.
 *   4. "reveal"    — Per-person summary, confetti burst, "30 sec vs 8 minutes" headline
 *
 * Important: this is mocked. No backend call. The "scan" is theater.
 * The whole point is to let the user FEEL how powerful AI Scanner is so the
 * paywall prime on the next screen lands at peak desire.
 */
import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, X, Check, Zap } from "lucide-react";
import { Avatar } from "../components/Avatar";
import { Confetti } from "../components/Confetti";
import { TRATTORIA_RECEIPT } from "../fixtures";
import type { DemoGroup as DemoGroupType, DemoExpense, ReceiptItem } from "../fixtures";
import { track } from "@/lib/analytics";

interface Props {
  group: DemoGroupType;
  onComplete: (aiExpense: DemoExpense) => void;
  onCancel: () => void;
}

type Step = "receipt" | "scanning" | "assign" | "reveal";

// Build initial assignment map. Falls back to "everyone" if the fixture's
// defaultAssignedTo references members not in this group.
function initialAssignments(group: DemoGroupType): Record<string, string[]> {
  const groupMemberIds = new Set(group.members.map((m) => m.id));
  const map: Record<string, string[]> = {};
  for (const item of TRATTORIA_RECEIPT.items) {
    const valid = item.defaultAssignedTo.filter((id) => groupMemberIds.has(id));
    map[item.id] = valid.length > 0 ? valid : group.members.map((m) => m.id);
  }
  return map;
}

// Compute per-person totals from current assignments + add proportional tax+tip.
function computeTotals(assignments: Record<string, string[]>, group: DemoGroupType): Record<string, number> {
  const subtotalByPerson: Record<string, number> = {};
  for (const m of group.members) subtotalByPerson[m.id] = 0;

  for (const item of TRATTORIA_RECEIPT.items) {
    const assignees = assignments[item.id] || [];
    if (assignees.length === 0) continue;
    const share = item.price / assignees.length;
    for (const id of assignees) {
      subtotalByPerson[id] = (subtotalByPerson[id] || 0) + share;
    }
  }

  // Proportional tax + tip distribution
  const subtotal = Object.values(subtotalByPerson).reduce((a, b) => a + b, 0);
  if (subtotal === 0) return subtotalByPerson;
  const taxTipMultiplier = (TRATTORIA_RECEIPT.tax + TRATTORIA_RECEIPT.tip) / subtotal;
  const totals: Record<string, number> = {};
  for (const id of Object.keys(subtotalByPerson)) {
    totals[id] = subtotalByPerson[id] * (1 + taxTipMultiplier);
  }
  return totals;
}

export function DemoAIScanner({ group, onComplete, onCancel }: Props) {
  const [step, setStep] = useState<Step>("receipt");
  const [assignments, setAssignments] = useState<Record<string, string[]>>(() => initialAssignments(group));
  const [showConfetti, setShowConfetti] = useState(false);

  const totals = useMemo(() => computeTotals(assignments, group), [assignments, group]);

  // Scan-step timer — auto-advance after 1.5s of theater
  useEffect(() => {
    if (step !== "scanning") return;
    const t = setTimeout(() => setStep("assign"), 1500);
    return () => clearTimeout(t);
  }, [step]);

  // Fire confetti on reveal step
  useEffect(() => {
    if (step === "reveal") setShowConfetti(true);
  }, [step]);

  const toggleAssignment = (itemId: string, memberId: string) => {
    setAssignments((prev) => {
      const current = prev[itemId] || [];
      const next = current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId];
      // Don't allow zero-assignee state — keep at least one person
      if (next.length === 0) return prev;
      return { ...prev, [itemId]: next };
    });
    track("demo_ai_scanner_items_assigned");
  };

  const autoAssign = () => {
    const everyone = group.members.map((m) => m.id);
    const next: Record<string, string[]> = {};
    for (const item of TRATTORIA_RECEIPT.items) next[item.id] = everyone;
    setAssignments(next);
    track("demo_ai_scanner_auto_assigned");
  };

  const handleSaveSplit = () => {
    setStep("reveal");
  };

  const handleFinish = () => {
    // Materialize the result as a new expense in the demo group.
    // We pick the user as the "payer" for the demo — feels natural since
    // they're the one running the scanner.
    const youId = group.members.find((m) => m.isYou)?.id ?? group.members[0].id;
    const aiExpense: DemoExpense = {
      id: `e-ai-${Date.now()}`,
      description: `Dinner at ${TRATTORIA_RECEIPT.restaurant}`,
      amount: TRATTORIA_RECEIPT.total,
      paidById: youId,
      splitAmongIds: group.members.map((m) => m.id),
      date: new Date().toISOString(),
      note: "AI-split · 17 items",
    };
    onComplete(aiExpense);
  };

  // ──────────────────────────────────────────────────────
  // Step 1 — Receipt + Scan CTA
  // ──────────────────────────────────────────────────────
  if (step === "receipt") {
    return (
      <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
        <div className="flex items-center justify-between pb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">AI Receipt Scanner</h2>
          </div>
          <button
            onClick={onCancel}
            className="p-2 -mr-2 rounded-full hover:bg-muted transition-colors"
            aria-label="Cancel"
            data-testid="demo-scanner-cancel-receipt"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          Pretend you just took this photo of tonight's dinner receipt.
        </p>

        {/* Stylized receipt — monospace + dashed dividers */}
        <ReceiptCard />

        <div className="mt-5 mb-3 text-center text-sm" style={{ fontFamily: "'Caveat', cursive", color: "hsl(172 63% 45%)" }}>
          ↓ Tap to scan it
        </div>
        <Button
          size="lg"
          className="w-full shadow-sm"
          onClick={() => setStep("scanning")}
          data-testid="demo-scanner-start"
        >
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
          {/* Teal scan-line that sweeps top to bottom */}
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
  // Step 3 — Assignment list
  // ──────────────────────────────────────────────────────
  if (step === "assign") {
    return (
      <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
        <div className="flex items-center justify-between pb-3">
          <div>
            <h2 className="text-lg font-semibold">Assign each item</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Tap avatars to toggle who shared each item.
            </p>
          </div>
          <button
            onClick={onCancel}
            className="p-2 -mr-2 rounded-full hover:bg-muted transition-colors"
            aria-label="Cancel"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto -mx-4 px-4 pb-3 space-y-2">
          {TRATTORIA_RECEIPT.items.map((item) => (
            <AssignmentRow
              key={item.id}
              item={item}
              members={group.members}
              assigned={assignments[item.id] || []}
              onToggle={(memberId) => toggleAssignment(item.id, memberId)}
            />
          ))}
        </div>

        {/* Running totals strip */}
        <div className="mt-3 rounded-2xl bg-card border border-border p-3">
          <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-2">
            Running total (incl. tax + tip)
          </div>
          <div className="space-y-1.5">
            {group.members.map((m) => (
              <div key={m.id} className="flex items-center gap-2 text-sm">
                <Avatar name={m.name} color={m.avatarColor} isYou={m.isYou} size="xs" />
                <span className="flex-1 truncate">{m.isYou ? "You" : m.name}</span>
                <span className="font-semibold tabular-nums">
                  ${(totals[m.id] || 0).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={autoAssign} data-testid="demo-scanner-auto-assign">
            Auto-assign equally
          </Button>
          <Button onClick={handleSaveSplit} data-testid="demo-scanner-save">
            Save split →
          </Button>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────
  // Step 4 — Reveal + confetti
  // ──────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full text-center relative">
      <Confetti show={showConfetti} onDone={() => setShowConfetti(false)} />

      <div className="flex-1 flex flex-col items-center justify-center space-y-5 px-2">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/15">
          <Sparkles className="w-8 h-8 text-primary" />
        </div>

        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider font-mono text-primary">
            Done · 30 seconds
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">
            30 seconds. <span className="text-muted-foreground line-through">8 minutes manually.</span>
          </h2>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">
            17 items, tax, tip — all split. Auto-saved to {group.name}.
          </p>
        </div>

        {/* Per-person breakdown */}
        <div className="w-full rounded-2xl bg-card border border-border p-4 space-y-2">
          <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">
            Per person
          </div>
          {group.members.map((m) => (
            <div key={m.id} className="flex items-center gap-2.5 text-sm">
              <Avatar name={m.name} color={m.avatarColor} isYou={m.isYou} size="sm" />
              <span className="flex-1 text-left">{m.isYou ? "You owe yourself nothing" : `${m.name} owes you`}</span>
              <span className="font-semibold tabular-nums">
                ${(totals[m.id] || 0).toFixed(2)}
              </span>
            </div>
          ))}
        </div>

        <div className="text-xs text-muted-foreground">
          AI Receipt Scanner is a <span className="font-semibold text-foreground">Premium</span> feature.
        </div>
      </div>

      <Button
        size="lg"
        className="w-full mt-4"
        onClick={handleFinish}
        data-testid="demo-scanner-finish"
      >
        Continue →
      </Button>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// Subcomponents
// ──────────────────────────────────────────────────────

function ReceiptCard() {
  return (
    <div
      className="rounded-2xl border border-border p-4 font-mono text-xs"
      style={{ background: "#FBF6EC" }}
    >
      <div className="text-center pb-2 border-b border-dashed border-stone-400/50">
        <div className="font-bold text-sm" style={{ color: "#1f1f1f" }}>{TRATTORIA_RECEIPT.restaurant}</div>
        <div className="text-[10px] opacity-70" style={{ color: "#1f1f1f" }}>{TRATTORIA_RECEIPT.date}</div>
        <div className="text-[10px] opacity-70" style={{ color: "#1f1f1f" }}>{TRATTORIA_RECEIPT.cover}</div>
      </div>
      <div className="py-2 space-y-0.5" style={{ color: "#1f1f1f" }}>
        {TRATTORIA_RECEIPT.items.map((item) => (
          <div key={item.id} className="flex justify-between leading-tight">
            <span className="truncate pr-2">{item.name}</span>
            <span className="tabular-nums shrink-0">{item.price.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div className="pt-2 border-t border-dashed border-stone-400/50 space-y-0.5" style={{ color: "#1f1f1f" }}>
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

interface AssignmentRowProps {
  item: ReceiptItem;
  members: DemoGroupType["members"];
  assigned: string[];
  onToggle: (memberId: string) => void;
}

function AssignmentRow({ item, members, assigned, onToggle }: AssignmentRowProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-2.5 flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{item.name}</div>
        <div className="text-[10px] text-muted-foreground tabular-nums">${item.price.toFixed(2)}</div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {members.map((m) => (
          <Avatar
            key={m.id}
            name={m.name}
            color={m.avatarColor}
            isYou={m.isYou}
            size="xs"
            active={assigned.includes(m.id)}
            onClick={() => onToggle(m.id)}
          />
        ))}
      </div>
    </div>
  );
}
