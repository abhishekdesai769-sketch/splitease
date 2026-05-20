/**
 * Screen 01 · Welcome
 * Headline: "Splitting bills shouldn't suck."
 * Single CTA: "Show me how →"
 *
 * No friction, no signup ask. The job is one tap.
 */
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { useEffect } from "react";

interface Props {
  onContinue: () => void;
}

export function WelcomeScreen({ onContinue }: Props) {
  // Fire `onboarding_started` once on mount — top of the funnel.
  // Wrapped in useEffect-with-no-deps so it only runs the first time the
  // welcome screen renders during a single onboarding session.
  useEffect(() => {
    track("onboarding_started", { flow: "v2" });
  }, []);

  const handleContinue = () => {
    track("welcome_advanced", { flow: "v2" });
    onContinue();
  };

  return (
    <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full text-center space-y-8">
      {/* Hero icon — animated three-bar mark to echo the logo */}
      <div className="flex items-center justify-center">
        <div className="relative w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center">
          <svg width="44" height="44" viewBox="0 0 32 32" fill="none">
            <path d="M9 11h14M9 16h14M9 21h14" stroke="hsl(172 63% 45%)" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M16 8v16" stroke="hsl(172 63% 45%)" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          Splitting bills shouldn't suck.
        </h1>
        <p className="text-base text-muted-foreground leading-relaxed max-w-sm mx-auto">
          Spliiit does the math, chases your friends, and keeps the receipts.
          Free forever for the basics.
        </p>
      </div>

      <div className="pt-2">
        <Button
          size="lg"
          className="w-full max-w-xs mx-auto"
          onClick={handleContinue}
          data-testid="onboarding-v2-welcome-cta"
        >
          Show me how →
        </Button>
      </div>
    </div>
  );
}
