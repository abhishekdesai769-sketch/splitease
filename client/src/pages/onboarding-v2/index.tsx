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
import { useReducer } from "react";
import { Chrome } from "./Chrome";
import { WelcomeScreen } from "./screens/Welcome";
import { PainQuestionScreen } from "./screens/PainQuestion";
import { PersonaQuestionScreen } from "./screens/PersonaQuestion";
import {
  INITIAL_STATE,
  PROGRESS_STEPS,
  onboardingReducer,
} from "./state";

export default function OnboardingV2() {
  const [state, dispatch] = useReducer(onboardingReducer, INITIAL_STATE);
  const step = PROGRESS_STEPS[state.screen];
  const showBack = state.screen !== "welcome" && state.screen !== "done";

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

      {state.screen === "demo_group" && (
        // Placeholder for Commit 2. The full demo group + AI Scanner come next.
        <div className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto w-full text-center space-y-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-mono">
            Wave 1 · Commit 2 will build this screen
          </div>
          <h2 className="text-xl font-semibold">Demo group + AI Scanner coming next</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            You picked the <span className="font-semibold text-foreground">{state.persona}</span> persona
            (pain: <span className="font-semibold text-foreground">{state.pain}</span>).
            The persona-mapped demo group + the 17-item Trattoria receipt magic moment
            land in the next commit.
          </p>
        </div>
      )}
    </Chrome>
  );
}
