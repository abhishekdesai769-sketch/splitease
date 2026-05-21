/**
 * Onboarding v2 — top-level container.
 *
 * Holds the state machine, picks the right screen for the current step.
 *
 * IMPORTANT — Wave 1 (this commit):
 *   - This page is mounted only via the hidden preview route
 *     `#/onboarding-v2-preview`. It is NOT wired into the auth/onboarding
 *     gates yet. Production users still see the existing FirstRunWizard.
 *   - The demo_group / paywall_prime / signup / done screens are
 *     placeholder cards in Wave 1. They get built out in Commit 2 (demo
 *     group) and Wave 2 (signup + paywall prime).
 *   - No backend calls. No DB writes. No balance recalculation. Pure
 *     frontend state + analytics events.
 */
import { useEffect, useReducer } from "react";
import { Chrome } from "./Chrome";
import { WelcomeScreen } from "./screens/Welcome";
import { PainQuestionScreen } from "./screens/PainQuestion";
import { PersonaQuestionScreen } from "./screens/PersonaQuestion";
import { DemoGroupScreen } from "./screens/DemoGroup";
import { SimulationIntroScreen } from "./screens/SimulationIntro";
import {
  INITIAL_STATE,
  PROGRESS_STEPS,
  onboardingReducer,
} from "./state";
import { useTheme } from "@/lib/theme";
import { DEMO_GROUPS } from "./fixtures";

export default function OnboardingV2() {
  const [state, dispatch] = useReducer(onboardingReducer, INITIAL_STATE);
  const step = PROGRESS_STEPS[state.screen];
  const showBack = state.screen !== "welcome" && state.screen !== "done";

  // Force LIGHT mode for the entire onboarding session — cleanest first
  // impression of the brand, and matches the canonical look the user wants
  // every new user to see. We use saveToDb=false so the user's actual theme
  // preference (set later in Settings) is unaffected. On unmount we restore
  // whatever their previous pref was so the dashboard reflects their choice.
  const { themePref, setThemePref } = useTheme();
  useEffect(() => {
    const previous = themePref;
    setThemePref("light", false);
    return () => {
      setThemePref(previous, false);
    };
    // Intentionally run once on mount + once on unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Chrome
      step={step}
      onBack={showBack ? () => dispatch({ type: "back" }) : undefined}
    >
      {state.screen === "welcome" && (
        <WelcomeScreen onContinue={() => dispatch({ type: "advance_from_welcome" })} />
      )}

      {state.screen === "pain" && (
        <PainQuestionScreen onSelect={(pain) => dispatch({ type: "select_pain", pain })} />
      )}

      {state.screen === "persona" && (
        <PersonaQuestionScreen onSelect={(persona) => dispatch({ type: "select_persona", persona })} />
      )}

      {state.screen === "simulation_intro" && state.persona && (
        <SimulationIntroScreen
          personaLabel={DEMO_GROUPS[state.persona].name}
          onContinue={() => dispatch({ type: "advance_from_intro" })}
        />
      )}

      {state.screen === "demo_group" && state.persona && (
        <DemoGroupScreen
          persona={state.persona}
          onMagicActionComplete={(stats) => {
            dispatch({ type: "advance_to_paywall_prime", stats });
          }}
        />
      )}

      {state.screen === "paywall_prime" && (
        // Results recap. The Wave-2 paywall prime + payment branching will
        // slot in below this recap. The recap itself is real copy: it shows
        // the user exactly what they accomplished — count of expenses + time
        // — so the value lands before any paywall is shown.
        <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
          <div className="flex-1 flex flex-col justify-center space-y-6">
            <div className="text-center space-y-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-[10px] uppercase tracking-wider font-mono font-semibold">
                Demo complete
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">
                You logged{" "}
                <span className="text-primary">
                  {state.demoStats?.totalExpenses ?? 0} expenses
                </span>{" "}
                in{" "}
                <span className="text-primary">
                  {state.demoStats?.secondsElapsed ?? 0} seconds.
                </span>
              </h2>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
                The AI Scanner alone turned one receipt photo into{" "}
                <span className="font-semibold text-foreground">
                  {state.demoStats?.aiExpensesCreated ?? 0} split expenses
                </span>
                {" "}— tax and tip included. By hand, that's the better part of
                ten minutes of receipt math, every single time.
              </p>
            </div>

            {/* Compact stat row */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-card border border-border p-3">
                <div className="text-lg font-semibold text-primary">
                  {state.demoStats?.totalExpenses ?? 0}
                </div>
                <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mt-0.5">
                  expenses
                </div>
              </div>
              <div className="rounded-xl bg-card border border-border p-3">
                <div className="text-lg font-semibold text-primary">
                  {state.demoStats?.secondsElapsed ?? 0}s
                </div>
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

            <div className="rounded-xl border border-dashed border-border p-3 text-center">
              <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
                Wave 2 builds the paywall prime below this recap
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Persona-mapped Premium pitch (
                {state.persona === "roommate" ? "Recurring Expenses"
                  : state.persona === "trip" ? "AI Receipt Scanner"
                  : "Auto Reminders"}
                ) → "Start free month" CTA (iOS native / Android info / web
                Stripe) → delayed signup → social hook → push permission.
              </p>
            </div>
          </div>
        </div>
      )}
    </Chrome>
  );
}
