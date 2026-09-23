/**
 * BottomFade — the frosted fade the bottom nav (and the dashboard's quick-add
 * pill) sit on. Content scrolling underneath softens and blurs out with no
 * visible edge anywhere, instead of being cut by a solid bar with a border.
 *
 * Two parts, both feathered so neither has a hard top edge:
 *  - Progressive blur: stacked backdrop-filter layers, each masked to a band,
 *    getting stronger toward the bottom (a single masked blur layer still
 *    shows a seam where the blur starts).
 *  - Colour: an eased gradient into the canvas colour — many stops along an
 *    ease-in-out curve, since a plain 2-stop gradient shows a visible band.
 */

const BLUR_LAYERS = [
  { blur: 0.5, from: 0, to: 30 },
  { blur: 1.5, from: 12, to: 48 },
  { blur: 3, from: 28, to: 66 },
  { blur: 6, from: 45, to: 84 },
  { blur: 12, from: 62, to: 100 },
];

const MAX_ALPHA = 0.94;
const colourStops = Array.from({ length: 13 }, (_, i) => {
  const t = i / 12;
  const eased = t * t * (3 - 2 * t); // smoothstep
  return `hsl(var(--background) / ${(eased * MAX_ALPHA).toFixed(3)}) ${Math.round(t * 100)}%`;
}).join(", ");

export function BottomFade({ height }: { height: string }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 bottom-0 z-30" style={{ height }}>
      {BLUR_LAYERS.map(({ blur, from, to }) => {
        // Feathered band: fades in from `from`, fully on by the midpoint, and
        // stays on to the bottom so the layers accumulate toward the nav.
        const mid = from + (to - from) / 2;
        const mask = `linear-gradient(to bottom, transparent ${from}%, #000 ${mid}%, #000 100%)`;
        return (
          <div
            key={blur}
            className="absolute inset-0"
            style={{
              backdropFilter: `blur(${blur}px)`,
              WebkitBackdropFilter: `blur(${blur}px)`,
              maskImage: mask,
              WebkitMaskImage: mask,
            }}
          />
        );
      })}
      <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, ${colourStops})` }} />
    </div>
  );
}
