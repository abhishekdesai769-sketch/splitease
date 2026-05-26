/**
 * PushPermissionPrompt — contextual notification-permission UI.
 *
 * Replaces the old "cold ask" (iOS permission alert fired the instant a user
 * logged in, with zero context → high decline rate, and a decline is
 * permanent). Two states:
 *
 *   status "prompt"  → a pre-permission CARD that explains the value first.
 *                      Only when the user taps "Turn on" do we fire the real
 *                      iOS alert. Far fewer declines; "Not now" doesn't burn
 *                      the one-shot iOS prompt.
 *   status "denied"  → a recovery BANNER. iOS won't let the app re-prompt a
 *                      declined user, so this deep-links them to Settings.
 *
 * iOS-native only — getPushPermissionStatus() returns "unsupported" on
 * web / Android, so this renders nothing there. Mounted inside Layout, so it
 * only ever appears for a logged-in user inside the app.
 */
import { useState, useEffect } from "react";
import { Bell, BellOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getPushPermissionStatus,
  requestPushPermission,
  type PushPermissionStatus,
} from "@/lib/push";
import { track } from "@/lib/analytics";

// Cooldowns so a dismissed prompt isn't shown every single app open.
const PROMPT_KEY = "spliiit_push_prompt_dismissed_at";
const PROMPT_COOLDOWN_DAYS = 4;
const RECOVERY_KEY = "spliiit_push_recovery_dismissed_at";
const RECOVERY_COOLDOWN_DAYS = 7;

function inCooldown(key: string, days: number): boolean {
  try {
    const at = localStorage.getItem(key);
    if (!at) return false;
    return (Date.now() - new Date(at).getTime()) / 86_400_000 < days;
  } catch {
    return false;
  }
}
function setCooldown(key: string) {
  try { localStorage.setItem(key, new Date().toISOString()); } catch { /* storage off */ }
}

export function PushPermissionPrompt() {
  const [status, setStatus] = useState<PushPermissionStatus | null>(null);
  const [hidden, setHidden] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    getPushPermissionStatus().then(setStatus);
  }, []);

  if (hidden || !status) return null;
  if (status === "granted" || status === "unsupported") return null;

  // ── Pre-permission card — the user has never been asked ──
  if (status === "prompt") {
    if (inCooldown(PROMPT_KEY, PROMPT_COOLDOWN_DAYS)) return null;

    const enable = async () => {
      setWorking(true);
      track("push_pre_prompt_accepted");
      const result = await requestPushPermission();
      setWorking(false);
      // Whatever the user picked at the real iOS alert, we're done nagging
      // for now — granted hides it; denied/prompt backs off via cooldown.
      if (result !== "granted") {
        track("push_ios_prompt_declined");
        setCooldown(PROMPT_KEY);
      } else {
        track("push_ios_prompt_granted");
      }
      setHidden(true);
    };
    const notNow = () => {
      track("push_pre_prompt_dismissed");
      setCooldown(PROMPT_KEY);
      setHidden(true);
    };

    return (
      <PromptCard
        icon={<Bell className="w-4 h-4 text-primary" />}
        title="Stay in the loop"
        body="Get a heads-up the moment a friend adds an expense, settles up, or joins one of your groups."
        primaryLabel={working ? "Turning on…" : "Turn on notifications"}
        primaryDisabled={working}
        onPrimary={enable}
        dismissLabel="Not now"
        onDismiss={notNow}
        testId="push-pre-prompt"
      />
    );
  }

  // ── Recovery banner — the user previously declined ──
  if (inCooldown(RECOVERY_KEY, RECOVERY_COOLDOWN_DAYS)) return null;

  const openSettings = () => {
    track("push_recovery_open_settings");
    // Opens the Settings app at Spliiit's own page on iOS.
    try { window.open("app-settings:", "_system"); } catch { /* no-op */ }
  };
  const dismissRecovery = () => {
    track("push_recovery_dismissed");
    setCooldown(RECOVERY_KEY);
    setHidden(true);
  };

  return (
    <PromptCard
      icon={<BellOff className="w-4 h-4 text-primary" />}
      title="Notifications are off"
      body="You won't hear when friends add expenses or settle up. Turn them back on under Settings → Notifications → Spliiit."
      primaryLabel="Open Settings"
      onPrimary={openSettings}
      dismissLabel="Dismiss"
      onDismiss={dismissRecovery}
      testId="push-recovery-banner"
    />
  );
}

// ──────────────────────────────────────────────────────
// Shared card — fixed above the bottom nav, dismissible
// ──────────────────────────────────────────────────────
interface PromptCardProps {
  icon: React.ReactNode;
  title: string;
  body: string;
  primaryLabel: string;
  primaryDisabled?: boolean;
  onPrimary: () => void;
  dismissLabel: string;
  onDismiss: () => void;
  testId: string;
}

// bottom-[calc(6rem+env(safe-area-inset-bottom))] keeps the card above the
// 64px bottom nav. The nav also pads itself by env(safe-area-inset-bottom),
// so the card has to budget for that same inset — otherwise on iPhones
// with a home indicator, the prompt sits inside the nav zone.
function PromptCard({
  icon, title, body, primaryLabel, primaryDisabled, onPrimary, dismissLabel, onDismiss, testId,
}: PromptCardProps) {
  return (
    <div className="fixed left-0 right-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-40 px-4 pointer-events-none">
      <div
        className="max-w-md mx-auto bg-card border border-border rounded-2xl shadow-lg p-4 pointer-events-auto"
        data-testid={testId}
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">{title}</div>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{body}</p>
          </div>
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            className="p-1 -m-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-2 mt-3">
          <Button size="sm" className="flex-1" onClick={onPrimary} disabled={primaryDisabled}>
            {primaryLabel}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            {dismissLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
