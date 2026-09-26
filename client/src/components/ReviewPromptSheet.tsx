/**
 * ReviewPromptSheet — mandatory 5-star rating gate
 *
 * Shown on EVERY open of the installed app (cold launch + every return to
 * the foreground) until the user completes it. No X, no "Maybe later", no
 * tap-outside / Escape dismiss. See lib/reviewPrompt.ts for the done state.
 *
 * Timing: it waits SHOW_AFTER_MS of foreground time on each open so the
 * user gets a feel for the app first, and never lands on top of another
 * open sheet/dialog (e.g. mid add-expense) — it waits for that to close.
 *
 * Flow: tap a star (reaction face + word appear) → Submit
 *   4-5 stars  → straight to the App Store / Play Store write-review page.
 *   1-3 stars  → in-app feedback note → /api/feedback (emailed to support).
 *                They are not sent to the store.
 * Either completion = done, never shown again on this install.
 *
 * Only shown once the user is logged in and past the first-run wizard.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
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

type SheetStep = "rate" | "feedback" | "feedback-sent";
type OpenReason = "launch" | "resume";

// Foreground time on each open before the sheet appears.
const SHOW_AFTER_MS = 20_000;
// If another sheet/dialog is open when the timer fires, re-check this often.
const BUSY_RETRY_MS = 3_000;

const WORDS = ["Not for me", "Needs work", "It's okay", "Really good", "Love it"];
const FACES = [":(", ":/", ":|", ":)", ":D"];
const STAR_PATH =
  "M12 2.8l2.75 5.6 6.15.9-4.45 4.35 1.05 6.13L12 16.9l-5.5 2.88 1.05-6.13L3.1 9.3l6.15-.9z";

// ─── Pieces ───────────────────────────────────────────────────────────────────

/** The Spliiit app icon (three i's), drawn to the real icon's proportions. */
function AppIcon() {
  return (
    <svg
      width="68"
      height="68"
      viewBox="0 0 512 512"
      aria-hidden="true"
      className="block mx-auto -mt-[34px] mb-3 rounded-2xl shadow-[0_1px_1px_rgba(20,18,16,.10),0_6px_14px_-4px_rgba(20,18,16,.28),0_18px_30px_-12px_rgba(20,18,16,.30)]"
    >
      <defs>
        <linearGradient id="rv-icon-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2B2927" />
          <stop offset="1" stopColor="#141312" />
        </linearGradient>
        <linearGradient id="rv-icon-glyph" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#E9E4DC" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="115" fill="url(#rv-icon-bg)" />
      <rect x="2" y="2" width="508" height="508" rx="113" fill="none" stroke="rgba(255,255,255,.09)" strokeWidth="3" />
      <g transform="translate(256 256) scale(.86) translate(-256 -256)" fill="url(#rv-icon-glyph)">
        {[171.5, 255.5, 339.5].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy="155" r="27.5" />
            <rect x={cx - 28} y="202" width="56" height="184" rx="28" />
          </g>
        ))}
      </g>
    </svg>
  );
}

function Stars({ rating, onPick, size }: { rating: number; onPick: (n: number) => void; size: number }) {
  return (
    <div className="flex items-center justify-center gap-[5px]">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onPick(n)}
          className="block shrink min-w-0 aspect-square active:scale-90 transition-transform"
          style={{ flexBasis: size }}
          aria-label={`${n} star${n !== 1 ? "s" : ""}`}
          data-testid={`review-star-${n}`}
        >
          <svg viewBox="0 0 24 24" className="w-full h-full block">
            {n <= rating ? (
              <path d={STAR_PATH} fill="#D9A441" stroke="#B8842A" strokeWidth="1" strokeLinejoin="round" />
            ) : (
              <path
                d={STAR_PATH}
                fill="hsl(var(--muted))"
                stroke="hsl(var(--muted-foreground))"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            )}
          </svg>
        </button>
      ))}
    </div>
  );
}

function Headline({ children }: { children: ReactNode }) {
  return <h2 className="font-serif text-[34px] leading-[1.05] tracking-tight text-foreground">{children}</h2>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ReviewPromptSheet() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<SheetStep>("rate");
  const [rating, setRating] = useState<number>(0);     // 0 = none yet, 1-5 = tapped
  const [nudge, setNudge] = useState(false);           // Submit tapped with no star
  const [feedbackText, setFeedbackText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const openRef = useRef(false);
  openRef.current = open;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const platform = getStorePlatform();
  const eligible = !!user?.firstRunCompletedAt;

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const tryShow = useCallback((reason: OpenReason) => {
    timerRef.current = null;
    if (openRef.current || !shouldShowReview() || document.visibilityState !== "visible") return;
    // Don't land on top of another sheet/dialog — wait for it to close.
    if (document.querySelector('[role="dialog"], [role="alertdialog"]')) {
      timerRef.current = setTimeout(() => tryShow(reason), BUSY_RETRY_MS);
      return;
    }
    setStep("rate");
    setRating(0);
    setNudge(false);
    setFeedbackText("");
    setOpen(true);
    track("review_prompt_shown", { trigger: reason, platform });
  }, [platform]);

  const schedule = useCallback((reason: OpenReason) => {
    clearTimer();
    if (openRef.current || !shouldShowReview()) return;
    timerRef.current = setTimeout(() => tryShow(reason), SHOW_AFTER_MS);
  }, [tryShow]);

  // Cold launch (or the moment the user becomes eligible this session)
  useEffect(() => {
    if (!eligible) {
      clearTimer();
      setOpen(false);
      return;
    }
    schedule("launch");
    return clearTimer;
  }, [eligible, schedule]);

  // Every return to the foreground counts as a new open; leaving cancels the wait
  useEffect(() => {
    if (!eligible) return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") schedule("resume");
      else clearTimer();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [eligible, schedule]);

  const handleStarTap = (n: number) => {
    setRating(n);
    setNudge(false);
    track("review_prompt_rated", { rating: n, platform });
  };

  const handleSubmit = () => {
    if (!rating) {
      setNudge(true);
      return;
    }
    if (rating >= 4) {
      // 4-5 stars → straight to the store's write-review page
      markRated();
      track("review_prompt_clicked", { platform, rating });
      window.open(getStoreLink(platform), "_blank", "noopener,noreferrer");
      setOpen(false);
    } else {
      setStep("feedback");
    }
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

  return (
    // Closing only ever happens from inside (store tap / feedback sent) — the
    // sheet ignores every user-initiated dismiss.
    <Sheet open={open} onOpenChange={() => {}}>
      <SheetContent
        side="bottom"
        hideClose
        className="rounded-t-[26px] border-0 bg-card px-4 pt-0 pb-[calc(1.25rem+env(safe-area-inset-bottom))] overflow-visible"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="mx-auto w-full max-w-sm text-center">
          <AppIcon />

          {/* ─── STEP: rate ────────────────────────────────────────────────── */}
          {step === "rate" && (
            <>
              <Headline>
                Enjoying <em className="italic text-accent-foreground">Spliiit</em>?
              </Headline>
              <p className="mt-1.5 mb-3.5 text-xs text-muted-foreground">Join 10k+ people splitting smarter</p>
              <div
                className={`font-serif text-[34px] leading-none text-foreground overflow-hidden transition-all duration-200 ${
                  rating ? "h-9 mb-2" : "h-0"
                }`}
                aria-hidden="true"
              >
                {rating ? FACES[rating - 1] : null}
              </div>
              <Stars rating={rating} onPick={handleStarTap} size={38} />
              <p
                className={`mt-2.5 h-4 text-xs font-medium ${nudge ? "text-destructive" : "text-foreground"}`}
                aria-live="polite"
              >
                {nudge ? "Tap a star first" : rating ? WORDS[rating - 1] : "Tap a star"}
              </p>
              <Button className="mt-3.5 w-full" size="lg" onClick={handleSubmit} data-testid="review-submit">
                Submit
              </Button>
            </>
          )}

          {/* ─── STEP: feedback (1-3 stars) ────────────────────────────────── */}
          {step === "feedback" && (
            <div className="space-y-3.5">
              <div>
                <Headline>
                  What could be <em className="italic text-accent-foreground">better</em>?
                </Headline>
                <p className="mt-1.5 text-xs text-muted-foreground">We read every note.</p>
              </div>
              <Stars rating={rating} onPick={handleStarTap} size={26} />
              <Textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="Tell us what's wrong or what's missing…"
                rows={4}
                className="resize-none text-sm text-left"
                data-testid="review-feedback-textarea"
                autoFocus
              />
              {rating >= 4 ? (
                // Changed their mind upward on this screen → store path
                <Button className="w-full" size="lg" onClick={handleSubmit} data-testid="review-submit">
                  Submit
                </Button>
              ) : (
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
              )}
            </div>
          )}

          {/* ─── STEP: feedback-sent ───────────────────────────────────────── */}
          {step === "feedback-sent" && (
            <div className="pb-4">
              <Headline>
                Thank <em className="italic text-accent-foreground">you</em>
              </Headline>
              <p className="mt-1.5 text-sm text-muted-foreground">
                We read every note. You'll hear from us if we follow up.
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
