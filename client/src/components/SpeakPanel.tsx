/**
 * SpeakPanel — the hands-free "Speak" view of AI Mode.
 *
 * A single mic button drives a live Vapi voice call (mic + STT + TTS handled by
 * Vapi; the split logic is our backend runAiTurn). Shows call status and a live
 * transcript. Chat mode is unaffected — the parent toggles between the two.
 */
import { Mic, Loader2, Square, AlertCircle } from "lucide-react";
import { useVapiVoice } from "@/hooks/useVapiVoice";

const EXAMPLES = [
  "“I paid 40 for dinner, split with Nikhil and Krish.”",
  "“Groceries 60 bucks, split evenly with the roommates.”",
  "“I covered Katie’s 25 dollar cab — she owes me the whole thing.”",
];

export function SpeakPanel({ onExpenseCreated, iosQs }: { onExpenseCreated?: () => void; iosQs?: string }) {
  const { status, transcript, error, start, stop } = useVapiVoice({ onExpenseCreated, iosQs });
  const live = status === "active" || status === "connecting" || status === "ending";
  const onTap = () => { if (live) stop(); else start(); };

  const label =
    status === "connecting" ? "Connecting…"
    : status === "active" ? "Listening — tap to stop"
    : status === "ending" ? "Ending…"
    : status === "error" ? "Tap to try again"
    : "Tap to speak";

  return (
    <div className="flex flex-col items-center text-center px-4 py-6 gap-5">
      {/* Mic button */}
      <button
        onClick={onTap}
        aria-label={live ? "Stop voice" : "Start voice"}
        className={[
          "relative w-28 h-28 rounded-full flex items-center justify-center transition-all",
          "focus:outline-none focus-visible:outline-none",
          status === "active"
            ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30"
            : status === "error"
              ? "bg-red-500/10 text-red-500 border border-red-500/40"
              : "bg-primary/10 text-primary border border-primary/30 hover:bg-primary/15",
        ].join(" ")}
        data-testid="speak-mic"
      >
        {status === "active" && (
          <span className="absolute inset-0 rounded-full bg-primary/20 animate-ping" aria-hidden />
        )}
        {status === "connecting" || status === "ending"
          ? <Loader2 className="w-10 h-10 animate-spin" />
          : status === "active"
            ? <Square className="w-9 h-9" />
            : <Mic className="w-10 h-10" />}
      </button>

      <p className="text-sm font-medium text-foreground">{label}</p>

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-red-500">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      {/* Live transcript */}
      {transcript.length > 0 ? (
        <div className="w-full max-w-md space-y-2 text-left">
          {transcript.map((l, i) => (
            <div key={i} className={l.role === "assistant" ? "text-foreground" : "text-muted-foreground"}>
              <span className="text-[11px] uppercase tracking-wide mr-2 opacity-60">
                {l.role === "assistant" ? "Spliiit" : "You"}
              </span>
              <span className="text-sm">{l.text}</span>
            </div>
          ))}
        </div>
      ) : (
        status === "idle" && (
          <div className="w-full max-w-md space-y-1.5">
            <p className="text-xs text-muted-foreground mb-1">Try saying:</p>
            {EXAMPLES.map((ex, i) => (
              <p key={i} className="text-xs text-muted-foreground/80 italic">{ex}</p>
            ))}
          </div>
        )
      )}

      <p className="text-[11px] text-muted-foreground/70 max-w-xs">
        Voice reads each split back before saving. Prefer typing? Switch to Chat above.
      </p>
    </div>
  );
}
