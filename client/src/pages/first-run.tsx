/**
 * First-run wizard — shown once after onboarding-preferences, before the dashboard.
 *
 * The goal: get a brand-new user past the empty-app moment by guiding them to
 *   1. Create their first group (single-input, ~10s)
 *   2. Share the invite link with whoever they actually split bills with (native share sheet)
 *
 * Why this matters: PostHog funnel shows 88% drop from activation → return. Users
 * who complete onboarding land on an empty dashboard with no reason to act. This
 * wizard converts "completed onboarding" into "has a real social loop running."
 *
 * Skip behavior: every step has a soft skip link. Skipping still marks
 * firstRunCompletedAt so we don't trap users — but we lose the activation event.
 *
 * Gating: App.tsx checks `!user.firstRunCompletedAt` AFTER `!user.defaultCurrency`,
 * so this only fires for users who finished currency picking but haven't been
 * through the wizard yet. Existing users are backfilled on startup migration.
 */

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { track } from "@/lib/analytics";
import { shareInviteLink } from "@/lib/share";
import { UsersRound, Share2, Sparkles, ArrowRight, Check } from "lucide-react";

// ──────────────────────────────────────────────────────
// Logo (matches auth.tsx / onboarding.tsx / Layout.tsx)
// ──────────────────────────────────────────────────────
function Logo() {
  return (
    <div className="flex items-center justify-center gap-2.5">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-label="Spliiit logo">
        <rect width="32" height="32" rx="8" fill="hsl(172 63% 45%)" fillOpacity="0.15" />
        <path d="M9 11h14M9 16h14M9 21h14" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" />
        <path d="M16 8v16" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="text-xl font-semibold tracking-tight text-foreground">
        Spl<span className="text-primary">iii</span>t
      </span>
    </div>
  );
}

// Step indicator dots — visual progress feedback so users know how many steps are left
function StepDots({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      <span className={`h-1.5 w-6 rounded-full transition-colors ${step >= 1 ? "bg-primary" : "bg-border"}`} />
      <span className={`h-1.5 w-6 rounded-full transition-colors ${step >= 2 ? "bg-primary" : "bg-border"}`} />
    </div>
  );
}

// ──────────────────────────────────────────────────────
// First-run wizard
// ──────────────────────────────────────────────────────
export default function FirstRunWizard() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();

  const [step, setStep] = useState<1 | 2>(1);
  const [groupName, setGroupName] = useState("");
  const [createdGroupId, setCreatedGroupId] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Fire "wizard started" once on mount. Wrapped in useState's lazy init so it
  // only runs on the first render — we don't have a useEffect-on-mount-only need
  // beyond this single event so this saves an import.
  useState(() => {
    track("first_run_started");
    return null;
  });

  // ── Step 1: create the group ────────────────────────────────────────────
  const handleCreateGroup = async () => {
    if (!groupName.trim()) return;
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/groups", {
        name: groupName.trim(),
        memberIds: [], // creator is added automatically server-side
      });
      const group = await res.json();
      setCreatedGroupId(group.id);

      // Generate the invite link inline so step 2 is instant
      const linkRes = await apiRequest("POST", `/api/groups/${group.id}/invite-link`, {});
      const link = await linkRes.json();
      setInviteCode(link.code);

      // Invalidate groups query so the new group appears when we land on dashboard
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });

      track("group_created", { name: groupName.trim(), source: "first_run" });
      track("first_run_step_completed", { step: "group" });

      setStep(2);
    } catch (err: any) {
      toast({
        title: "Couldn't create group",
        description: err?.message || "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: share the invite link ───────────────────────────────────────
  const handleShare = async () => {
    if (!inviteCode) return;
    const url = `${window.location.origin}/#/invite/${inviteCode}`;
    const result = await shareInviteLink({
      groupName: groupName.trim(),
      inviterName: user?.name ?? "A friend",
      url,
    });

    if (result.method === "cancelled") return; // user backed out of native sheet — no event
    if (result.method === "error") {
      toast({ title: "Share failed", description: "Try copying the link instead.", variant: "destructive" });
      return;
    }

    track("first_invite_sent", { method: result.method, source: "first_run" });

    if (result.method === "clipboard") {
      toast({ title: "Link copied — paste it anywhere" });
    }
  };

  // ── Finalize: mark wizard complete and let App.tsx route to dashboard ──
  const markCompleted = async (skipped: boolean) => {
    setLoading(true);
    try {
      await apiRequest("POST", "/api/user/first-run", {});
      track(skipped ? "first_run_skipped" : "first_run_completed", { atStep: step });
      await refreshUser(); // App.tsx gate re-evaluates → drops user on dashboard
    } catch (err: any) {
      toast({
        title: "Couldn't save",
        description: err?.message || "Try again in a moment.",
        variant: "destructive",
      });
      setLoading(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <Logo />
          <StepDots step={step} />
        </div>

        {step === 1 ? (
          // ────────────────────────────────
          // Step 1 — Create your first group
          // ────────────────────────────────
          <Card className="p-6 space-y-5">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mx-auto">
              <UsersRound className="w-7 h-7 text-primary" />
            </div>

            <div className="text-center space-y-1.5">
              <h1 className="text-lg font-semibold text-foreground">What are you splitting?</h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Give it a quick name — a trip, your apartment, a recurring brunch crew. You can rename it later.
              </p>
            </div>

            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                handleCreateGroup();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="first-run-group-name" className="sr-only">
                  Group name
                </Label>
                <Input
                  id="first-run-group-name"
                  placeholder="e.g. Goa trip, Roommates, Bali 2026"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  autoFocus
                  data-testid="first-run-group-name"
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={!groupName.trim() || loading}
                data-testid="first-run-create-group"
              >
                {loading ? "Creating…" : (
                  <>
                    Continue
                    <ArrowRight className="w-4 h-4 ml-1.5" />
                  </>
                )}
              </Button>
            </form>

            <button
              type="button"
              onClick={() => markCompleted(true)}
              disabled={loading}
              className="block mx-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid="first-run-skip-step-1"
            >
              Skip for now
            </button>
          </Card>
        ) : (
          // ────────────────────────────────
          // Step 2 — Invite people
          // ────────────────────────────────
          <Card className="p-6 space-y-5">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mx-auto">
              <Sparkles className="w-7 h-7 text-primary" />
            </div>

            <div className="text-center space-y-1.5">
              <h1 className="text-lg font-semibold text-foreground">
                Nice. "{groupName.trim()}" is live.
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Now invite whoever you split bills with. They get a link — tap, sign up, done. We'll ping you the second they join.
              </p>
            </div>

            <Button
              type="button"
              className="w-full"
              size="lg"
              onClick={handleShare}
              data-testid="first-run-share-invite"
            >
              <Share2 className="w-4 h-4 mr-1.5" />
              Share invite link
            </Button>

            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <Check className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
              <span>Link works for 7 days. You can generate a new one anytime from the group page.</span>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => markCompleted(false)}
              disabled={loading}
              data-testid="first-run-done"
            >
              {loading ? "Loading dashboard…" : "I'll invite them later"}
            </Button>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground px-4">
          {step === 1
            ? "Spliiit only clicks once you have someone to split with — let's set that up."
            : "Heads up: an empty group can't show balances. Inviting at least one person is what unlocks the magic."}
        </p>
      </div>
    </div>
  );
}
