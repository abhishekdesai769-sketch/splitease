// Who gets the full app. Single switch for every former Premium gate
// (AI receipt scan, AI Mode, recurring expenses, currency conversion).
//
// Sept 2026: there is no in-app upsell any more — everyone signed in gets
// everything, and cost-heavy AI features stay bounded by their daily quotas
// and kill switches (server/aiQuota.ts, voiceQuota.ts, quickAddAi.ts, the
// per-IP scan limiter). The planned onboarding paywall will decide access
// at sign-up; when it ships, this is the one place to change.
export const EVERYONE_HAS_FULL_ACCESS = true;

export function hasFullAccess(user: { isPremium?: boolean | null } | null | undefined): boolean {
  if (!user) return false;
  return EVERYONE_HAS_FULL_ACCESS || !!user.isPremium;
}
