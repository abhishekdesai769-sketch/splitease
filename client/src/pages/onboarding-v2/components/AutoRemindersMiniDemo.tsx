/**
 * Auto-Reminders mini-demo — shown inside the paywall prime for the couple
 * persona. Renders an EMAIL PREVIEW with the exact copy Spliiit's real
 * sendAutoReminderEmail() produces, so the user sees precisely what their
 * friends would receive — including the "Why did you get this?" block.
 *
 * Source of truth: server/email.ts → sendAutoReminderEmail (friendly / firm /
 * funny tones). Sample values: recipient "Sam", owed to "Jordan", $42.00.
 * Tones limited to the three the product spec uses (friendly / firm / funny).
 */
import { useState } from "react";

type Tone = "friendly" | "firm" | "funny";

const TONES: { id: Tone; label: string }[] = [
  { id: "friendly", label: "Friendly" },
  { id: "firm", label: "Firm" },
  { id: "funny", label: "Funny" },
];

// Verbatim from server/email.ts sendAutoReminderEmail (first="Sam",
// owedToName="Jordan", amt="$42.00").
const SUBJECTS: Record<Tone, string> = {
  friendly: "👋 Friendly nudge from Spliiit — you owe Jordan money",
  firm: "Payment reminder: you have an outstanding balance with Jordan",
  funny: "Fun fact: you owe Jordan $42.00 😄",
};

const BODIES: Record<Tone, string> = {
  friendly:
    "Hey Sam! 👋\n\nSpliiit here — just a quick, friendly nudge that you have an outstanding balance of $42.00 with Jordan on the app.\n\nNo stress at all, but whenever you get a chance to settle up it would mean a lot! Tap the button below to sort it out in seconds.\n\n— Spliiit",
  firm:
    "Hi Sam,\n\nThis is an automated reminder from Spliiit that you have an outstanding balance of $42.00 owed to Jordan.\n\nPlease settle this at your earliest convenience using the button below.\n\nThank you,\nSpliiit",
  funny:
    "Hi Sam 😄\n\nFun fact: you owe Jordan $42.00. Less fun fact: it's been sitting there for a while. Even less fun fact: Spliiit just sent you this email about it.\n\nGood news though — settling up takes about 10 seconds flat. Then we can all move on with our lives. Deal?\n\n— Spliiit (comedy writer by night, balance tracker by day)",
};

export function AutoRemindersMiniDemo() {
  const [tone, setTone] = useState<Tone>("friendly");

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-3">
        Auto-Reminders · the exact email Spliiit sends for you
      </div>

      {/* Tone switcher */}
      <div className="grid grid-cols-3 gap-1.5 mb-3">
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

      {/* Email preview */}
      <div className="rounded-xl border border-border bg-background overflow-hidden">
        {/* Email subject */}
        <div className="px-3 py-2.5 border-b border-border bg-muted/30">
          <div className="text-[9px] uppercase tracking-wider font-mono text-muted-foreground">
            Subject
          </div>
          <div className="text-xs font-semibold mt-0.5 leading-snug">
            {SUBJECTS[tone]}
          </div>
        </div>

        {/* Outstanding balance block (matches the real email) */}
        <div className="px-3 pt-3">
          <div className="rounded-lg border border-border p-2.5">
            <div className="text-[10px] text-muted-foreground">Outstanding balance</div>
            <div className="text-xl font-bold leading-tight">$42.00</div>
            <div className="text-[11px] text-muted-foreground">
              owed to <span className="font-semibold text-foreground">Jordan</span>
            </div>
          </div>
        </div>

        {/* Email body */}
        <div className="px-3 py-3 text-xs leading-relaxed whitespace-pre-line text-foreground">
          {BODIES[tone]}
        </div>

        {/* Settle-up button (visual only) */}
        <div className="px-3 pb-3">
          <div className="rounded-lg bg-primary text-primary-foreground text-xs font-semibold text-center py-2">
            Settle up on Spliiit
          </div>
        </div>

        {/* "Why did you get this?" — verbatim from the real email */}
        <div className="px-3 pb-3">
          <div className="rounded-lg bg-muted/40 border border-border p-2.5">
            <div className="text-[11px] font-semibold mb-1">Why did you get this?</div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">Jordan</span> is a
              Spliiit Premium member. Spliiit sent this automatically on their
              behalf — they didn't personally message you and may not even know
              this landed in your inbox. No awkwardness needed. 😌
            </p>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-2.5">
        Pick the tone. Spliiit sends it on a schedule — from Spliiit, not you,
        so there's zero awkwardness.
      </p>
    </div>
  );
}
