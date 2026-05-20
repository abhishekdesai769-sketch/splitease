/**
 * Tiny avatar component for the demo flow. Just a colored circle with the
 * member's first initial. Used in the demo group's members row and as the
 * assignment chips in the AI Scanner.
 *
 * Lives inside onboarding-v2/components/ on purpose — kept separate from
 * the real app's avatar code so refactors there can never break the demo.
 */
interface AvatarProps {
  name: string;
  color: string;
  size?: "xs" | "sm" | "md";
  isYou?: boolean;
  active?: boolean;   // for assignment chips — adds a ring + saturated color
  onClick?: () => void;
}

const SIZE_MAP = {
  xs: "w-7 h-7 text-[10px]",
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
};

export function Avatar({ name, color, size = "sm", isYou, active, onClick }: AvatarProps) {
  const initial = isYou ? "Y" : name.charAt(0).toUpperCase();
  const isInteractive = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!isInteractive}
      className={`${SIZE_MAP[size]} rounded-full font-semibold text-white shrink-0 flex items-center justify-center transition-all ${
        active ? "ring-2 ring-primary scale-105" : "opacity-90 hover:opacity-100"
      } ${isInteractive ? "cursor-pointer active:scale-95" : "cursor-default"}`}
      style={{ background: active ? color : `${color}cc` }}
      aria-label={isYou ? "You" : name}
      title={isYou ? "You" : name}
    >
      {initial}
    </button>
  );
}
