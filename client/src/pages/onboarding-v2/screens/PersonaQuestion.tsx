/**
 * Screen 03 · Persona question
 * "Who do you usually split with?"
 *
 * 3 horizontal cards. The chosen persona drives:
 *   - The demo group + members + expenses (Screen 04)
 *   - The Premium feature primed at peak desire (Screen 05)
 *   - The pre-filled invite copy (Screen 08)
 *   - The Day 25/28/30 trial-end push templates
 */
import { PERSONAS, type Persona } from "../fixtures";
import { track } from "@/lib/analytics";

interface Props {
  onSelect: (persona: Persona) => void;
}

export function PersonaQuestionScreen({ onSelect }: Props) {
  const handleSelect = (persona: Persona) => {
    track("persona_selected", { persona });
    onSelect(persona);
  };

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full space-y-6">
      <div className="text-center space-y-2 pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Who do you usually split with?
        </h1>
        <p className="text-sm text-muted-foreground">
          Pick the most common — we'll set up your first split around it.
        </p>
      </div>

      <ul className="space-y-3" role="list">
        {PERSONAS.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => handleSelect(p.id)}
              className="w-full text-left bg-card border border-border rounded-2xl p-5 flex items-start gap-4 hover:border-primary/40 hover:bg-card/80 active:scale-[0.98] transition-all"
              data-testid={`onboarding-v2-persona-${p.id}`}
            >
              <span className="text-3xl shrink-0 leading-none" aria-hidden="true">{p.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-base mb-0.5">{p.label}</div>
                <div className="text-xs text-muted-foreground leading-snug">
                  {p.tagline}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
