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

interface OnboardingV2Props {
  /**
   * When true (the real new-user flow), records in localStorage that the
   * onboarding demo has been shown — so it appears exactly ONCE per install
   * and never again. The QA preview route omits this, so previewing never
   * marks the demo as seen.
   */
  markSeenOnMount?: boolean;
  /**
   * Called when the demo finishes (recap → "Create your free account").
   * The real flow passes this so AppRouter can swap to the real signup.
   * The QA preview route omits it — there we just reset the hash instead.
   */
  onFinish?: () => void;
}

export default function OnboardingV2({ markSeenOnMount = false, onFinish }: OnboardingV2Props) {
  const [state, dispatch] = useReducer(onboardingReducer, INITIAL_STATE);
  const step = PROGRESS_STEPS[state.screen];
  const showBack = state.screen !== "welcome";

  // Mark the demo as "seen" on first paint. Done on mount (not on completion)
  // so it shows strictly once on first install — quitting mid-demo doesn't
  // re-trigger it on the next launch.
  useEffect(() => {
    if (markSeenOnMount) {
      try {
        localStorage.setItem("spliiit_seen_onboarding", "true");
      } catch {
        /* private mode / storage disabled — non-fatal */
      }
    }
  }, [markSeenOnMount]);

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
            // End of the demo — hand off to the real app signup.
            if (onFinish) {
              // Real flow: AppRouter swaps this out for AuthPage.
              onFinish();
            } else {
              // QA preview: just leave the preview route.
              window.location.hash = "#/";
            }
          }}
        />
      )}
    </Chrome>
  );
}
