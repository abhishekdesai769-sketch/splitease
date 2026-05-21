/**
 * Screen 08 · Done — success / welcome screen, end of onboarding v2.
 *
 * Tailors its message to what the user chose:
 *   - signed up + started trial → "you're in, Premium trial is live"
 *   - signed up, no trial       → "you're in, free plan"
 *   - skipped signup            → soft nudge to come back
 *
 * PREVIEW NOTE: "Open Spliiit" exits the preview route. At cutover this
 * becomes the real hand-off into the app.
 */
import { Button } from "@/components/ui/button";
import { Check, Crown, Sparkles } from "lucide-react";
import { track } from "@/lib/analytics";
import { useState } from "react";

interface Props {
  groupName: string;
  expenseCount: number;
  trialStarted: boolean;
  signedUp: boolean;
  onFinish: () => void;
}

export function DoneScreen({ groupName, expenseCount, trialStarted, signedUp, onFinish }: Props) {
  useState(() => {
    track("onboarding_v2_completed", { signed_up: signedUp, trial_started: trialStarted });
    return null;
  });

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full text-center">
      <div className="flex-1 flex flex-col justify-center items-center space-y-6">
        <div className="w-20 h-20 rounded-3xl bg-primary/15 flex items-center justify-center">
          {trialStarted ? (
            <Crown className="w-9 h-9 text-primary" />
          ) : (
            <Check className="w-10 h-10 text-primary" />
          )}
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            {signedUp ? "You're all set." : "Come back any time."}
          </h1>
          <p className="text-base text-muted-foreground leading-relaxed max-w-sm mx-auto">
            {signedUp ? (
              <>
                <span className="font-semibold text-foreground">{groupName}</span> and
                its {expenseCount} expenses are saved to your account.
                {trialStarted
                  ? " Your 30-day Premium trial is live — AI Scanner, Recurring, and Auto-Reminders are all unlocked."
                  : " You're on the free plan — unlimited groups, friends, and splits, always."}
              </>
            ) : (
              <>
                No account yet — that's fine. When you're ready, sign up and
                everything you just tried will be one tap away.
              </>
            )}
          </p>
        </div>

        {/* What you get card */}
        <div className="w-full rounded-2xl border border-border bg-card p-4 text-left space-y-2.5">
          <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
            {trialStarted ? "Unlocked for 30 days" : "Free, forever"}
          </div>
          {(trialStarted
            ? [
                "AI Receipt Scanner on every bill",
                "Recurring expenses — set once",
                "Auto-Reminders, your tone",
                "Unlimited groups & friends",
              ]
            : [
                "Unlimited groups & friends",
                "Split equally or custom",
                "Track who owes who",
                "Attach receipts, shared by email",
              ]
          ).map((perk) => (
            <div key={perk} className="flex items-center gap-2 text-sm">
              <Check className="w-4 h-4 text-primary shrink-0" />
              {perk}
            </div>
          ))}
        </div>
      </div>

      <Button
        size="lg"
        className="w-full shadow-sm"
        onClick={onFinish}
        data-testid="onboarding-v2-done-cta"
      >
        <Sparkles className="w-4 h-4 mr-1.5" />
        Open Spliiit
      </Button>
    </div>
  );
}
