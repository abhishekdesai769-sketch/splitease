/**
 * Onboarding v2 — top-level container.
 *
 * Holds the state machine, picks the right screen for the current step.
 *
 * IMPORTANT — still preview-only:
 *   - Mounted only via the hidden preview route `#/onboarding-v2-preview`.
 *     NOT wired into the auth/onboarding gates. Production users still see
 *     the existing FirstRunWizard.
 *   - Wave 1 (welcome → demo group + AI Scanner) and Wave 2 (recap →
 *     paywall prime → signup → done) are all UI. No backend calls, no DB
 *     writes, no real payment, no real signup, no balance recalculation.
 *   - Real wiring (DB migration, RevenueCat/Stripe, OTP auth, flipping v2
 *     to be the live onboarding) is a separate cutover task.
 */
import { useEffect, useReducer } from "react";
import { Chrome } from "./Chrome";
import { WelcomeScreen } from "./screens/Welcome";
import { PainQuestionScreen } from "./screens/PainQuestion";
import { PersonaQuestionScreen } from "./screens/PersonaQuestion";
import { SimulationIntroScreen } from "./screens/SimulationIntro";
import { DemoGroupScreen } from "./screens/DemoGroup";
import { RecapScreen } from "./screens/Recap";
import { PaywallPrime } from "./screens/PaywallPrime";
import { SignupScreen } from "./screens/Signup";
import { DoneScreen } from "./screens/Done";
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
  const showBack = state.screen !== "welcome" && state.screen !== "done";

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

  // Derived values for screens that need the demo group name / expense count
  const groupName = state.persona ? DEMO_GROUPS[state.persona].name : "your group";
  const expenseCount = state.demoStats?.totalExpenses ?? 0;

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
          onContinue={() => dispatch({ type: "advance_to_paywall" })}
        />
      )}

      {state.screen === "paywall_prime" && state.persona && (
        <PaywallPrime
          persona={state.persona}
          onChoose={(trialStarted) => dispatch({ type: "advance_to_signup", trialStarted })}
        />
      )}

      {state.screen === "signup" && (
        <SignupScreen
          groupName={groupName}
          expenseCount={expenseCount}
          trialStarted={state.trialStarted}
          onSignup={() => dispatch({ type: "advance_to_done", signedUp: true })}
          onSkip={() => dispatch({ type: "advance_to_done", signedUp: false })}
        />
      )}

      {state.screen === "done" && (
        <DoneScreen
          groupName={groupName}
          expenseCount={expenseCount}
          trialStarted={state.trialStarted}
          signedUp={state.signedUp}
          onFinish={() => {
            // Exit the preview route — at cutover this becomes the real
            // hand-off into the app.
            window.location.hash = "#/";
          }}
        />
      )}
    </Chrome>
  );
}
