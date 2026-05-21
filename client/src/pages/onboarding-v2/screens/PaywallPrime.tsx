/**
 * Screen 07 · Paywall prime — the persona-mapped Premium pitch.
 *
 * Three layers:
 *   1. Persona pitch  — headline + subhead from PAYWALL_PRIME_BY_PERSONA
 *   2. Feel demo      — a mini-demo of the primed feature:
 *                         roommate → RecurringMiniDemo
 *                         couple   → AutoRemindersMiniDemo
 *                         trip     → an "you just did this" AI Scanner recap
 *   3. Trial CTA      — "Start my free month" for every platform. The
 *                       platform only changes the footnote here; the real
 *                       payment difference (iOS Apple Pay vs web Stripe
 *                       redirect) happens later on the Payment screen.
 *
 * A dev-only "Preview as" toggle lets you see the per-platform footnote on
 * one device and carries the chosen platform forward to the Payment screen.
 * It will be removed when v2 becomes the real onboarding.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Sparkles, Crown } from "lucide-react";
import type { Persona } from "../fixtures";
import { PAYWALL_PRIME_BY_PERSONA, PREMIUM_PRICE } from "../fixtures";
import { RecurringMiniDemo } from "../components/RecurringMiniDemo";
import { AutoRemindersMiniDemo } from "../components/AutoRemindersMiniDemo";
import type { PlatformView } from "../state";
import { isInTWA } from "@/lib/platform";
import { isIosNative } from "@/lib/iap";
import { track } from "@/lib/analytics";

interface Props {
  persona: Persona;
  /** advance to signup; trialStarted true if they chose to start the trial */
  onChoose: (trialStarted: boolean, platform: PlatformView) => void;
}

function detectPlatform(): PlatformView {
  if (isIosNative) return "ios";
  if (isInTWA) return "android";
  return "web";
}

const PLATFORM_FOOTNOTE: Record<PlatformView, string> = {
  ios: "Billed through your Apple ID. Cancel anytime in Settings.",
  android: "Checkout completes at spliiit.klarityit.ca. Cancel anytime.",
  web: "Secure Stripe checkout. Cancel anytime.",
};

export function PaywallPrime({ persona, onChoose }: Props) {
  const prime = PAYWALL_PRIME_BY_PERSONA[persona];
  const [platform, setPlatform] = useState<PlatformView>(detectPlatform);

  useState(() => {
    track("paywall_prime_viewed", { persona, feature: prime.feature });
    return null;
  });

  const startTrial = () => {
    track("paywall_prime_trial_started", { persona, platform });
    onChoose(true, platform);
  };
  const maybeLater = () => {
    track("paywall_prime_dismissed", { persona });
    onChoose(false, platform);
  };

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full overflow-y-auto -mx-1 px-1">
      {/* ── 1. Persona pitch ──────────────────────────────── */}
      <div className="text-center space-y-2 pt-1 pb-4">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-[10px] uppercase tracking-wider font-mono font-semibold">
          <Crown className="w-3 h-3" />
          {prime.featureLabel} · Premium
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">{prime.headline}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{prime.subhead}</p>
      </div>

      {/* ── 2. Feel demo (persona-specific) ───────────────── */}
      <div className="mb-5">
        {prime.feature === "recurring" && <RecurringMiniDemo />}
        {prime.feature === "auto_reminders" && <AutoRemindersMiniDemo />}
        {prime.feature === "ai_scanner" && (
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
              <Check className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">You just did this.</div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                That 8-item dinner you just scanned and split? AI Receipt Scanner.
                It works on any bill, any size — that's the Premium feature.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── 3. Trial CTA ──────────────────────────────────── */}
      {/* Dev-only preview toggle — remove at cutover */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
          Preview as
        </span>
        <div className="flex rounded-lg border border-dashed border-border overflow-hidden text-[11px] font-medium">
          {(["ios", "android", "web"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPlatform(p)}
              className={`px-2.5 py-1 transition-colors ${
                platform === p
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/40"
              }`}
            >
              {p === "ios" ? "iOS" : p === "android" ? "Android" : "Web"}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Crown className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">
            {PREMIUM_PRICE.trialDays} days free, then {PREMIUM_PRICE.monthly}/month
          </span>
        </div>
        <ul className="space-y-1.5">
          {[
            "AI Receipt Scanner on every bill",
            "Recurring expenses — set once",
            "Auto-Reminders in your chosen tone",
            "Multi-currency auto-convert",
          ].map((perk) => (
            <li key={perk} className="flex items-center gap-2 text-xs text-foreground">
              <Check className="w-3.5 h-3.5 text-primary shrink-0" />
              {perk}
            </li>
          ))}
        </ul>
        <Button
          size="lg"
          className="w-full"
          onClick={startTrial}
          data-testid="paywall-start-trial"
        >
          <Sparkles className="w-4 h-4 mr-1.5" />
          Start my free month
        </Button>
        <p className="text-[11px] text-muted-foreground text-center">
          {PLATFORM_FOOTNOTE[platform]}
          {"  ·  "}
          {PREMIUM_PRICE.yearly}/year option available.
        </p>
      </div>

      <button
        type="button"
        onClick={maybeLater}
        className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-3 mt-1"
        data-testid="paywall-maybe-later"
      >
        Maybe later — keep the free plan
      </button>
    </div>
  );
}
