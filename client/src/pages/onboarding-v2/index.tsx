/**
 * Onboarding v2 — top-level container.
 *
 * Holds the state machine, picks the right screen for the current step.
 *
 * Flow:
 *   welcome → pain → persona → simulation_intro → demo_group
 *     → recap → paywall_prime → signup
 *       → (trial) payment → create_group → done
 *       → (no trial)        create_group → done
 *
 * IMPORTANT — still preview-only:
 *   - Mounted only via the hidden preview route `#/onboarding-v2-preview`.
 *     NOT wired into the auth/onboarding gates. Production users still see
 *     the existing FirstRunWizard.
 *   - The demo is a teaching tool — nothing in the demo group is saved. The
 *     user creates their REAL first group on the create_group screen.
 *   - Payment is functional where it can be (web/Android → real redirect to
 *     spliiit.klarityit.ca; iOS → real IAP in the native app, simulated on
 *     web). Signup is still a mockup. DB migration + flipping v2 to be the
 *     live onboarding is a separate cutover task.
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
import { PaymentScreen } from "./screens/Payment";
import { CreateGroupScreen } from "./screens/CreateGroup";
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
          onChoose={(trialStarted, platform) =>
            dispatch({ type: "advance_to_signup", trialStarted, platform })
          }
        />
      )}

      {state.screen === "signup" && (
        <SignupScreen
          trialStarted={state.trialStarted}
          onContinue={() => dispatch({ type: "advance_from_signup" })}
        />
      )}

      {state.screen === "payment" && (
        <PaymentScreen
          platform={state.platform}
          onPaid={() => dispatch({ type: "advance_from_payment" })}
        />
      )}

      {state.screen === "create_group" && (
        <CreateGroupScreen
          onCreate={(groupName) => dispatch({ type: "create_group_done", groupName })}
        />
      )}

      {state.screen === "done" && (
        <DoneScreen
          groupName={state.createdGroupName}
          trialStarted={state.trialStarted}
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
