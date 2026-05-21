/**
 * Screen 08 · Signup — a plain account-creation step.
 *
 * No "save your demo group" framing. The demo was purely a teaching tool —
 * nothing in it is saved. This is just the normal "create your Spliiit
 * account" step, asked after the user has seen the value.
 *
 * PREVIEW NOTE: the email field is real (typeable) but "Continue" does NOT
 * create an account — it just advances. Real OTP signup is wired at cutover.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck } from "lucide-react";
import { track } from "@/lib/analytics";

interface Props {
  trialStarted: boolean;
  onContinue: () => void;
}

export function SignupScreen({ trialStarted, onContinue }: Props) {
  const [email, setEmail] = useState("");
  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailLooksValid) return;
    track("signup_submitted", { trial_started: trialStarted });
    onContinue();
  };

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
      <div className="flex-1 flex flex-col justify-center space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">
            Create your Spliiit account
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
            {trialStarted
              ? "One quick step before checkout — then your free month is yours."
              : "One quick step — then Spliiit is yours, free forever for the basics."}
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
            Continue
          </Button>
        </form>

        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <span>
            We'll email you a 6-digit code — no password to remember.
            <span className="block opacity-70 mt-0.5">
              Preview: this is a mockup, no email is actually sent.
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
