/**
 * Screen 07 · Delayed signup — "save your experience".
 *
 * Signup is asked LAST, after the user has felt the value (magic moment +
 * recap + paywall). The framing is loss-aversion: create an account so the
 * demo group they just built doesn't disappear.
 *
 * PREVIEW NOTE: this is a UI mockup. The email field is real (typeable) but
 * "Create my account" does NOT create anything — it just advances. Real OTP
 * signup is wired at cutover, when v2 becomes the live onboarding.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck } from "lucide-react";
import { track } from "@/lib/analytics";

interface Props {
  groupName: string;
  expenseCount: number;
  trialStarted: boolean;
  onSignup: () => void;
  onSkip: () => void;
}

export function SignupScreen({ groupName, expenseCount, trialStarted, onSignup, onSkip }: Props) {
  const [email, setEmail] = useState("");
  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailLooksValid) return;
    track("signup_submitted", { trial_started: trialStarted });
    onSignup();
  };

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
      <div className="flex-1 flex flex-col justify-center space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">
            Save everything you just did.
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
            Create your account and{" "}
            <span className="font-semibold text-foreground">{groupName}</span> — with
            all {expenseCount} expenses — is right there when you open Spliiit.
            {trialStarted && " Your free month is attached to it."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="onboarding-v2-email">Email</Label>
            <Input
              id="onboarding-v2-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="onboarding-v2-signup-email"
            />
          </div>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={!emailLooksValid}
            data-testid="onboarding-v2-signup-submit"
          >
            Create my account
          </Button>
        </form>

        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <span>
            We'll email you a 6-digit code to confirm — no password to remember.
            <span className="block opacity-70 mt-0.5">
              Preview: this is a mockup, no email is actually sent.
            </span>
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          track("signup_skipped");
          onSkip();
        }}
        className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-3"
        data-testid="onboarding-v2-signup-skip"
      >
        Skip for now
      </button>
    </div>
  );
}
