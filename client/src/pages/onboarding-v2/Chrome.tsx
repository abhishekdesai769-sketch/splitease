/**
 * Shared chrome for onboarding v2 screens — logo + progress dots + back button.
 *
 * Matches the existing first-run wizard's chrome style (small logo, dot row)
 * so users moving between the two flows see the same brand cues.
 */
import { ArrowLeft } from "lucide-react";

interface ChromeProps {
  step: number;            // 1..5
  totalSteps?: number;     // defaults to 5
  onBack?: () => void;     // omit on welcome screen
  children: React.ReactNode;
}

function Logo() {
  return (
    <div className="flex items-center justify-center gap-2.5">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-label="Spliiit logo">
        <rect width="32" height="32" rx="8" fill="hsl(172 63% 45%)" fillOpacity="0.15" />
        <path d="M9 11h14M9 16h14M9 21h14" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" />
        <path d="M16 8v16" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="text-xl font-semibold tracking-tight text-foreground">
        Spl<span className="text-primary">iii</span>t
      </span>
    </div>
  );
}

function ProgressDots({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5" aria-label={`Step ${step} of ${total}`}>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 w-6 rounded-full transition-colors ${
            i + 1 <= step ? "bg-primary" : "bg-border"
          }`}
        />
      ))}
    </div>
  );
}

export function Chrome({ step, totalSteps = 5, onBack, children }: ChromeProps) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="pt-6 pb-4 px-4 space-y-4">
        <div className="flex items-center justify-between">
          {onBack ? (
            <button
              onClick={onBack}
              className="p-2 -ml-2 rounded-full hover:bg-muted transition-colors"
              aria-label="Back"
              data-testid="onboarding-v2-back"
            >
              <ArrowLeft className="w-5 h-5 text-muted-foreground" />
            </button>
          ) : (
            <div className="w-9" />
          )}
          <Logo />
          <div className="w-9" />
        </div>
        <ProgressDots step={step} total={totalSteps} />
      </header>
      <main className="flex-1 flex flex-col px-4 pb-8">{children}</main>
    </div>
  );
}
