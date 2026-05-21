/**
 * Screen 04 · Demo Group — a pixel-faithful clone of pages/group-detail.tsx
 *
 * The user lives here for ~60 seconds. The layout is intentionally identical
 * to the real GroupDetail page so what they see during onboarding == what they
 * see in the real app. Only the data source is swapped (fixtures vs API).
 *
 * Sources mirrored:
 *   - Header (font-serif italic title + members count + total spend subtitle)
 *   - Members row (w-9 h-9 colored avatars, owner crown / admin shield slots
 *     intentionally omitted — demo members aren't real users)
 *   - Balance ribbon ("You are owed $X in total" + per-pair settlement Cards)
 *   - Expenses heading (font-serif) + Card list (w-10 h-10 receipt icon +
 *     description + "X paid · split N ways" subtitle + amount on right)
 *
 * After the AI Scanner completes, this same screen renders a celebration
 * banner at the top showing the time saved + the count of expenses now in
 * the group — the user SEES the lived-in group, not a custom reveal card.
 *
 * IMPORTANT: this does NOT import GroupDetail.tsx — that file is bound to
 * live API calls + lib/simplify.ts. Demo is its own static replica.
 */
import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Plus, Receipt, UserPlus, HandCoins, Sparkles, MoreVertical, ArrowLeft,
} from "lucide-react";
import type { Persona, DemoGroup as DemoGroupType, DemoExpense } from "../fixtures";
import { DEMO_GROUPS } from "../fixtures";
import type { DemoStats } from "../state";
import { DemoAddExpense } from "./DemoAddExpense";
import { DemoAIScanner } from "./DemoAIScanner";
import { track } from "@/lib/analytics";

interface Props {
  persona: Persona;
  onMagicActionComplete: (stats: DemoStats) => void;
}

type SubView = "main" | "add_expense" | "ai_scanner";

// Helpers used in render — replicate what the real GroupDetail derives at render time
const formatCurrency = (n: number) => `$${n.toFixed(2)}`;
const formatLargeCurrency = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function DemoGroupScreen({ persona, onMagicActionComplete }: Props) {
  const baseGroup = DEMO_GROUPS[persona];
  const baseExpenseCount = baseGroup.expenses.length;
  const [group, setGroup] = useState<DemoGroupType>(baseGroup);
  const [subView, setSubView] = useState<SubView>("main");
  // Track which milestones the user has hit. Drives which CTA shows at the
  // bottom of the demo group — no more "Add expense" loop. Flow:
  //   start            → primary: Add expense       · secondary: try AI Scanner
  //   manual added     → primary: Try AI Scanner    · secondary: add another
  //   scanner done     → primary: Continue →        · banner above shows stats
  const manualExpenseAdded = group.expenses.length > baseExpenseCount;
  const [aiScannerCompleted, setAiScannerCompleted] = useState(false);
  const [secondsSaved, setSecondsSaved] = useState<number>(0);
  const [aiExpensesCount, setAiExpensesCount] = useState(0);

  // Fire the demo_group_loaded event once on mount.
  useEffect(() => {
    track("demo_group_loaded", { persona });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleManualExpenseSubmit = (newExpense: DemoExpense) => {
    setGroup({ ...group, expenses: [...group.expenses, newExpense] });
    setSubView("main");
    track("demo_add_expense_submitted");
  };

  // AI Scanner produces MULTIPLE expenses (items bundled by share-combo).
  const handleScannerComplete = (newExpenses: DemoExpense[], durationMs: number) => {
    setGroup({ ...group, expenses: [...group.expenses, ...newExpenses] });
    setSubView("main");
    setAiScannerCompleted(true);
    setSecondsSaved(Math.max(1, Math.round(durationMs / 1000)));
    setAiExpensesCount(newExpenses.length);
    track("demo_ai_scanner_completed", {
      duration_seconds: Math.round(durationMs / 1000),
      expenses_created: newExpenses.length,
    });
  };

  // ──────────────────────────────────────────────────────
  // Sub-view routing
  // ──────────────────────────────────────────────────────
  if (subView === "add_expense") {
    return (
      <DemoAddExpense
        group={group}
        onSubmit={handleManualExpenseSubmit}
        onCancel={() => setSubView("main")}
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
  // Main demo group view — mirrors pages/group-detail.tsx
  // ──────────────────────────────────────────────────────
  const totalExpenseCount = group.expenses.length;
  const totalGroupSpend = group.expenses.reduce((sum, e) => sum + e.amount, 0);

  // Sort expenses by date descending (matches real app's sort)
  const sortedExpenses = [...group.expenses].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full space-y-5">
      {/* Celebration banner — appears after AI Scanner completes */}
      {aiScannerCompleted && (
        <div className="rounded-2xl bg-primary/10 border border-primary/30 p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-wider font-mono text-primary font-semibold">
                {secondsSaved}s · ~8 min saved
              </div>
              <div className="text-base font-semibold mt-0.5 leading-snug">
                {totalExpenseCount} expenses logged. ${totalGroupSpend.toFixed(2)} split.
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                That's your group now — fully settled, fairly split.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Header (matches GroupDetail.tsx header) ────────── */}
      <div className="flex items-center gap-3">
        <Button size="icon" variant="ghost" disabled aria-label="Back">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold tracking-tight truncate font-serif">
            <em className="italic">{group.name}</em>
            <span className="ml-2 text-[9px] uppercase tracking-wider font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded-full not-italic">
              demo
            </span>
          </h1>
          <p className="text-sm text-muted-foreground font-mono">
            {group.members.length} members · ${totalGroupSpend.toFixed(2)} total
          </p>
        </div>
        <Button size="icon" variant="ghost" disabled aria-label="Group menu">
          <MoreVertical className="w-4 h-4" />
        </Button>
      </div>

      {/* ── Members bar (matches real members row) ─────────── */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {group.members.map((m) => (
          <div key={m.id} className="flex flex-col items-center gap-1 shrink-0">
            <div className="relative">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold"
                style={{ backgroundColor: m.avatarColor }}
              >
                {m.isYou ? "Y" : m.name[0]?.toUpperCase()}
              </div>
            </div>
            <span className="text-xs truncate max-w-[48px] text-muted-foreground">
              {m.isYou ? "You" : m.name.split(" ")[0]}
            </span>
          </div>
        ))}
        <button
          type="button"
          disabled
          className="flex flex-col items-center gap-1 shrink-0 opacity-60 cursor-not-allowed"
          aria-label="Invite (disabled in demo)"
        >
          <div className="w-9 h-9 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center">
            <UserPlus className="w-4 h-4 text-muted-foreground" />
          </div>
          <span className="text-xs text-muted-foreground">Invite</span>
        </button>
      </div>

      {/* ── Balance ribbon + per-pair settlements (matches real app) ── */}
      <div>
        <p className="text-base font-semibold mb-3">
          {group.balanceRibbonTone === "owed" ? "You are owed " : "You owe "}
          <span className={group.balanceRibbonTone === "owed" ? "text-primary" : "text-destructive"}>
            ${(() => {
              // pull the dollars-and-cents from the pre-baked ribbon text
              const m = group.balanceRibbonText.match(/\$([\d,]+(?:\.\d{2})?)/);
              return m ? m[1] : "0.00";
            })()}
          </span>
          {" in total"}
        </p>

        {group.perPairBalances.length > 0 && (
          <div className="space-y-2 mb-3">
            <h3 className="text-sm font-medium text-muted-foreground font-serif">
              Your balances:
            </h3>
            {group.perPairBalances.map((p, i) => (
              <Card key={i} className="p-4 flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
                  style={{ backgroundColor: p.otherColor }}
                >
                  {p.otherName[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base">
                    {p.youOwe ? (
                      <>
                        <span className="text-destructive font-medium">You owe</span>{" "}
                        <span className="font-medium">{p.otherName}</span>
                      </>
                    ) : (
                      <>
                        <span className="font-medium">{p.otherName}</span>{" "}
                        <span className="text-primary font-medium">owes you</span>
                      </>
                    )}
                  </p>
                </div>
                <span
                  className={`text-base font-semibold shrink-0 font-mono ${
                    p.youOwe ? "text-destructive" : "text-primary"
                  }`}
                >
                  {formatCurrency(p.amount)}
                </span>
              </Card>
            ))}
          </div>
        )}

        <Button variant="outline" size="sm" className="w-full" disabled>
          <HandCoins className="w-4 h-4 mr-1.5" />
          Settle Up
        </Button>
      </div>

      {/* ── Expenses heading + list (matches real app exactly) ── */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground font-serif">Expenses</h3>
        {sortedExpenses.map((expense) => {
          const payer = group.members.find((m) => m.id === expense.paidById);
          const payerName = payer?.isYou ? "You" : payer?.name ?? "—";
          return (
            <Card key={expense.id} className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-primary/10">
                  <Receipt className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-medium truncate">{expense.description}</p>
                  <p className="text-sm text-muted-foreground font-mono mt-0.5">
                    {payerName} paid · split {expense.splitAmongIds.length} ways
                  </p>
                </div>
                <span className="text-right shrink-0 font-mono">
                  <span className="text-base font-semibold text-foreground">
                    {formatLargeCurrency(expense.amount)}
                  </span>
                </span>
              </div>
            </Card>
          );
        })}
      </div>

      {/* ── Bottom CTA — three states, one of them at a time ── */}
      <div className="pt-2 pb-2 space-y-3">
        {/* State 1 — Nothing done yet: primary Add Expense + secondary AI Scanner */}
        {!manualExpenseAdded && !aiScannerCompleted && (
          <>
            <div className="bg-primary/10 border border-primary/30 rounded-xl px-3 py-2 text-center">
              <span className="text-primary font-semibold text-sm">
                ↓ Now you try — tap to add an expense
              </span>
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
              Add expense
            </Button>
            <button
              type="button"
              onClick={() => {
                track("demo_ai_scanner_started", { entry: "direct" });
                setSubView("ai_scanner");
              }}
              className="w-full text-sm text-primary font-medium flex items-center justify-center gap-1 py-1"
              data-testid="demo-skip-to-scanner"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Or jump straight to AI Scanner →
            </button>
          </>
        )}

        {/* State 2 — Manual expense added, scanner not yet: primary AI Scanner */}
        {manualExpenseAdded && !aiScannerCompleted && (
          <>
            <div className="bg-primary/10 border border-primary/30 rounded-xl px-3 py-2 text-center">
              <span className="text-primary font-semibold text-sm">
                ✨ Nice. Now try the magic one — AI Receipt Scanner.
              </span>
            </div>
            <Button
              size="lg"
              className="w-full shadow-sm"
              onClick={() => {
                track("demo_ai_scanner_started", { entry: "after_manual" });
                setSubView("ai_scanner");
              }}
              data-testid="demo-try-scanner-after-manual"
            >
              <Sparkles className="w-4 h-4 mr-1.5" />
              Try AI Receipt Scanner
            </Button>
            <button
              type="button"
              onClick={() => {
                track("demo_add_expense_started", { entry: "secondary" });
                setSubView("add_expense");
              }}
              className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1 py-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Or add another expense manually
            </button>
          </>
        )}

        {/* State 3 — Magic moment done: Continue (passes stats to the recap) */}
        {aiScannerCompleted && (
          <Button
            size="lg"
            className="w-full shadow-sm"
            onClick={() =>
              onMagicActionComplete({
                totalExpenses: group.expenses.length,
                aiExpensesCreated: aiExpensesCount,
                secondsElapsed: secondsSaved,
              })
            }
            data-testid="demo-continue-after-magic"
          >
            Continue →
          </Button>
        )}
      </div>
    </div>
  );
}
