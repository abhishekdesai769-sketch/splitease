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

import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Wallet, Check, ArrowRight, Copy } from "lucide-react";

// Bump this string to re-show a NEW announcement to everyone.
export const WHATS_NEW_VERSION = "payments-2026-06";
const SEEN_KEY = "spliiit_whatsnew_seen";

/** True if the current user hasn't seen this version's announcement yet. */
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

interface Slide {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
}

const SLIDES: Slide[] = [
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
    icon: <Copy className="w-7 h-7 text-primary" />,
    title: "They'll see it right when they settle up",
    body: (
      <>
        When someone goes to pay you back, your details show up with a
        <span className="font-medium text-foreground"> one-tap copy button</span> — so the money lands in the
        right place, every time. Set yours up once and you're done.
      </>
    ),
  },
];

export function WhatsNewModal() {
  // Decide once on mount whether to show — avoids flicker if storage changes.
  const [open, setOpen] = useState(() => shouldShowWhatsNew());
  const [step, setStep] = useState(0);

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

  const isLast = step === SLIDES.length - 1;
  const slide = SLIDES[step];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-sm">
        <div className="flex flex-col items-center text-center pt-2 pb-1">
          <div className="w-14 h-14 rounded-2xl bg-muted/60 flex items-center justify-center mb-4">
            {slide.icon}
          </div>
          <h2 className="text-lg font-semibold mb-2">{slide.title}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed px-1">
            {slide.body}
          </p>

          {/* Progress dots */}
          {SLIDES.length > 1 && (
            <div className="flex items-center gap-1.5 mt-5">
              {SLIDES.map((_, i) => (
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
                <Button variant="ghost" className="flex-1" onClick={close}>
                  Skip
                </Button>
                <Button className="flex-1" onClick={() => setStep((s) => s + 1)}>
                  Next
                  <ArrowRight className="w-4 h-4 ml-1.5" />
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" className="flex-1" onClick={close}>
                  Maybe later
                </Button>
                <Button className="flex-1" onClick={finishAndOpen}>
                  <Check className="w-4 h-4 mr-1.5" />
                  Set it up now
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
