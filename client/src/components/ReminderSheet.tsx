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
      `Hey ${first}! 👋 Just a quick nudge — you still owe me ${amt} from our shared expenses. No rush at all, just keeping things tidy! Settle up on Spliiit whenever works for you 😊\n\n— ${senderName}`,
      `Hi ${first}! Hope everything's going great 🌟 Friendly reminder that I'm still owed ${amt} — totally fine whenever you get a chance!\n\n— ${senderName}`,
      `Hey ${first}! Not trying to be that person, but you owe me ${amt} 😄 No pressure, just a lil reminder. Settle up on Spliiit when you can!\n\n— ${senderName}`,
    ],
    funny: [
      `Hey ${first} 😄 Fun fact: you owe me ${amt}. Less fun fact: it's still sitting there. Even less fun fact: I'm writing you this message about it.\n\nGood news — settling up on Spliiit takes like 10 seconds. Then we never have to speak of this again lol\n\n— ${senderName}`,
      `${first}! I have great news and mildly inconvenient news. Great news: I like you! Mildly inconvenient news: you owe me ${amt} 😂 No big deal, just tap Spliiit and we're all good!\n\n— ${senderName}`,
      `Okay so imagine getting an email about money... that's this email 😄 You owe me ${amt} and I have officially run out of ways to organically bring it up in conversation. Spliiit button below. You're welcome.\n\n— ${senderName}`,
    ],
    firm: [
      `Hi ${first},\n\nThis is a reminder that you have an outstanding balance of ${amt} owed to me. Please settle this at your earliest convenience through Spliiit.\n\nThank you,\n${senderName}`,
      `Hello ${first},\n\nI'm following up on an outstanding balance of ${amt}. Please arrange payment when possible.\n\nRegards,\n${senderName}`,
      `Hi ${first},\n\nA balance of ${amt} remains outstanding. Please action this as soon as possible — you can settle directly through Spliiit.\n\nThanks,\n${senderName}`,
    ],
    "passive-aggressive": [
      `Hey ${first}! No worries at all! Totally fine! Just wanted to casually mention that you still owe me ${amt}. No rush whatsoever. I'm sure you've just been super busy. Completely understandable. 😊\n\nThe Spliiit button is right there whenever you're ready. Take your time. I'll wait.\n\n— ${senderName} 🙂`,
      `Hi ${first}! Hope you're having a great day! Just popping in — completely unprompted and with zero passive aggression — to mention that ${amt} is still outstanding. But genuinely, no stress! It's fine. Everything is fine. 😊\n\n— ${senderName}`,
      `Hey ${first} 🙂 So I was just thinking about shared expenses. You know, just casually. For no particular reason. And I happened to remember that you owe me ${amt}. Weird how the mind works! Anyway. Spliiit link below. No pressure. At all.\n\n— ${senderName}`,
    ],
    awkward: [
      `Hey ${first}... okay so I genuinely debated sending this for like three days.\n\nBut you owe me ${amt} and it's gotten to the point where NOT saying something is somehow weirder than saying something. So. Here we are.\n\nSpliiit makes it easy — please click the button so we can both move on 😬\n\n— ${senderName} (this was hard for me too)`,
      `${first} I'm just gonna say it: you owe me ${amt} and I've been awkwardly waiting for you to bring it up first and you haven't and now it's been a while and I don't know how to bring it up in person anymore so I'm doing this instead 😅\n\nSpliiit button below. Let's never discuss this.\n\n— ${senderName}`,
      `Hey so... this is the message where I tell you that you owe me ${amt}. I hate that I'm sending this. You probably hate receiving it. But here we are, united in discomfort. Settle up on Spliiit and we can both pretend this never happened 😬\n\n— ${senderName}`,
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
