/**
 * Screen 11 · Done — end of onboarding v2.
 *
 * No demo-group claims. The user just created their REAL first group on the
 * previous screen — this screen congratulates them on THAT and hands off to
 * the app.
 *
 * PREVIEW NOTE: "Open Spliiit" exits the preview route. At cutover this is
 * the real hand-off into the app.
 */
import { Button } from "@/components/ui/button";
import { Check, Crown, Sparkles } from "lucide-react";
import { track } from "@/lib/analytics";
import { useState } from "react";

interface Props {
  groupName: string | null;
  trialStarted: boolean;
  onFinish: () => void;
}

export function DoneScreen({ groupName, trialStarted, onFinish }: Props) {
  useState(() => {
    track("onboarding_v2_completed", { trial_started: trialStarted });
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
          <h1 className="text-3xl font-semibold tracking-tight">You're all set.</h1>
          <p className="text-base text-muted-foreground leading-relaxed max-w-sm mx-auto">
            <span className="font-semibold text-foreground">
              {groupName ?? "Your group"}
            </span>{" "}
            is ready. Add your first expense and invite the crew — splitting
            stays free forever.
            {trialStarted &&
              " Your 30-day Premium trial is live, so AI Scanner, Recurring, and Auto-Reminders are all unlocked."}
          </p>
        </div>

        {/* What's next card */}
        <div className="w-full rounded-2xl border border-border bg-card p-4 text-left space-y-2.5">
          <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
            Your next moves
          </div>
          {[
            "Add a real expense to " + (groupName ?? "your group"),
            "Invite the people you split with",
            trialStarted
              ? "Scan a real receipt with AI"
              : "Explore — splitting is free forever",
          ].map((item) => (
            <div key={item} className="flex items-center gap-2 text-sm">
              <Check className="w-4 h-4 text-primary shrink-0" />
              {item}
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
