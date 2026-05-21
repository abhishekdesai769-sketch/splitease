/**
 * Onboarding v2 — top-level container.
 *
 * Holds the state machine, picks the right screen for the current step.
 *
 * Flow (trimmed — no paywall for now):
 *   welcome → pain → persona → simulation_intro → demo_group → recap
 *     → [exit preview → the real app signup]
 *
 * IMPORTANT — still preview-only:
 *   - Mounted only via the hidden preview route `#/onboarding-v2-preview`.
 *     NOT wired into the auth/onboarding gates. Production users still see
 *     the existing FirstRunWizard.
 *   - The demo is a teaching tool — nothing in the demo group is saved.
 *   - After the recap the user is handed off to the real signup; the real
 *     app's own onboarding (currency, first-run) takes over from there.
 *   - The Wave 2 paywall screens (PaywallPrime, Payment, Signup, CreateGroup,
 *     Done, mini-demos) are kept in the codebase but unhooked from this flow
 *     — premium/paywall was descoped for now.
 */
import { useEffect, useReducer } from "react";
import { Chrome } from "./Chrome";
import { WelcomeScreen } from "./screens/Welcome";
import { PainQuestionScreen } from "./screens/PainQuestion";
import { PersonaQuestionScreen } from "./screens/PersonaQuestion";
import { SimulationIntroScreen } from "./screens/SimulationIntro";
import { DemoGroupScreen } from "./screens/DemoGroup";
import { RecapScreen } from "./screens/Recap";
import {
  INITIAL_STATE,
  PROGRESS_STEPS,
  TOTAL_STEPS,
  onboardingReducer,
} from "./state";
import { useTheme } from "@/lib/theme";
import { DEMO_GROUPS } from "./fixtures";

export default function OnboardingV2() {
  const [state, dispatch] = useReducer(onboardingReducer, INITIAL_STATE);
  const step = PROGRESS_STEPS[state.screen];
  const showBack = state.screen !== "welcome";

  // Force LIGHT mode for the entire onboarding session — cleanest first
  // impression of the brand. saveToDb=false so the user's actual theme
  // preference is unaffected; restored on unmount.
  const { themePref, setThemePref } = useTheme();
  useEffect(() => {
    const previous = themePref;
    setThemePref("light", false);
    return () => {
      setThemePref(previous, false);
    };
    // Run once on mount + once on unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Chrome
      step={step}
      totalSteps={TOTAL_STEPS}
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
          onMagicActionComplete={(stats) => dispatch({ type: "advance_to_recap", stats })}
        />
      )}

      {state.screen === "recap" && (
        <RecapScreen
          stats={state.demoStats}
          onContinue={() => {
            // End of the demo — hand off to the real app signup. Leaving the
            // preview route lets App.tsx route a logged-out user to AuthPage.
            window.location.hash = "#/";
          }}
        />
      )}
    </Chrome>
  );
}
