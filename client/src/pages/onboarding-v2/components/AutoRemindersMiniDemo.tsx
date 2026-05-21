/**
 * Auto-Reminders mini-demo — shown inside the paywall prime for the couple
 * persona. An interactive tone switcher: tapping friendly / firm / funny
 * swaps the reminder message so the user feels the feature.
 */
import { useState } from "react";

type Tone = "friendly" | "firm" | "funny";

const TONES: { id: Tone; label: string }[] = [
  { id: "friendly", label: "Friendly" },
  { id: "firm", label: "Firm" },
  { id: "funny", label: "Funny" },
];

const MESSAGES: Record<Tone, string> = {
  friendly:
    "Hey! Gentle nudge — your $42 from Friday takeout whenever you get a sec 🙂",
  firm:
    "Reminder: your $42 share of Friday takeout is now 5 days overdue. Please settle up.",
  funny:
    "The $42 you owe me has started paying rent in my head. Time to evict it 😭",
};

export function AutoRemindersMiniDemo() {
  const [tone, setTone] = useState<Tone>("friendly");

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-3">
        Auto-Reminders · Spliiit messages them for you
      </div>

      {/* Chat bubble preview */}
      <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 mb-3 min-h-[76px] flex items-center">
        <p className="text-sm leading-relaxed">{MESSAGES[tone]}</p>
      </div>

      {/* Tone switcher */}
      <div className="grid grid-cols-3 gap-1.5">
        {TONES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTone(t.id)}
            className={`py-2 rounded-lg border text-xs font-medium transition-colors ${
              tone === t.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted/50"
            }`}
            data-testid={`paywall-tone-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground mt-2.5">
        Pick the tone. Spliiit sends it on a schedule — you never have to ask.
      </p>
    </div>
  );
}
