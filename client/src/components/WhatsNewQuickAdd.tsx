/**
 * WhatsNewQuickAdd — what the dashboard's "What's new" tile opens: a short
 * tour of the quick-add pill (type it, say it, talk it through), in the same
 * carousel design as the one-time WhatsNewModal. "Try it" closes it and puts
 * the cursor in the pill.
 *
 * A demo video can go on the first slide via `media` once it's recorded.
 */

import { useRef } from "react";
import { Sparkles, Mic, AudioLines, ArrowRight } from "lucide-react";
import { track } from "@/lib/analytics";
import { WhatsNewDialog, type WhatsNewSlide } from "@/components/WhatsNewModal";

const SLIDES: WhatsNewSlide[] = [
  {
    icon: <Sparkles className="w-7 h-7 text-accent-foreground" />,
    title: "Tell Spliiit anything",
    body: (
      <>
        Type into the box at the bottom, like
        <span className="font-medium text-foreground"> "dinner 60 with Sarah"</span>, and it turns into a split
        right there. Check it, tap Add, done.
      </>
    ),
  },
  {
    icon: <Mic className="w-7 h-7 text-accent-foreground" />,
    title: "Or just say it",
    body: (
      <>
        Tap the <span className="font-medium text-foreground">mic</span> and talk. Your words fill the box and the
        same card builds as you speak.
      </>
    ),
  },
  {
    icon: <AudioLines className="w-7 h-7 text-accent-foreground" />,
    title: "Talk it through with Spliiit",
    body: (
      <>
        Tap the <span className="font-medium text-foreground">sound button</span> for a quick voice chat. Spliiit
        asks what it needs, then shows the card to save.
      </>
    ),
  },
];

export function WhatsNewQuickAdd({ open, onOpenChange, onTryIt }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTryIt: () => void;
}) {
  // Focus has to wait until the dialog has closed: while it's open, its focus
  // trap would pull focus straight back.
  const tryItPending = useRef(false);

  return (
    <WhatsNewDialog
      open={open}
      slides={SLIDES}
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
