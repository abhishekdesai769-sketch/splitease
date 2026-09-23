/**
 * WhatsNewModal — one-time "new feature" welcome carousel.
 *
 * Shown ONCE per user (versioned via localStorage). When we ship a future
 * feature, bump WHATS_NEW_VERSION + swap the SLIDES content and the whole
 * mechanism re-fires for everyone. This is our permanent "What's New" channel.
 *
 * The final slide's CTA opens the menu → "How I get paid" via a custom
 * window event (`spliiit:open-payment-prefs`) that SupportDrawer listens for.
 * No fragile DOM targeting.
 *
 * Mounted on the Dashboard (the post-login landing). Only renders if the
 * user hasn't seen this version yet.
 */

import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Wallet, Check, ArrowRight, Eye } from "lucide-react";

// Bump this string to re-show a NEW announcement to everyone.
export const WHATS_NEW_VERSION = "payments-2026-06";
const SEEN_KEY = "spliiit_whatsnew_seen";

/** True if the current user hasn't seen this version's announcement yet.
 *  Shown once ever, per user, via localStorage. */
export function shouldShowWhatsNew(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== WHATS_NEW_VERSION;
  } catch {
    return false; // storage off → don't nag
  }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, WHATS_NEW_VERSION); } catch { /* ignore */ }
}

export interface WhatsNewSlide {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
  media?: React.ReactNode; // optional video/image above the icon
}

const SLIDES: WhatsNewSlide[] = [
  {
    icon: <Wallet className="w-7 h-7 text-emerald-500" />,
    title: "New: tell friends how to pay you back",
    body: (
      <>
        No more "what's your Interac again?" texts. Add how you like to get paid —
        <span className="font-medium text-foreground"> Interac, PayPal, Venmo, Cash App</span>, whatever you use —
        and your friends &amp; groups see it automatically.
      </>
    ),
  },
  {
    icon: <Eye className="w-7 h-7 text-emerald-500" />,
    title: "And you can see how others want to be paid",
    body: (
      <>
        Need to pay a friend back? Open their page or
        <span className="font-medium text-foreground"> tap them in a group</span> to see how they get paid —
        with a one-tap copy button. Grab their details and send it over.
      </>
    ),
  },
];

/**
 * The shared "What's new" carousel: icon, title, body per slide, progress
 * dots, Skip/Next, and a final action. Used by the one-time announcement
 * below and by the dashboard's What's New tile (WhatsNewQuickAdd).
 */
export function WhatsNewDialog({
  open, slides, onClose, laterLabel = "Maybe later", finishLabel, finishIcon, finishTrailingIcon, onFinish, onCloseAutoFocus,
}: {
  open: boolean;
  slides: WhatsNewSlide[];
  onClose: () => void;
  laterLabel?: string;
  finishLabel: string;
  finishIcon?: React.ReactNode;          // before the label
  finishTrailingIcon?: React.ReactNode;  // after the label (e.g. an arrow)
  onFinish: () => void;
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const [step, setStep] = useState(0);
  useEffect(() => { if (open) setStep(0); }, [open]);

  const isLast = step === slides.length - 1;
  const slide = slides[step];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm" onCloseAutoFocus={onCloseAutoFocus}>
        <div className="flex flex-col items-center text-center pt-2 pb-1">
          {/* A slide with media (e.g. a live demo) shows it instead of the icon.
              Only the current slide is mounted, so only its demo plays. */}
          {slide.media ? (
            <div key={step} className="w-full mb-4 overflow-hidden rounded-2xl">{slide.media}</div>
          ) : (
            <div className="w-14 h-14 rounded-2xl bg-muted/60 flex items-center justify-center mb-4">
              {slide.icon}
            </div>
          )}
          <h2 className="text-lg font-semibold mb-2">{slide.title}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed px-1">
            {slide.body}
          </p>

          {/* Progress dots */}
          {slides.length > 1 && (
            <div className="flex items-center gap-1.5 mt-5">
              {slides.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i === step ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/30"
                  }`}
                />
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 mt-6 w-full">
            {!isLast ? (
              <>
                <Button variant="ghost" className="flex-1" onClick={onClose}>
                  Skip
                </Button>
                <Button className="flex-1" onClick={() => setStep((s) => s + 1)}>
                  Next
                  <ArrowRight className="w-4 h-4 ml-1.5" />
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" className="flex-1" onClick={onClose}>
                  {laterLabel}
                </Button>
                <Button className="flex-1" onClick={onFinish}>
                  {finishIcon}
                  {finishLabel}
                  {finishTrailingIcon}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WhatsNewModal() {
  // Decide once on mount whether to show — avoids flicker if storage changes.
  const [open, setOpen] = useState(() => shouldShowWhatsNew());

  const close = () => {
    markSeen();
    setOpen(false);
  };

  const finishAndOpen = () => {
    markSeen();
    setOpen(false);
    // Let SupportDrawer open itself straight to the payment editor.
    // Small delay so the modal's close animation doesn't fight the drawer open.
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("spliiit:open-payment-prefs"));
    }, 150);
  };

  return (
    <WhatsNewDialog
      open={open}
      slides={SLIDES}
      onClose={close}
      finishLabel="Set it up now"
      finishIcon={<Check className="w-4 h-4 mr-1.5" />}
      onFinish={finishAndOpen}
    />
  );
}
