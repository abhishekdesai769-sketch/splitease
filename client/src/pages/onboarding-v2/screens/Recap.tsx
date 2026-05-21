/**
 * Screen 05 · Recap — "look what you just did", the last screen of the demo.
 *
 * Surfaces the demoStats (expense count + time) so the value of the demo
 * lands, then hands the user off to the real signup. No "magic moment"
 * wording — just the concrete numbers.
 */
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import type { DemoStats } from "../state";

interface Props {
  stats: DemoStats | null;
  /** continue to the real signup */
  onContinue: () => void;
}

export function RecapScreen({ stats, onContinue }: Props) {
  const totalExpenses = stats?.totalExpenses ?? 0;
  const secondsElapsed = stats?.secondsElapsed ?? 0;
  const aiCreated = stats?.aiExpensesCreated ?? 0;

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
      <div className="flex-1 flex flex-col justify-center space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-[10px] uppercase tracking-wider font-mono font-semibold">
            Demo complete
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">
            You logged{" "}
            <span className="text-primary">{totalExpenses} expenses</span> in{" "}
            <span className="text-primary">{secondsElapsed} seconds.</span>
          </h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
            The AI Scanner alone turned one receipt photo into{" "}
            <span className="font-semibold text-foreground">
              {aiCreated} split expenses
            </span>{" "}
            — tax and tip included. By hand, that's the better part of ten
            minutes of receipt math, every single time.
          </p>
        </div>

        {/* Stat row */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-card border border-border p-3">
            <div className="text-lg font-semibold text-primary">{totalExpenses}</div>
            <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mt-0.5">
              expenses
            </div>
          </div>
          <div className="rounded-xl bg-card border border-border p-3">
            <div className="text-lg font-semibold text-primary">{secondsElapsed}s</div>
            <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mt-0.5">
              your time
            </div>
          </div>
          <div className="rounded-xl bg-card border border-border p-3">
            <div className="text-lg font-semibold text-primary">~10m</div>
            <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mt-0.5">
              by hand
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground text-center">
          Sign up to start splitting for real — free, always.
        </p>
        <Button
          size="lg"
          className="w-full shadow-sm"
          onClick={onContinue}
          data-testid="onboarding-v2-recap-cta"
        >
          Create your free account
          <ArrowRight className="w-4 h-4 ml-1.5" />
        </Button>
      </div>
    </div>
  );
}
