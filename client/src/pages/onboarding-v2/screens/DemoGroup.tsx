/**
 * Screen 04 · Demo Group — the persistent "play in this group" context.
 *
 * The user lives here for ~60 seconds. Lands on a persona-specific group with
 * pre-existing expenses and members, learns by doing two things:
 *   1. Add a manual expense (pre-filled — feels quick)
 *   2. Try the AI Scanner with a 17-item Trattoria receipt (the magic moment)
 *
 * IMPORTANT: This is a visual mirror of the real group-detail screen, NOT a
 * reuse of it. We don't import GroupDetail.tsx — that file is tied to live API
 * calls, mutations, and balance math via lib/simplify.ts. Demo lives here in
 * static form so the real app can refactor freely without breaking onboarding.
 *
 * Sub-flow handled via local `subView` state:
 *   "main"        → group view
 *   "add_expense" → manual add modal (pre-filled)
 *   "ai_scanner"  → full-screen AI Scanner takeover
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, Plus, Sparkles, Receipt as ReceiptIcon } from "lucide-react";
import { Avatar } from "../components/Avatar";
import type { Persona, DemoGroup as DemoGroupType, DemoExpense } from "../fixtures";
import { DEMO_GROUPS } from "../fixtures";
import { DemoAddExpense } from "./DemoAddExpense";
import { DemoAIScanner } from "./DemoAIScanner";
import { track } from "@/lib/analytics";

interface Props {
  persona: Persona;
  onMagicActionComplete: () => void;
}

type SubView = "main" | "add_expense" | "ai_scanner";

export function DemoGroupScreen({ persona, onMagicActionComplete }: Props) {
  const baseGroup = DEMO_GROUPS[persona];

  // Track the demo group as mutable state so user-added expenses (manual or
  // AI-scanned) appear in the list immediately. State stays in-memory only —
  // never written to the API.
  const [group, setGroup] = useState<DemoGroupType>(baseGroup);
  const [subView, setSubView] = useState<SubView>("main");

  // Fire the demo_group_loaded event once on mount.
  useState(() => {
    track("demo_group_loaded", { persona });
    return null;
  });

  const handleManualExpenseSubmit = (description: string, amount: number, paidById: string) => {
    const newExpense: DemoExpense = {
      id: `e-manual-${Date.now()}`,
      description,
      amount,
      paidById,
      splitAmongIds: group.members.map((m) => m.id),
      date: new Date().toISOString(),
      note: "split equally",
    };
    setGroup({ ...group, expenses: [...group.expenses, newExpense] });
    setSubView("main");
    track("demo_add_expense_submitted");
  };

  const handleScannerComplete = (aiExpense: DemoExpense) => {
    setGroup({ ...group, expenses: [...group.expenses, aiExpense] });
    setSubView("main");
    track("demo_ai_scanner_completed");
    // Magic action — advance to the next phase of onboarding.
    onMagicActionComplete();
  };

  // ──────────────────────────────────────────────────────
  // Sub-view routing — these render full-screen, replacing
  // the main group view (matches the real app's modal-feel)
  // ──────────────────────────────────────────────────────
  if (subView === "add_expense") {
    return (
      <DemoAddExpense
        group={group}
        onSubmit={handleManualExpenseSubmit}
        onCancel={() => setSubView("main")}
        onTryScanner={() => {
          track("demo_ai_scanner_started");
          setSubView("ai_scanner");
        }}
      />
    );
  }

  if (subView === "ai_scanner") {
    return (
      <DemoAIScanner
        group={group}
        onComplete={handleScannerComplete}
        onCancel={() => setSubView("main")}
      />
    );
  }

  // ──────────────────────────────────────────────────────
  // Main demo group view
  // ──────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
      {/* Group header */}
      <div className="space-y-3 pb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight truncate">{group.name}</h1>
          <span className="text-[9px] uppercase tracking-wider font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
            demo
          </span>
        </div>
        <div className="flex items-center -space-x-2">
          {group.members.map((m) => (
            <Avatar key={m.id} name={m.name} color={m.avatarColor} isYou={m.isYou} size="sm" />
          ))}
          <span className="ml-3 text-xs text-muted-foreground">
            {group.members.length} {group.members.length === 1 ? "person" : "people"}
          </span>
        </div>
      </div>

      {/* Balance ribbon — pre-computed in fixtures, never recalculated */}
      <div className="rounded-2xl bg-primary/10 border border-primary/20 p-4 mb-5">
        <div className="text-[10px] uppercase tracking-wider text-primary font-semibold mb-1">
          your balance
        </div>
        <div className="text-xl font-semibold text-primary">{group.balanceRibbonText}</div>
      </div>

      {/* Recent expenses list */}
      <div className="space-y-2 mb-5">
        <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground px-1">
          Recent expenses
        </div>
        {group.expenses.map((exp) => {
          const payer = group.members.find((m) => m.id === exp.paidById);
          return (
            <div
              key={exp.id}
              className="bg-card border border-border rounded-xl p-3 flex items-center gap-3"
              data-testid={`demo-expense-${exp.id}`}
            >
              <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <ReceiptIcon className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{exp.description}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {payer?.isYou ? "You" : payer?.name} paid · {exp.note}
                </div>
              </div>
              <div className="text-sm font-semibold tabular-nums">
                ${exp.amount.toFixed(2)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Inline coach-mark + Add Expense CTA */}
      <div className="flex-1 flex flex-col justify-end space-y-3 pb-2">
        <div className="text-center text-sm" style={{ fontFamily: "'Caveat', cursive", color: "hsl(172 63% 45%)" }}>
          ↓ Now you try — tap to add one
        </div>
        <Button
          size="lg"
          className="w-full shadow-sm"
          onClick={() => {
            track("demo_add_expense_started");
            setSubView("add_expense");
          }}
          data-testid="demo-add-expense-cta"
        >
          <Plus className="w-4 h-4 mr-1.5" />
          Add an expense
        </Button>
        <button
          onClick={() => {
            track("demo_ai_scanner_started", { entry: "direct" });
            setSubView("ai_scanner");
          }}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 mx-auto"
          data-testid="demo-skip-to-scanner"
        >
          <Sparkles className="w-3 h-3" />
          or jump straight to AI Scanner
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
