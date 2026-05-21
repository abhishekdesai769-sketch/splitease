/**
 * Screen 03b · Simulation intro
 *
 * Sits between the Persona pick and the actual demo group. The job is to set
 * expectation: "the next thing you see is a simulation, not your real data."
 * Otherwise users land in a lived-in group with names like "Priya" and "Marcus"
 * and briefly wonder where those people came from.
 *
 * Single tap to advance. No friction.
 */
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight, Wand2 } from "lucide-react";
import { track } from "@/lib/analytics";

interface Props {
  personaLabel: string; // e.g. "Lisbon Trip", "Apartment 4B"
  onContinue: () => void;
}

export function SimulationIntroScreen({ personaLabel, onContinue }: Props) {
  const handleContinue = () => {
    track("simulation_intro_advanced");
    onContinue();
  };

  return (
    <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full text-center space-y-6">
      <div className="flex items-center justify-center">
        <div className="relative w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center">
          <Wand2 className="w-9 h-9 text-primary" />
        </div>
      </div>

      <div className="space-y-3">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-[10px] uppercase tracking-wider font-mono font-semibold">
          <Sparkles className="w-3 h-3" />
          Quick simulation · ~60 seconds
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          We'll show you how Spliiit works — in your own demo group.
        </h1>
        <p className="text-base text-muted-foreground leading-relaxed max-w-sm mx-auto">
          We're dropping you into a fake <span className="font-semibold text-foreground">{personaLabel}</span> with
          some pre-loaded expenses. You'll add one manually, then try{" "}
          <span className="font-semibold text-foreground">AI Receipt Scanner</span>{" "}
          on a real-looking restaurant bill. Nothing here is saved unless you sign up.
        </p>
      </div>

      {/* What you'll do — 3-step preview so it feels short */}
      <div className="bg-card border border-border rounded-2xl p-4 text-left space-y-3 max-w-sm mx-auto w-full">
        <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
          Your 3 steps
        </div>
        <ol className="space-y-2.5 text-sm">
          <li className="flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">1</span>
            <span>Look around your demo group — see what a real group looks like.</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">2</span>
            <span>Add an expense manually (we'll pre-fill most of it).</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">3</span>
            <span>Try the AI Scanner on a 17-item restaurant bill.</span>
          </li>
        </ol>
      </div>

      <div className="pt-2">
        <Button
          size="lg"
          className="w-full max-w-xs mx-auto"
          onClick={handleContinue}
          data-testid="onboarding-v2-intro-cta"
        >
          Got it — let's go
          <ArrowRight className="w-4 h-4 ml-1.5" />
        </Button>
      </div>
    </div>
  );
}
