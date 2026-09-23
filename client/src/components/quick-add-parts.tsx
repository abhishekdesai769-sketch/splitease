/**
 * Building blocks shared by the dashboard quick-add pill (QuickAddBar) and its
 * "watch it work" demos (quick-add-demo), so both always look identical.
 */

// Frosted pill shell, shared by the resting/typing pill and the in-pill call.
export const PILL = "flex items-center gap-2 h-[60px] rounded-full pr-2 bg-card/60 backdrop-blur-2xl backdrop-saturate-150 border transition-colors shadow-[0_10px_30px_-12px_rgba(41,38,36,0.22),0_1px_4px_-1px_rgba(41,38,36,0.06),inset_0_1px_0_rgba(255,255,255,0.9)]";

export function PillButton({ children, label, tone, onClick, type = "button", testId }: {
  children: React.ReactNode; label: string; tone: "plain" | "live" | "ink";
  onClick?: () => void; type?: "button" | "submit"; testId?: string;
}) {
  const toneCls = tone === "ink" ? "bg-foreground text-background" : tone === "live" ? "bg-accent-foreground text-white" : "bg-card text-secondary-foreground";
  return (
    <button
      type={type}
      // Keep the input's focus (and the keyboard) when tapping a pill button.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={label}
      className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center transition-colors duration-200 ring-1 ring-black/[0.04] shadow-[0_2px_8px_-1px_rgba(41,38,36,0.16)] active:scale-[0.96] ${toneCls}`}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

// Animated equalizer (dictating, or Spliiit talking on a call).
export function Bars({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center justify-center gap-[2.5px] ${className}`} aria-hidden>
      <style>{`@keyframes qaBar{0%{transform:scaleY(.35)}100%{transform:scaleY(1)}}`}</style>
      {[8, 14, 19, 12, 7].map((h, i) => (
        <span key={i} style={{ width: 2.5, height: h, borderRadius: 9999, background: "currentColor", animation: `qaBar ${0.45 + i * 0.1}s ease-in-out ${i * 0.06}s infinite alternate` }} />
      ))}
    </span>
  );
}

// Static "sound lines" glyph for the talk-back button (matches AI Mode's AudioLines).
export function SpeakGlyph() {
  return (
    <span className="flex items-center gap-[2.5px]" aria-hidden>
      {[7, 13, 18, 12, 6].map((h, i) => <span key={i} style={{ width: 2, height: h, borderRadius: 9999, background: "currentColor" }} />)}
    </span>
  );
}


export function CardHead({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="w-7 h-7 rounded-[9px] bg-accent flex items-center justify-center"><Icon className="w-[15px] h-[15px] text-accent-foreground" /></span>
      <span className="text-[13px] text-secondary-foreground">{label}</span>
    </div>
  );
}

export function Chip({ children, icon: Icon, ghost, onClick }: { children: React.ReactNode; icon?: React.ComponentType<{ className?: string }>; ghost?: boolean; onClick?: () => void }) {
  const cls = `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] ${ghost ? "border border-dashed border-border text-muted-foreground" : "bg-accent/70 text-secondary-foreground"} ${onClick ? "active:scale-[0.97] transition-transform" : ""}`;
  const inner = <>{Icon && <Icon className="w-3.5 h-3.5" />}{children}</>;
  return onClick ? <button type="button" onClick={onClick} className={cls}>{inner}</button> : <span className={cls}>{inner}</span>;
}
