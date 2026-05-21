/**
 * Onboarding v2 state — single source of truth for the flow.
 *
 * Lives entirely in the OnboardingV2 component via useReducer. No global store.
 * Wave 1 + Wave 2 screens; everything still preview-only (no real signup,
 * no real payment, no DB writes).
 */
import type { Persona, PainPoint } from "./fixtures";

export type ScreenId =
  | "welcome"
  | "pain"
  | "persona"
  | "simulation_intro" // primes the user that the next screen is a simulation
  | "demo_group"       // the magic-action zone
  | "recap"            // "you logged N expenses in X seconds"
  | "paywall_prime"    // persona-mapped Premium pitch + platform-aware CTA
  | "signup"           // delayed signup — "save your experience"
  | "done";            // success / welcome screen

// Stats captured at the end of the demo group, surfaced on the recap screen.
export interface DemoStats {
  totalExpenses: number;       // total expenses in the demo group at the end
  aiExpensesCreated: number;   // how many the AI Scanner produced from one receipt
  secondsElapsed: number;      // how long the scanner run actually took
}

export interface OnboardingState {
  screen: ScreenId;
  pain: PainPoint | null;
  persona: Persona | null;
  demoStats: DemoStats | null;
  // Wave 2 — set when the user makes a choice on the paywall / signup screens.
  trialStarted: boolean;       // did they tap "Start free month"
  signedUp: boolean;           // did they complete the signup mockup
}

export const INITIAL_STATE: OnboardingState = {
  screen: "welcome",
  pain: null,
  persona: null,
  demoStats: null,
  trialStarted: false,
  signedUp: false,
};

export type OnboardingAction =
  | { type: "advance_from_welcome" }
  | { type: "select_pain"; pain: PainPoint }
  | { type: "select_persona"; persona: Persona }
  | { type: "advance_from_intro" }
  | { type: "back" }
  | { type: "advance_to_recap"; stats: DemoStats }
  | { type: "advance_to_paywall" }
  | { type: "advance_to_signup"; trialStarted: boolean }
  | { type: "advance_to_done"; signedUp: boolean };

export function onboardingReducer(
  state: OnboardingState,
  action: OnboardingAction
): OnboardingState {
  switch (action.type) {
    case "advance_from_welcome":
      return { ...state, screen: "pain" };

    case "select_pain":
      return { ...state, pain: action.pain, screen: "persona" };

    case "select_persona":
      return { ...state, persona: action.persona, screen: "simulation_intro" };

    case "advance_from_intro":
      return { ...state, screen: "demo_group" };

    case "advance_to_recap":
      return { ...state, screen: "recap", demoStats: action.stats };

    case "advance_to_paywall":
      return { ...state, screen: "paywall_prime" };

    case "advance_to_signup":
      return { ...state, screen: "signup", trialStarted: action.trialStarted };

    case "advance_to_done":
      return { ...state, screen: "done", signedUp: action.signedUp };

    case "back":
      if (state.screen === "pain")              return { ...state, screen: "welcome" };
      if (state.screen === "persona")           return { ...state, screen: "pain" };
      if (state.screen === "simulation_intro")  return { ...state, screen: "persona" };
      if (state.screen === "demo_group")        return { ...state, screen: "simulation_intro" };
      if (state.screen === "recap")             return { ...state, screen: "demo_group" };
      if (state.screen === "paywall_prime")     return { ...state, screen: "recap" };
      if (state.screen === "signup")            return { ...state, screen: "paywall_prime" };
      return state;

    default:
      return state;
  }
}

// Progress dots — 6 total. Screens that pair up share a dot.
export const TOTAL_STEPS = 6;
export const PROGRESS_STEPS: Record<ScreenId, number> = {
  welcome:          1,
  pain:             2,
  persona:          3,
  simulation_intro: 4,
  demo_group:       4,
  recap:            5,
  paywall_prime:    5,
  signup:           6,
  done:             6,
};
