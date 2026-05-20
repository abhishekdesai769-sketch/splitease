/**
 * Onboarding v2 state — single source of truth for the flow.
 *
 * Lives entirely in the OnboardingV2 component via useReducer. No global store,
 * no localStorage during Wave 1 (we persist at signup time in Wave 2 instead).
 *
 * The reducer enforces the screen order so back/forward feels predictable, but
 * it stays trivially small — no XState, no Zustand. If the flow grows past 12
 * screens, swap to XState; today this is enough.
 */
import type { Persona, PainPoint } from "./fixtures";

export type ScreenId =
  | "welcome"
  | "pain"
  | "persona"
  | "demo_group"      // wired in Commit 2 — placeholder for now
  | "paywall_prime"   // Wave 2
  | "signup"          // Wave 2
  | "done";

export interface OnboardingState {
  screen: ScreenId;
  pain: PainPoint | null;
  persona: Persona | null;
  // Used by demo group (Commit 2) — set when the user adds their manual
  // expense and again when they finish the AI Scanner run.
  demoManualExpenseAdded: boolean;
  demoAiScannerCompleted: boolean;
}

export const INITIAL_STATE: OnboardingState = {
  screen: "welcome",
  pain: null,
  persona: null,
  demoManualExpenseAdded: false,
  demoAiScannerCompleted: false,
};

export type OnboardingAction =
  | { type: "advance_from_welcome" }
  | { type: "select_pain"; pain: PainPoint }
  | { type: "select_persona"; persona: Persona }
  | { type: "back" }
  | { type: "demo_manual_expense_added" }
  | { type: "demo_ai_scanner_completed" }
  | { type: "advance_to_paywall_prime" };

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
      return { ...state, persona: action.persona, screen: "demo_group" };

    case "back":
      if (state.screen === "pain")        return { ...state, screen: "welcome" };
      if (state.screen === "persona")     return { ...state, screen: "pain" };
      if (state.screen === "demo_group")  return { ...state, screen: "persona" };
      return state;

    case "demo_manual_expense_added":
      return { ...state, demoManualExpenseAdded: true };

    case "demo_ai_scanner_completed":
      return { ...state, demoAiScannerCompleted: true };

    case "advance_to_paywall_prime":
      return { ...state, screen: "paywall_prime" };

    default:
      return state;
  }
}

// Progress dots — 5 total. Each screen reports its position.
// Demo group "completes" the magic action and is the 5th filled dot.
export const PROGRESS_STEPS: Record<ScreenId, number> = {
  welcome:        1,
  pain:           2,
  persona:        3,
  demo_group:     4,
  paywall_prime:  5,
  signup:         5,
  done:           5,
};
