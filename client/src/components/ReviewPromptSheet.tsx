/**
 * ReviewPromptSheet — in-app review prompt
 *
 * Shown after 3 key moments from GROWTH_BLUEPRINT.md:
 *   - 6th expense added (past Splitwise's free cap)
 *   - First receipt uploaded (Splitwise charges for this)
 *   - Group created with 3+ members
 *
 * Copy strategy: genuine, not corporate. Explain WHY the review matters.
 * One big CTA, small "Maybe later", "Already did" escape hatch.
 */

import { useEffect, useState } from "react";
import { Star, X } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
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

// ─── Trigger-specific copy (from GROWTH_BLUEPRINT.md) ────────────────────────

const COPY: Record<ReviewTrigger, { headline: string; body: string }> = {
  expense_6: {
    headline: "Other apps would've stopped you by now 🚫",
    body: "You've added 6 expenses — most well-known apps would've cut you off or started throwing ads at you by now. We didn't. A 30-second review helps us keep our commitment to keeping the basics free for you, forever. It means the world to us. 🙏",
  },
  receipt: {
    headline: "Receipt attached — and it was free",
    body: "Most popular apps charge a monthly fee just to upload a receipt. You didn't pay a cent — and you never will for this. A quick review helps more people find us who are tired of paying for things that should just be free. It means the world to us. 🙏",
  },
  group: {
    headline: "Your group is live! 🎉",
    body: "If Spliiit is already working better for you, a 30-second review genuinely helps us keep the basics free for everyone, forever. We read every single review. It means the world to us. 🙏",
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ReviewPromptSheet() {
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<ReviewTrigger>("expense_6");

  const platform = getStorePlatform();
  const storeLink = getStoreLink(platform);
  const storeName = platform === "ios" ? "App Store" : "Play Store";
  const copy = COPY[trigger];

  // Register the global trigger callback when this component mounts
  useEffect(() => {
    registerReviewTrigger((type) => {
      setTrigger(type);
      setOpen(true);
      markShown(type);
      track("review_prompt_shown", { trigger: type, platform });
    });
    return () => unregisterReviewTrigger();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLeaveReview = () => {
    markRated();
    track("review_prompt_clicked", { trigger, platform });
    window.open(storeLink, "_blank", "noopener,noreferrer");
    setOpen(false);
  };

  const handleMaybeLater = () => {
    markDismissed();
    track("review_prompt_dismissed", { trigger, action: "maybe_later" });
    setOpen(false);
  };

  const handleAlreadyDid = () => {
    markRated();
    track("review_prompt_dismissed", { trigger, action: "already_rated" });
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) handleMaybeLater(); }}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-safe">
        <div className="pt-2 pb-6 px-1 space-y-5">

          {/* Header row */}
          <div className="flex items-start justify-between">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center">
              <Star className="w-6 h-6 text-amber-500 fill-amber-500" />
            </div>
            <button
              onClick={handleMaybeLater}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 mt-0.5"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Copy */}
          <div className="space-y-2">
            <h2 className="text-base font-semibold text-foreground leading-snug">
              {copy.headline}
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {copy.body}
            </p>
          </div>

          {/* Primary CTA */}
          <Button
            className="w-full"
            size="lg"
            onClick={handleLeaveReview}
          >
            <Star className="w-4 h-4 mr-2 fill-current" />
            Leave a Review on {storeName}
          </Button>

          {/* Secondary actions */}
          <div className="flex items-center justify-center gap-6">
            <button
              onClick={handleAlreadyDid}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              I already did ✓
            </button>
            <span className="text-border text-xs">·</span>
            <button
              onClick={handleMaybeLater}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Maybe later
            </button>
          </div>

        </div>
      </SheetContent>
    </Sheet>
  );
}
