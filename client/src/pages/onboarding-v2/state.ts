/**
 * Onboarding v2 state — single source of truth for the flow.
 *
 * Lives entirely in the OnboardingV2 component via useReducer. No global store.
 *
 * Flow (trimmed — no paywall for now):
 *   welcome → pain → persona → simulation_intro → demo_group → recap
 *     → [exit preview → the real app signup (AuthPage)]
 *
 * The demo is purely a teaching tool — nothing in it is saved. After the
 * recap the user is handed off to the real signup, and the real app's own
 * onboarding (currency, first-run) takes over.
 *
 * NOTE: the Wave 2 paywall screens (PaywallPrime, Payment, Signup, CreateGroup,
 * Done + the mini-demos) are intentionally kept in the codebase but unhooked
 * from this flow — premium/paywall was descoped for now. PlatformView and
 * DemoStats stay exported so those files keep type-checking.
 */
import type { Persona, PainPoint } from "./fixtures";

export type ScreenId =
  | "welcome"
  | "pain"
  | "persona"
  | "simulation_intro"
  | "demo_group"
  | "recap";

// Retained for the unhooked Wave 2 screens (paywall / payment). Not used by
// the current trimmed flow.
export type PlatformView = "ios" | "android" | "web";

// Stats captured at the end of the demo group, surfaced on the recap screen.
export interface DemoStats {
  totalExpenses: number;
  aiExpensesCreated: number;
  secondsElapsed: number;
}

export interface OnboardingState {
  screen: ScreenId;
  pain: PainPoint | null;
  persona: Persona | null;
  demoStats: DemoStats | null;
}

export const INITIAL_STATE: OnboardingState = {
  screen: "welcome",
  pain: null,
  persona: null,
  demoStats: null,
};

export type OnboardingAction =
  | { type: "advance_from_welcome" }
  | { type: "select_pain"; pain: PainPoint }
  | { type: "select_persona"; persona: Persona }
  | { type: "advance_from_intro" }
  | { type: "back" }
  | { type: "advance_to_recap"; stats: DemoStats };

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

    case "back":
      if (state.screen === "pain")              return { ...state, screen: "welcome" };
      if (state.screen === "persona")           return { ...state, screen: "pain" };
      if (state.screen === "simulation_intro")  return { ...state, screen: "persona" };
      if (state.screen === "demo_group")        return { ...state, screen: "simulation_intro" };
      if (state.screen === "recap")             return { ...state, screen: "demo_group" };
      return state;

    default:
      return state;
  }
}

// Progress dots — 5 total. Intro + demo_group share dot 4.
export const TOTAL_STEPS = 5;
export const PROGRESS_STEPS: Record<ScreenId, number> = {
  welcome:          1,
  pain:             2,
  persona:          3,
  simulation_intro: 4,
  demo_group:       4,
  recap:            5,
};
