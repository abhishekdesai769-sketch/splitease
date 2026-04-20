import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

type Tone = "friendly" | "funny" | "firm" | "passive-aggressive" | "awkward";

// ─── Message templates ───────────────────────────────────────────────────────
// 3 variants per tone; a random one is picked when the tone changes so
// the preview feels fresh each time without changing after the user reads it.

function buildMessage(tone: Tone, senderName: string, recipientName: string, amount: number): string {
  const first = recipientName.split(" ")[0];
  const amt = `$${amount.toFixed(2)}`;

  const variants: Record<Tone, string[]> = {
    friendly: [
      `Hey ${first}! 👋 Spliiit here — just a friendly nudge that you have an outstanding balance of ${amt} with ${senderName}. No stress at all, but whenever you get a chance to settle up it would mean a lot!\n\n— Spliiit`,
      `Hi ${first}! 🌟 Quick reminder from Spliiit — you still have ${amt} outstanding with ${senderName}. Totally fine whenever you get around to it!\n\n— Spliiit`,
      `Hey ${first}! Spliiit dropping in — you owe ${senderName} ${amt} 😊 No pressure, just keeping things tidy. Settle up when you can!\n\n— Spliiit`,
    ],
    funny: [
      `Hi ${first} 😄 Spliiit here with a fun fact: you owe ${senderName} ${amt}. Less fun fact: it's been sitting there a while. Even less fun fact: we just sent you this email about it.\n\nGood news — settling up takes about 10 seconds. Then we can all move on with our lives.\n\n— Spliiit`,
      `${first}! Spliiit here with great news and mildly inconvenient news. Great news: your friends like you! Mildly inconvenient news: you owe ${senderName} ${amt} 😂 Tap below and we're all good!\n\n— Spliiit`,
      `Okay so imagine getting an automated email about money... that's this email 😄 You owe ${senderName} ${amt} and Spliiit has officially been asked to mention it. Button's below. You're welcome.\n\n— Spliiit`,
    ],
    firm: [
      `Hi ${first},\n\nThis is an automated reminder from Spliiit that you have an outstanding balance of ${amt} owed to ${senderName}. Please settle this at your earliest convenience.\n\nThank you,\nSpliiit`,
      `Hello ${first},\n\nSpliiit is following up on an outstanding balance of ${amt} owed to ${senderName}. Please arrange payment at your earliest convenience.\n\nRegards,\nSpliiit`,
      `Hi ${first},\n\nA balance of ${amt} remains outstanding with ${senderName}. Please action this as soon as possible — you can settle directly through Spliiit.\n\nThanks,\nSpliiit`,
    ],
    "passive-aggressive": [
      `Hey ${first}! No worries at all! Totally fine! Spliiit here — just wanted to gently, warmly, completely-non-aggressively mention that you still owe ${senderName} ${amt}. No rush whatsoever. We're sure you've just been super busy. 😊\n\nThe button is right there whenever you're ready. Take your time. We'll wait.\n\n— Spliiit 🙂`,
      `Hi ${first}! Hope you're having a great day! Spliiit just popping in — with zero passive aggression — to mention that ${amt} is still outstanding with ${senderName}. But genuinely, no stress! It's fine. Everything is fine. 😊\n\n— Spliiit`,
      `Hey ${first} 🙂 So Spliiit was just thinking about shared expenses. You know, casually. For no particular reason. And happened to notice that you owe ${senderName} ${amt}. Weird how these things come up! Button's below. No pressure. At all.\n\n— Spliiit`,
    ],
    awkward: [
      `Hey ${first}... Spliiit genuinely debated sending this. Like, a lot.\n\nBut you owe ${senderName} ${amt} and it's gotten to the point where NOT saying something is somehow weirder than saying something. So. We said something.\n\nPlease click the button. For everyone's sake.\n\n— Spliiit (this was hard for us too) 🙈`,
      `${first}... so here's the thing. You owe ${senderName} ${amt} and it's been a while. Spliiit has been sitting on this information feeling increasingly awkward about it. We've now reached the point of no return.\n\nButton below. Let's never discuss this.\n\n— Spliiit 😅`,
      `Hey so... this is the email where Spliiit tells you that you owe ${senderName} ${amt}. We didn't want to send it either. But here we are, united in discomfort. Settle up and we can all pretend this never happened 😬\n\n— Spliiit`,
    ],
  };

  const pool = variants[tone];
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─────────────────────────────────────────────────────────────────────────────

const TONES: { id: Tone; emoji: string; label: string; sub: string }[] = [
  { id: "friendly",           emoji: "😊", label: "Friendly",          sub: "Warm & casual"    },
  { id: "funny",              emoji: "😂", label: "Funny",              sub: "Light humour"     },
  { id: "firm",               emoji: "💼", label: "Firm",               sub: "Professional"     },
  { id: "passive-aggressive", emoji: "😏", label: "Passive-Aggressive", sub: "Polite but ouch"  },
  { id: "awkward",            emoji: "😬", label: "Awkward",            sub: "Cringe energy"    },
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
        <div className="grid grid-cols-2 gap-2 mb-4">
          {TONES.map(({ id, emoji, label, sub }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTone(id)}
              className={`py-2.5 px-3 rounded-lg border text-sm font-medium transition-colors flex items-center gap-2 ${
                tone === id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted/50"
              }`}
            >
              <span className="text-base shrink-0">{emoji}</span>
              <div className="text-left">
                <p className="text-xs font-semibold leading-none mb-0.5">{label}</p>
                <p className="text-[10px] opacity-70 leading-none">{sub}</p>
              </div>
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
