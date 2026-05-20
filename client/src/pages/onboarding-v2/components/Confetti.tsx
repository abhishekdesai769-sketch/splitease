/**
 * Tiny confetti burst for the AI Scanner reveal. Pure CSS animation, no deps.
 *
 * Renders 14 colored dots that translate outward + fade over 1.2s. Auto-cleans
 * itself by accepting `show` + `onDone` so callers don't have to manage timers.
 */
import { useEffect, useState } from "react";

const COLORS = ["#0ea596", "#d97757", "#8b5cf6", "#f59e0b", "#ec4899", "#10b981", "#3b82f6"];
const COUNT = 14;

interface Props {
  show: boolean;
  onDone?: () => void;
}

export function Confetti({ show, onDone }: Props) {
  const [particles] = useState(() =>
    Array.from({ length: COUNT }).map((_, i) => ({
      id: i,
      color: COLORS[i % COLORS.length],
      // angle around a circle, randomized radius/duration slightly
      angle: (i / COUNT) * 360 + Math.random() * 10,
      distance: 80 + Math.random() * 60,
      delay: Math.random() * 100,
    }))
  );

  useEffect(() => {
    if (!show || !onDone) return;
    const t = setTimeout(onDone, 1200);
    return () => clearTimeout(t);
  }, [show, onDone]);

  if (!show) return null;

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-visible z-[60]">
      {particles.map((p) => {
        const rad = (p.angle * Math.PI) / 180;
        const dx = Math.cos(rad) * p.distance;
        const dy = Math.sin(rad) * p.distance;
        return (
          <span
            key={p.id}
            className="absolute w-2 h-2 rounded-full"
            style={{
              background: p.color,
              animation: `spliiit-confetti 1.2s ease-out ${p.delay}ms forwards`,
              ["--dx" as any]: `${dx}px`,
              ["--dy" as any]: `${dy}px`,
            }}
          />
        );
      })}
      <style>{`
        @keyframes spliiit-confetti {
          0%   { transform: translate(0, 0) scale(0.5); opacity: 0; }
          15%  { transform: translate(0, 0) scale(1);   opacity: 1; }
          100% { transform: translate(var(--dx), var(--dy)) scale(0.4); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
