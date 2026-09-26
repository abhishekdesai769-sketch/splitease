/**
 * ReviewPromptSheet — mandatory 5-star rating gate
 *
 * Shown on EVERY open of the installed app (cold launch + every return to
 * the foreground) until the user completes it. No X, no "Maybe later", no
 * tap-outside / Escape dismiss. See lib/reviewPrompt.ts for the done state.
 *
 *   4-5 stars  → "Thank you" → only button sends them to the App Store /
 *                Play Store write-review page. Tapping it = done.
 *
 *   1-3 stars  → in-app feedback form → /api/feedback (emailed to support).
 *                Sending it = done. They are not sent to the store.
 *
 * Stars stay tappable on every step so a mis-tap can be corrected.
 * Only shown once the user is logged in and past the first-run wizard.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Star, Loader2, Heart } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  shouldShowReview,
  markRated,
  getStorePlatform,
  getStoreLink,
} from "@/lib/reviewPrompt";
import { track } from "@/lib/analytics";

type SheetStep = "rate" | "thanks" | "feedback" | "feedback-sent";
type OpenReason = "launch" | "resume";

// Let the first screen paint before the gate slides up.
const SHOW_DELAY_MS = 1200;

// ─── Component ────────────────────────────────────────────────────────────────

export function ReviewPromptSheet() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<SheetStep>("rate");
  const [rating, setRating] = useState<number>(0);     // 0 = none yet, 1-5 = tapped
  const [feedbackText, setFeedbackText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const openRef = useRef(false);
  openRef.current = open;

  const platform = getStorePlatform();
  const storeName = platform === "ios" ? "App Store" : "Play Store";
  const eligible = !!user?.firstRunCompletedAt;

  const show = useCallback((reason: OpenReason) => {
    if (openRef.current || !shouldShowReview()) return;
    setStep("rate");
    setRating(0);
    setFeedbackText("");
    setOpen(true);
    track("review_prompt_shown", { trigger: reason, platform });
  }, [platform]);

  // Cold launch (or the moment the user becomes eligible this session)
  useEffect(() => {
    if (!eligible) {
      setOpen(false);
      return;
    }
    const t = setTimeout(() => show("launch"), SHOW_DELAY_MS);
    return () => clearTimeout(t);
  }, [eligible, show]);

  // Every return to the foreground counts as an app open
  useEffect(() => {
    if (!eligible) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") show("resume");
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [eligible, show]);

  // Star tap → branch by rating (works from any step, so mis-taps can be fixed)
  const handleStarTap = (n: number) => {
    setRating(n);
    track("review_prompt_rated", { rating: n, platform });
    setStep(n >= 4 ? "thanks" : "feedback");
  };

  // 4-5 star path → straight to the store's write-review page
  const handleAppStoreRedirect = () => {
    markRated();
    track("review_prompt_clicked", { platform, rating });
    window.open(getStoreLink(platform), "_blank", "noopener,noreferrer");
    setOpen(false);
  };

  // 1-3 star path → submit feedback to support email
  const handleFeedbackSubmit = async () => {
    if (!feedbackText.trim()) {
      toast({ title: "Add a quick note", description: "Tell us what would make it better.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/feedback", {
        rating,
        comment: feedbackText.trim(),
      });
      track("review_prompt_feedback_sent", { rating });
      markRated();
      setStep("feedback-sent");
      // Auto-close after a moment so they see the thank-you confirmation
      setTimeout(() => setOpen(false), 2200);
    } catch (err: any) {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Couldn't send", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const stars = (size: string) => (
    <div className="flex items-center justify-center gap-2">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => handleStarTap(n)}
          className="p-1 active:scale-95 transition-transform"
          aria-label={`${n} star${n !== 1 ? "s" : ""}`}
          data-testid={`review-star-${n}`}
        >
          <Star
            className={`${size} transition-colors ${
              rating >= n
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground/40 hover:text-amber-400/60"
            }`}
          />
        </button>
      ))}
    </div>
  );

  return (
    // Closing only ever happens from inside (store tap / feedback sent) — the
    // sheet ignores every user-initiated dismiss.
    <Sheet open={open} onOpenChange={() => {}}>
      <SheetContent
        side="bottom"
        hideClose
        className="rounded-t-2xl"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="pt-4 pb-6 px-1">

          {/* ─── STEP: rate (5 stars, minimal copy) ────────────────────────── */}
          {step === "rate" && (
            <div className="space-y-5 pt-1 pb-3 text-center">
              <h2 className="text-lg font-semibold">How's Spliiit?</h2>
              {stars("w-10 h-10")}
              <p className="text-xs text-muted-foreground">Tap a star to rate</p>
            </div>
          )}

          {/* ─── STEP: thanks (4-5 stars) ──────────────────────────────────── */}
          {step === "thanks" && (
            <div className="space-y-5 pt-1 pb-3 text-center">
              {stars("w-7 h-7")}
              <div className="space-y-1.5">
                <h2 className="text-lg font-semibold flex items-center justify-center gap-1.5">
                  Thank you <Heart className="w-4 h-4 fill-red-400 text-red-400" />
                </h2>
                <p className="text-sm text-muted-foreground px-4">
                  Share that on the {storeName} — it takes 10 seconds and helps us a ton.
                </p>
              </div>
              <Button
                className="w-full"
                size="lg"
                onClick={handleAppStoreRedirect}
                data-testid="review-go-to-store"
              >
                Rate on the {storeName}
              </Button>
            </div>
          )}

          {/* ─── STEP: feedback (1-3 stars) ────────────────────────────────── */}
          {step === "feedback" && (
            <div className="space-y-4 pt-1 pb-3">
              <div className="text-center space-y-1.5">
                {stars("w-6 h-6")}
                <h2 className="text-base font-semibold">Sorry it's not great</h2>
                <p className="text-xs text-muted-foreground">
                  What would make Spliiit better for you? We read every note.
                </p>
              </div>
              <Textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="Tell us what's wrong or what's missing…"
                rows={4}
                className="resize-none text-sm"
                data-testid="review-feedback-textarea"
                autoFocus
              />
              <Button
                className="w-full"
                size="lg"
                onClick={handleFeedbackSubmit}
                disabled={submitting || !feedbackText.trim()}
                data-testid="review-send-feedback"
              >
                {submitting ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</>
                ) : (
                  "Send feedback"
                )}
              </Button>
            </div>
          )}

          {/* ─── STEP: feedback-sent (1-3 stars, after submit) ─────────────── */}
          {step === "feedback-sent" && (
            <div className="space-y-4 pt-2 pb-4 text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mx-auto">
                <Heart className="w-7 h-7 fill-red-400 text-red-400" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-lg font-semibold">Thanks for the feedback</h2>
                <p className="text-sm text-muted-foreground px-4">
                  We read every note. You'll hear from us if we follow up.
                </p>
              </div>
            </div>
          )}

        </div>
      </SheetContent>
    </Sheet>
  );
}
