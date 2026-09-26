import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Elements that share a `syncGroup` all render at the smallest fitted size
// among them, so side-by-side numbers (e.g. the two balance cards) match.
const syncGroups = new Map<string, Set<HTMLElement>>();

/** Largest font size (≤ max, ≥ min) at which `el`'s text fits its own width. */
function fittedSize(el: HTMLElement, max: number, min: number): number {
  el.style.fontSize = `${max}px`;
  const avail = el.clientWidth;
  const need = el.scrollWidth;
  if (avail <= 0 || need <= avail) return max;
  return Math.max(min, Math.floor((max * avail) / need));
}

/**
 * Single-line text that shrinks its font size to fit its box instead of
 * overflowing — for big numbers (balances) in narrow cards. Renders at `max`
 * px whenever it fits; scales down proportionally (never below `min`) only
 * when the value is too wide for the space it's given. Re-fits on resize and
 * once web fonts finish loading (their widths differ from the fallback).
 */
export function FitText({
  children,
  max,
  min = 12,
  syncGroup,
  className,
  ...rest
}: {
  children: ReactNode;
  max: number;
  min?: number;
  syncGroup?: string;
  className?: string;
} & HTMLAttributes<HTMLSpanElement>) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const members = syncGroup
      ? syncGroups.get(syncGroup) ?? syncGroups.set(syncGroup, new Set()).get(syncGroup)!
      : new Set<HTMLElement>();
    members.add(el);

    const fit = () => {
      const size = Math.min(...Array.from(members, (m) => fittedSize(m, max, min)));
      members.forEach((m) => { m.style.fontSize = `${size}px`; });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    document.fonts?.ready.then(fit).catch(() => {});
    return () => {
      ro.disconnect();
      members.delete(el);
      if (syncGroup && members.size === 0) syncGroups.delete(syncGroup);
    };
  }, [children, max, min, syncGroup]);

  return (
    <span
      ref={ref}
      className={cn("block w-full whitespace-nowrap overflow-hidden", className)}
      style={{ fontSize: max }}
      {...rest}
    >
      {children}
    </span>
  );
}
