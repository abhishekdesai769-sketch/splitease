/**
 * Screen 09 · Payment — shown only when the user started a trial.
 *
 * Platform-aware:
 *   iOS     → Apple Pay / StoreKit. In the real native app this calls the
 *             real purchasePremium() IAP. In the web preview (where native
 *             IAP physically cannot run) it shows a simulated Apple Pay sheet.
 *   Android → Google Play forbids in-app subscriptions. Redirect the user to
 *   / Web     spliiit.klarityit.ca to complete Stripe checkout in the browser.
 *
 * PREVIEW NOTE: the Android/Web "Open secure checkout" button is a REAL
 * browser navigation to spliiit.klarityit.ca. A small preview-only escape
 * hatch lets you keep walking the flow without leaving.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Globe, ShieldCheck, Check } from "lucide-react";
import type { PlatformView } from "../state";
import { PREMIUM_PRICE } from "../fixtures";
import { isIosNative, purchasePremium } from "@/lib/iap";
import { track } from "@/lib/analytics";

interface Props {
  platform: PlatformView;
  onPaid: () => void;
}

const CHECKOUT_URL = "https://spliiit.klarityit.ca/#/upgrade";

export function PaymentScreen({ platform, onPaid }: Props) {
  const [processing, setProcessing] = useState(false);

  // iOS Apple Pay. Real IAP when running inside the native app; a simulated
  // sheet on web (the preview), since StoreKit cannot run in a browser.
  const handleApplePay = async () => {
    setProcessing(true);
    track("payment_apple_pay_tapped");
    if (isIosNative) {
      const result = await purchasePremium("monthly");
      setProcessing(false);
      if (result.success || result.isPremium) {
        track("payment_apple_pay_success");
        onPaid();
      } else if (result.cancelled) {
        track("payment_apple_pay_cancelled");
      } else {
        track("payment_apple_pay_failed", { error: result.error });
      }
      return;
    }
    // Web preview — simulate the StoreKit round-trip.
    setTimeout(() => {
      setProcessing(false);
      track("payment_apple_pay_simulated");
      onPaid();
    }, 1200);
  };

  // Android / Web → real redirect to Stripe checkout on the web.
  const handleWebCheckout = () => {
    track("payment_web_checkout_redirect", { platform });
    window.location.href = CHECKOUT_URL;
  };

  // ── iOS variant ──────────────────────────────────────
  if (platform === "ios") {
    return (
      <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
        <div className="flex-1 flex flex-col justify-center space-y-5">
          <div className="text-center space-y-1.5">
            <h2 className="text-2xl font-semibold tracking-tight">
              Confirm your free month
            </h2>
            <p className="text-sm text-muted-foreground">
              {PREMIUM_PRICE.trialDays} days free, then {PREMIUM_PRICE.monthly}/month.
              Cancel anytime in Settings.
            </p>
          </div>

          {/* Simulated Apple Pay sheet */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="text-sm font-semibold"> Pay</span>
              <span className="text-xs text-muted-foreground">Spliiit</span>
            </div>
            <div className="px-4 py-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Spliiit Premium</span>
                <span className="font-medium">30-day free trial</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Then</span>
                <span className="font-medium">{PREMIUM_PRICE.monthly}/month</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                Billed through your Apple ID
              </div>
            </div>
            <div className="px-4 pb-4">
              <Button
                size="lg"
                className="w-full bg-foreground text-background hover:bg-foreground/90"
                onClick={handleApplePay}
                disabled={processing}
                data-testid="payment-apple-pay"
              >
                {processing ? (
                  <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Confirming…</>
                ) : (
                  <>Pay with  Face ID</>
                )}
              </Button>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground text-center">
            Preview: on a real iPhone this is the actual Apple Pay sheet. Here
            it's simulated — no charge.
          </p>
        </div>
      </div>
    );
  }

  // ── Android / Web variant ────────────────────────────
  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
      <div className="flex-1 flex flex-col justify-center space-y-5">
        <div className="text-center space-y-1.5">
          <h2 className="text-2xl font-semibold tracking-tight">
            Finish on the web
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
            {platform === "android"
              ? "Google Play doesn't allow in-app subscriptions. "
              : ""}
            We'll take you to <span className="font-semibold text-foreground">spliiit.klarityit.ca</span>{" "}
            for secure checkout. Premium unlocks automatically the moment you're done.
          </p>
        </div>

        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-2.5">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Spliiit Premium</span>
            <span className="font-medium">{PREMIUM_PRICE.trialDays} days free</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Then</span>
            <span className="font-medium">{PREMIUM_PRICE.monthly}/month</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
            <ShieldCheck className="w-3.5 h-3.5" />
            Secure Stripe checkout · cancel anytime
          </div>
        </div>

        <Button
          size="lg"
          className="w-full"
          onClick={handleWebCheckout}
          data-testid="payment-web-checkout"
        >
          <Globe className="w-4 h-4 mr-1.5" />
          Open secure checkout
        </Button>

        {/* Preview-only escape hatch — keep walking the flow without leaving */}
        <button
          type="button"
          onClick={() => {
            track("payment_web_preview_skipped");
            onPaid();
          }}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1 py-1"
          data-testid="payment-web-preview-skip"
        >
          <Check className="w-3 h-3" />
          Continue in preview (skip checkout)
        </button>
      </div>
    </div>
  );
}
