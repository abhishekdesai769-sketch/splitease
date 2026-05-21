/**
 * Recurring Expenses mini-demo — shown inside the paywall prime for the
 * roommate persona. Auto-cycles through months to show the same rent expense
 * logging itself with no input. Pure visual, no interaction needed.
 */
import { useState, useEffect } from "react";
import { Repeat } from "lucide-react";

const MONTHS = ["August", "September", "October", "November"];

export function RecurringMiniDemo() {
  const [monthIdx, setMonthIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setMonthIdx((i) => (i + 1) % MONTHS.length);
    }, 1400);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
          Recurring Expenses
        </div>
        <div className="text-sm font-semibold">{MONTHS[monthIdx]}</div>
      </div>

      {/* The expense — re-appears every month on its own */}
      <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
          <Repeat className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">Apartment rent</div>
          <div className="text-xs text-muted-foreground font-mono">
            Auto-logged · split 3 ways
          </div>
        </div>
        <div className="text-sm font-semibold font-mono tabular-nums">$1,650</div>
      </div>

      {/* Month progress dots */}
      <div className="flex items-center gap-1.5 mt-3">
        {MONTHS.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i <= monthIdx ? "bg-primary" : "bg-border"
            }`}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground mt-2.5">
        Set it once. Spliiit logs it every month — you never touch it again.
      </p>
    </div>
  );
}
