/**
 * Screen 10 · Create your first REAL group — "what are you splitting".
 *
 * This is where the user leaves the demo behind and sets up their actual
 * first group, exactly like the real first-run wizard. Nothing from the demo
 * carries over — the demo was only ever a teaching tool.
 *
 * PREVIEW NOTE: "Create group" doesn't hit the API — it just advances. Real
 * group creation is wired at cutover.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UsersRound } from "lucide-react";
import { track } from "@/lib/analytics";

interface Props {
  onCreate: (groupName: string) => void;
}

const SUGGESTIONS = ["Weekend trip", "Apartment", "Date nights", "Road trip"];

export function CreateGroupScreen({ onCreate }: Props) {
  const [name, setName] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    track("first_group_created", { from: "onboarding_v2" });
    onCreate(trimmed);
  };

  return (
    <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
      <div className="flex-1 flex flex-col justify-center space-y-6">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10">
            <UsersRound className="w-8 h-8 text-primary" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-2xl font-semibold tracking-tight">
              What are you splitting?
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
              Name your first real group — a trip, your apartment, a recurring
              crew. You can invite people right after.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="onboarding-v2-group-name">Group name</Label>
            <Input
              id="onboarding-v2-group-name"
              placeholder="e.g. Goa Trip"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              data-testid="onboarding-v2-group-name"
            />
          </div>

          {/* Suggestion chips */}
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setName(s)}
                className="text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
              >
                {s}
              </button>
            ))}
          </div>

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={!name.trim()}
            data-testid="onboarding-v2-create-group-submit"
          >
            Create group
          </Button>
        </form>
      </div>
    </div>
  );
}
