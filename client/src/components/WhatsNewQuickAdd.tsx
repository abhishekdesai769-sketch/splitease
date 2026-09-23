/**
 * WhatsNewQuickAdd — what the dashboard's "What's new" tile opens: a short
 * tour of the quick-add pill (type it, say it, talk it through), in the same
 * carousel design as the one-time WhatsNewModal. "Try it" closes it and puts
 * the cursor in the pill.
 *
 * Each slide plays a live mini version of the real pill and card
 * (see quick-add-demo), instead of a recorded video.
 */

import { useRef } from "react";
import { Sparkles, Mic, AudioLines, ArrowRight } from "lucide-react";
import { track } from "@/lib/analytics";
import { useAuth } from "@/lib/auth";
import { WhatsNewDialog, type WhatsNewSlide } from "@/components/WhatsNewModal";
import { TypeScene, DictateScene, CallScene } from "@/components/quick-add-demo";

// Each slide plays a live, scaled-down run of the real pill and card (made-up
// people only), instead of a recorded video: always matches the current UI.
function slides(currency?: string | null): WhatsNewSlide[] {
  return [
    {
      icon: <Sparkles className="w-7 h-7 text-accent-foreground" />,
      media: <TypeScene currency={currency} />,
      title: "Tell Spliiit anything",
      body: <>Type it the way you'd say it. It turns into a split right there. Check it, tap Add, done.</>,
    },
    {
      icon: <Mic className="w-7 h-7 text-accent-foreground" />,
      media: <DictateScene currency={currency} />,
      title: "Or just say it",
      body: <>Tap the <span className="font-medium text-foreground">mic</span> and talk. The same card builds as you speak.</>,
    },
    {
      icon: <AudioLines className="w-7 h-7 text-accent-foreground" />,
      media: <CallScene currency={currency} />,
      title: "Talk it through with Spliiit",
      body: <>Tap the <span className="font-medium text-foreground">sound button</span> for a quick voice chat. Spliiit asks what it needs, then shows the card to save.</>,
    },
  ];
}

export function WhatsNewQuickAdd({ open, onOpenChange, onTryIt }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTryIt: () => void;
}) {
  // Focus has to wait until the dialog has closed: while it's open, its focus
  // trap would pull focus straight back.
  const tryItPending = useRef(false);
  const { user } = useAuth();

  return (
    <WhatsNewDialog
      open={open}
      slides={slides(user?.defaultCurrency)}
      onClose={() => onOpenChange(false)}
      finishLabel="Try it"
      finishTrailingIcon={<ArrowRight className="w-4 h-4 ml-1.5" />}
      onFinish={() => {
        track("whats_new_try_it", { feature: "quick_add" });
        tryItPending.current = true;
        onOpenChange(false);
      }}
      onCloseAutoFocus={(e) => {
        if (!tryItPending.current) return;
        tryItPending.current = false;
        e.preventDefault(); // don't hand focus back to the tile
        onTryIt();
      }}
    />
  );
}
