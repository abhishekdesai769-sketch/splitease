/**
 * Screen 02 · Pain question
 * "What sucks the most about splitting with people?"
 *
 * 5 tappable cards. One-tap-to-advance — the tap IS the answer.
 * Stores the chosen pain point as `pain_persona` for later trial-end push
 * copy personalization.
 */
import { PAIN_POINTS, type PainPoint } from "../fixtures";
import { track } from "@/lib/analytics";

interface Props {
  onSelect: (pain: PainPoint) => void;
}

export function PainQuestionScreen({ onSelect }: Props) {
  const handleSelect = (pain: PainPoint) => {
    track("pain_question_answered", { pain_persona: pain });
    onSelect(pain);
  };

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full space-y-6">
      <div className="text-center space-y-2 pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          What sucks the most about splitting with people?
        </h1>
        <p className="text-sm text-muted-foreground">
          We'll tune the app to fix your version of it.
        </p>
      </div>

      <ul className="space-y-2.5" role="list">
        {PAIN_POINTS.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => handleSelect(p.id)}
              className="w-full text-left bg-card border border-border rounded-2xl p-4 flex items-center gap-3 hover:border-primary/40 hover:bg-card/80 active:scale-[0.98] transition-all"
              data-testid={`onboarding-v2-pain-${p.id}`}
            >
              <span className="text-2xl shrink-0" aria-hidden="true">{p.emoji}</span>
              <span className="text-sm font-medium leading-snug">{p.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
