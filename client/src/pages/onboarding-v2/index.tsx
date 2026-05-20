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
import { DemoGroupScreen } from "./screens/DemoGroup";
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

      {state.screen === "demo_group" && state.persona && (
        <DemoGroupScreen
          persona={state.persona}
          onMagicActionComplete={() => {
            dispatch({ type: "demo_ai_scanner_completed" });
            dispatch({ type: "advance_to_paywall_prime" });
          }}
        />
      )}

      {state.screen === "paywall_prime" && (
        // Placeholder for Wave 2 — paywall prime + Recurring/Auto-Reminders demos
        // + persona-mapped feature pitch + iOS / Android / web payment branching.
        // Showing a celebratory "magic moment done" screen so the preview flow
        // has a satisfying end-state during dogfooding.
        <div className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto w-full text-center space-y-5 px-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-mono">
            Wave 2 will build the paywall prime here
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">
            You just did the magic moment. ⚡
          </h2>
          <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
            Next up (Wave 2): a persona-mapped Premium feature pitch
            (<span className="font-semibold text-foreground">
              {state.persona === "roommate" ? "Recurring Expenses"
                : state.persona === "trip" ? "AI Receipt Scanner"
                : "Auto Reminders (friendly · firm · funny)"}
            </span>),
            a "Start free month" CTA (iOS native / Android info screen / web Stripe),
            then delayed signup, social hook, and smart push permission.
          </p>
          <div className="text-xs text-muted-foreground">
            For now: tap back to replay any step, or close this preview.
          </div>
        </div>
      )}
    </Chrome>
  );
}
