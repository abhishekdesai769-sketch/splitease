import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

type Tone = "friendly" | "firm" | "awkward";

// ─── Message templates ───────────────────────────────────────────────────────
// 3 variants per tone; a random one is picked when the tone changes so
// the preview feels fresh each time without changing after the user reads it.

function buildMessage(tone: Tone, senderName: string, recipientName: string, amount: number): string {
  const first = recipientName.split(" ")[0];
  const amt = `$${amount.toFixed(2)}`;

  const variants: Record<Tone, string[]> = {
    friendly: [
      `Hey ${first}! 👋 Just a quick nudge — you still owe me ${amt} from our shared expenses. No rush at all, just keeping things tidy! Settle up on Spliiit whenever works for you 😊\n\n— ${senderName}`,
      `Hi ${first}! Hope everything's going great 🌟 Friendly reminder that I'm still owed ${amt} from us — totally fine whenever you get a chance!\n\n— ${senderName}`,
      `Hey ${first}! Not trying to be that person, but you owe me ${amt} 😄 No pressure, just a lil reminder. Settle up on Spliiit when you can!\n\n— ${senderName}`,
    ],
    firm: [
      `Hi ${first},\n\nThis is a reminder that you have an outstanding balance of ${amt} owed to me. Please settle this at your earliest convenience through Spliiit.\n\nThank you,\n${senderName}`,
      `Hello ${first},\n\nI'm following up on an outstanding balance of ${amt}. Please arrange payment when possible.\n\nRegards,\n${senderName}`,
      `Hi ${first},\n\nA balance of ${amt} remains outstanding. Please action this as soon as possible — you can settle directly through Spliiit.\n\nThanks,\n${senderName}`,
    ],
    awkward: [
      `Hey so... um... this is super awkward and I low-key hate sending this, but you owe me ${amt} and my app keeps reminding ME about it so now I'm reminding YOU lol 😬 No rush... well actually maybe some rush. Okay this is painful. Bye.\n\n— ${senderName}`,
      `Soooo haha this is a bit weird but my budgeting app literally sent ME a notification and now I feel obligated to tell you... you owe me ${amt}? 🙈 It's not my fault I have a financial tracking app! Settle up whenever haha\n\n— ${senderName}`,
      `Ok so I've been meaning to bring this up but kept avoiding it because now it's been long enough that it's awkward to mention in person... you owe me ${amt} 😅 Let's just both pretend this message was normal to send. Spliiit makes it easy at least!\n\n— ${senderName}`,
    ],
  };

  const pool = variants[tone];
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─────────────────────────────────────────────────────────────────────────────

const TONES: { id: Tone; emoji: string; label: string }[] = [
  { id: "friendly", emoji: "😊", label: "Friendly" },
  { id: "firm",     emoji: "💼", label: "Firm"     },
  { id: "awkward",  emoji: "😬", label: "Awkward"  },
];

export function ReminderSheet({
  open,
  onClose,
  recipientId,
  recipientName,
  amount,
}: {
  open: boolean;
  onClose: () => void;
  recipientId: string;
  recipientName: string;
  amount: number; // positive — they owe you this much
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tone, setTone] = useState<Tone>("friendly");
  const [preview, setPreview] = useState("");

  // Regenerate preview whenever tone (or sheet) changes
  useEffect(() => {
    if (open) {
      setPreview(buildMessage(tone, user?.name || "Me", recipientName, amount));
    }
  }, [tone, open]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reminders/send", {
        recipientId,
        message: preview,
        tone,
        amount,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Reminder sent! 📬", description: `${recipientName} will get an email shortly.` });
      onClose();
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-8 px-5">
        <SheetHeader className="text-left pt-2 pb-4">
          <SheetTitle className="text-lg">
            Remind {recipientName.split(" ")[0]} · <span className="text-primary font-mono">${amount.toFixed(2)}</span>
          </SheetTitle>
        </SheetHeader>

        {/* Tone selector */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {TONES.map(({ id, emoji, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTone(id)}
              className={`py-2.5 rounded-lg border text-sm font-medium transition-colors flex flex-col items-center gap-0.5 ${
                tone === id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted/50"
              }`}
            >
              <span className="text-base">{emoji}</span>
              {label}
            </button>
          ))}
        </div>

        {/* Message preview */}
        <div className="rounded-lg border border-border bg-muted/30 p-3 mb-4 space-y-1">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">Preview</p>
          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{preview}</p>
        </div>

        <Button
          className="w-full"
          size="lg"
          onClick={() => sendMutation.mutate()}
          disabled={sendMutation.isPending}
        >
          {sendMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Send className="w-4 h-4 mr-2" />
          )}
          {sendMutation.isPending ? "Sending..." : `Send to ${recipientName.split(" ")[0]}`}
        </Button>

        <p className="text-xs text-center text-muted-foreground mt-3">
          Sends via email · They won't know which app sent it
        </p>
      </SheetContent>
    </Sheet>
  );
}
