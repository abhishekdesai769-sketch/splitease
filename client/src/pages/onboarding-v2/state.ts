/**
 * Onboarding v2 state — single source of truth for the flow.
 *
 * Lives entirely in the OnboardingV2 component via useReducer. No global store.
 *
 * Flow:
 *   welcome → pain → persona → simulation_intro → demo_group
 *     → recap → paywall_prime → signup
 *       → (trial) payment → create_group → done
 *       → (no trial)        create_group → done
 *
 * The demo is purely a teaching tool — nothing the user does in the demo
 * group is saved. After signup they create their REAL first group on the
 * create_group screen, exactly like the real first-run.
 *
 * Still preview-only — no real DB writes; payment is functional where it can
 * be (web/Android redirect to spliiit.klarityit.ca; iOS real IAP in the
 * native app, simulated on web).
 */
import type { Persona, PainPoint } from "./fixtures";

export type ScreenId =
  | "welcome"
  | "pain"
  | "persona"
  | "simulation_intro"
  | "demo_group"
  | "recap"
  | "paywall_prime"
  | "signup"
  | "payment"        // only when the user started a trial
  | "create_group"   // "what are you splitting" — their REAL first group
  | "done";

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
  trialStarted: boolean;            // did they tap "Start my free month"
  platform: PlatformView;           // chosen on the paywall, drives payment UI
  createdGroupName: string | null;  // their real first group, from create_group
}

export const INITIAL_STATE: OnboardingState = {
  screen: "welcome",
  pain: null,
  persona: null,
  demoStats: null,
  trialStarted: false,
  platform: "web",
  createdGroupName: null,
};

export type OnboardingAction =
  | { type: "advance_from_welcome" }
  | { type: "select_pain"; pain: PainPoint }
  | { type: "select_persona"; persona: Persona }
  | { type: "advance_from_intro" }
  | { type: "back" }
  | { type: "advance_to_recap"; stats: DemoStats }
  | { type: "advance_to_paywall" }
  | { type: "advance_to_signup"; trialStarted: boolean; platform: PlatformView }
  | { type: "advance_from_signup" }
  | { type: "advance_from_payment" }
  | { type: "create_group_done"; groupName: string };

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
      return {
        ...state,
        screen: "signup",
        trialStarted: action.trialStarted,
        platform: action.platform,
      };

    case "advance_from_signup":
      // Trial users pay next; everyone else goes straight to their first group.
      return { ...state, screen: state.trialStarted ? "payment" : "create_group" };

    case "advance_from_payment":
      return { ...state, screen: "create_group" };

    case "create_group_done":
      return { ...state, screen: "done", createdGroupName: action.groupName };

    case "back":
      if (state.screen === "pain")              return { ...state, screen: "welcome" };
      if (state.screen === "persona")           return { ...state, screen: "pain" };
      if (state.screen === "simulation_intro")  return { ...state, screen: "persona" };
      if (state.screen === "demo_group")        return { ...state, screen: "simulation_intro" };
      if (state.screen === "recap")             return { ...state, screen: "demo_group" };
      if (state.screen === "paywall_prime")     return { ...state, screen: "recap" };
      if (state.screen === "signup")            return { ...state, screen: "paywall_prime" };
      if (state.screen === "payment")           return { ...state, screen: "signup" };
      if (state.screen === "create_group")      return { ...state, screen: "signup" };
      return state;

    default:
      return state;
  }
}

// Progress dots — 7 total. Screens that pair up share a dot.
export const TOTAL_STEPS = 7;
export const PROGRESS_STEPS: Record<ScreenId, number> = {
  welcome:          1,
  pain:             2,
  persona:          3,
  simulation_intro: 4,
  demo_group:       4,
  recap:            5,
  paywall_prime:    5,
  signup:           6,
  payment:          6,
  create_group:     7,
  done:             7,
};
