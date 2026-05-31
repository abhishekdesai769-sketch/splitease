/**
 * ReviewPromptSheet — 5-star in-app review prompt
 *
 * Replaces the previous "long copy + Leave a Review button" approach with
 * a stars-only UI. User taps a star → smart routing:
 *
 *   4-5 stars  → "Thanks!" screen → tap to be redirected to App Store with
 *                a brief delay; SKStoreReviewController is attempted first
 *                in case Apple decides to render its native modal (zero
 *                friction when it works).
 *
 *   1-3 stars  → in-app feedback form → submits via /api/feedback (emailed
 *                to support). Does NOT push them to the App Store — saves
 *                us from public bad reviews.
 *
 * Trigger logic (lib/reviewPrompt.ts) is UNCHANGED:
 *   - 2nd expense (key kept as "expense_6" for localStorage compat)
 *   - first receipt
 *   - 3-member group
 * Plus the existing 3-prompt cap and 7-day cooldown.
 */

import { useEffect, useState } from "react";
import { Star, X, Loader2, Heart } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  type ReviewTrigger,
  registerReviewTrigger,
  unregisterReviewTrigger,
  markShown,
  markRated,
  markDismissed,
  getStorePlatform,
  getStoreLink,
} from "@/lib/reviewPrompt";
import { track } from "@/lib/analytics";
import { requestNativeReview } from "@/lib/native-review";

type SheetStep = "rate" | "thanks" | "feedback" | "feedback-sent";

// ─── Component ────────────────────────────────────────────────────────────────

export function ReviewPromptSheet() {
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<ReviewTrigger>("expense_6");
  const [step, setStep] = useState<SheetStep>("rate");
  const [rating, setRating] = useState<number>(0);     // 0 = none yet, 1-5 = tapped
  const [feedbackText, setFeedbackText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const platform = getStorePlatform();
  const storeName = platform === "ios" ? "App Store" : "Play Store";

  // Register the global trigger callback when this component mounts
  useEffect(() => {
    registerReviewTrigger((type) => {
      setTrigger(type);
      setStep("rate");
      setRating(0);
      setFeedbackText("");
      setOpen(true);
      markShown(type);
      track("review_prompt_shown", { trigger: type, platform });
    });
    return () => unregisterReviewTrigger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Star tap → branch by rating
  const handleStarTap = (n: number) => {
    setRating(n);
    track("review_prompt_rated", { trigger, rating: n, platform });
    if (n >= 4) {
      setStep("thanks");
    } else {
      setStep("feedback");
    }
  };

  // 4-5 star path → try native prompt, fall back to App Store
  const handleAppStoreRedirect = async () => {
    markRated(); // Apple-side rating is happening; never re-prompt this user
    track("review_prompt_clicked", { trigger, platform, rating });
    // Try the native prompt first. If it fires, Apple's modal handles the
    // submission (zero friction). If suppressed or unavailable, we fall
    // back to the App Store write-review URL (~3 extra taps for the user
    // but a guaranteed path to recording the review).
    const nativeFired = await requestNativeReview();
    if (!nativeFired) {
      window.open(getStoreLink(platform), "_blank", "noopener,noreferrer");
    }
    setOpen(false);
  };

  // 4-5 star path → user said "maybe later" on the thanks screen
  const handleThanksDismiss = () => {
    // They tapped 4-5 stars, so they like us — mark rated to avoid pestering
    // them again. The intent was positive even if they didn't follow through.
    markRated();
    track("review_prompt_dismissed", { trigger, action: "thanks_dismissed", rating });
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
      track("review_prompt_feedback_sent", { trigger, rating });
      markRated(); // they gave us a 1-3, don't ask again — they were honest
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

  // Top-right X — counts as "maybe later" before any rating is given
  const handleClose = () => {
    if (step === "rate") {
      markDismissed();
      track("review_prompt_dismissed", { trigger, action: "closed_without_rating" });
    }
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <div className="pt-2 pb-6 px-1">

          {/* Close X — top-right, present on every step */}
          <div className="flex justify-end">
            <button
              onClick={handleClose}
              className="text-muted-foreground hover:text-foreground transition-colors p-1"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* ─── STEP: rate (5 stars, minimal copy) ────────────────────────── */}
          {step === "rate" && (
            <div className="space-y-5 pt-1 pb-3 text-center">
              <h2 className="text-lg font-semibold">How's Spliiit?</h2>
              <div className="flex items-center justify-center gap-2.5">
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
                      className={`w-10 h-10 transition-colors ${
                        rating >= n
                          ? "fill-amber-400 text-amber-400"
                          : "text-muted-foreground/40 hover:text-amber-400/60"
                      }`}
                    />
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Tap a star to rate</p>
            </div>
          )}

          {/* ─── STEP: thanks (4-5 stars) ──────────────────────────────────── */}
          {step === "thanks" && (
            <div className="space-y-5 pt-1 pb-3 text-center">
              {/* Show the user's chosen rating, lit up */}
              <div className="flex items-center justify-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    className={`w-7 h-7 ${
                      n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"
                    }`}
                  />
                ))}
              </div>
              <div className="space-y-1.5">
                <h2 className="text-lg font-semibold flex items-center justify-center gap-1.5">
                  Thank you <Heart className="w-4 h-4 fill-red-400 text-red-400" />
                </h2>
                <p className="text-sm text-muted-foreground px-4">
                  Would you mind sharing that on the {storeName}? Takes 10 seconds.
                </p>
              </div>
              <div className="space-y-2.5 pt-1">
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleAppStoreRedirect}
                  data-testid="review-go-to-store"
                >
                  Sure, take me there
                </Button>
                <button
                  onClick={handleThanksDismiss}
                  className="block mx-auto text-xs text-muted-foreground hover:text-foreground transition-colors py-2"
                >
                  Maybe later
                </button>
              </div>
            </div>
          )}

          {/* ─── STEP: feedback (1-3 stars) ────────────────────────────────── */}
          {step === "feedback" && (
            <div className="space-y-4 pt-1 pb-3">
              <div className="text-center space-y-1.5">
                <div className="flex items-center justify-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      className={`w-6 h-6 ${
                        n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"
                      }`}
                    />
                  ))}
                </div>
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
