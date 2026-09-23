/**
 * "Watch it work" demos for the quick-add pill: made-up examples that type
 * themselves and build the REAL card via the real parser.
 *
 * Used in two places, so they always look exactly like the product:
 *  - the dashboard pill, while it's open and empty (QuickAddBar)
 *  - the What's New tour, as small live "videos" (WhatsNewQuickAdd):
 *    TypeScene, DictateScene and CallScene.
 *
 * Made-up people and groups only: this plays on screen (and in screenshots and
 * screen recordings), so it must never use the user's real friends or groups.
 * Cards only advance when a word finishes and stay still otherwise; per-letter
 * rebuilds made iOS repaint the blur behind them (flicker).
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeftRight, ArrowRight, ArrowUp, CalendarDays, Check, Mic, Receipt, Scale, Users2, Wallet, X } from "lucide-react";
import { formatMoney } from "@/components/CurrencySelector";
import { AMOUNT_IN_CLASS, AMOUNT_OUT_CLASS } from "@/lib/balance-display";
import { parseQuickAdd } from "@/lib/quickAddParser";
import { Bars, CardHead, Chip, SpeakGlyph } from "@/components/quick-add-parts";

// ── Made-up world ────────────────────────────────────────────────────────────
const DEMO_ME = "__demo_me__";
const DEMO_PEOPLE = [
  { id: "__maya__", name: "Maya", color: "#A6674A" },
  { id: "__leo__", name: "Leo", color: "#7A3E32" },
  { id: "__sam__", name: "Sam", color: "#8C5A3C" },
  { id: "__jordan__", name: "Jordan", color: "#9A4A2A" },
  { id: "__ava__", name: "Ava", color: "#B04A34" },
];
const DEMO_CTX = {
  meId: DEMO_ME,
  friends: DEMO_PEOPLE.slice(0, 4),
  people: DEMO_PEOPLE,
  groups: [{ id: "__ski__", name: "Ski crew", memberIds: [DEMO_ME, "__maya__", "__sam__", "__jordan__", "__ava__"] }],
};
const DEMO_BALANCES: Record<string, number> = { "__jordan__": -35, "__maya__": 48 }; // + = they owe you

export const DEMO_PHRASES = [
  "sushi night 96 with maya and leo",
  "cabin weekend 900 ski crew",
  "sam paid 64 for tacos",
  "paid jordan back 35",
  "what does maya owe",
];
export type DemoKind = "expense" | "settle" | "balance";
// What each example becomes, so a half-typed phrase still shows the right empty card.
export const DEMO_KINDS: DemoKind[] = ["expense", "expense", "expense", "settle", "balance"];

const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// ── Typing loop (pill + What's New slide 1) ──────────────────────────────────
/**
 * Types each example into the pill, holds it, deletes it, moves on.
 * - `typed`: what the pill shows (letter by letter).
 * - `card`: what the card is built from. It only advances at word boundaries
 *   and stays frozen while the pill deletes.
 * - `visible`: false briefly between examples so the card fades out and in.
 * Static for reduced motion.
 */
export type DemoState = { index: number; typed: string; card: string; visible: boolean };
export function useDemoLoop(phrases: string[], active: boolean): DemoState {
  const [state, setState] = useState<DemoState>({ index: 0, typed: "", card: "", visible: true });
  useEffect(() => {
    setState({ index: 0, typed: "", card: "", visible: true });
    if (!active) return;
    if (prefersReducedMotion()) {
      setState({ index: 0, typed: phrases[0], card: phrases[0], visible: true });
      return;
    }
    let cancelled = false;
    const timers: number[] = [];
    const later = (ms: number) => new Promise<void>((r) => { timers.push(window.setTimeout(r, ms)); });
    (async () => {
      await later(450);
      for (let k = 0; !cancelled; k = (k + 1) % phrases.length) {
        const phrase = phrases[k];
        let card = "";
        setState({ index: k, typed: "", card, visible: true });
        for (let i = 1; i <= phrase.length && !cancelled; i++) {
          const typed = phrase.slice(0, i);
          if (phrase[i] === " " || i === phrase.length) card = typed; // a word just finished
          setState({ index: k, typed, card, visible: true });
          await later(phrase[i - 1] === " " ? 110 : 62);
        }
        await later(2600);
        for (let i = phrase.length - 1; i >= 0 && !cancelled; i--) {
          setState({ index: k, typed: phrase.slice(0, i), card, visible: true });
          await later(16);
        }
        setState({ index: k, typed: "", card, visible: false }); // fade the card out
        await later(280);
      }
    })();
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [active, phrases]);
  return state;
}

/** Runs a scripted scene on a loop until unmounted; shows `final` for reduced motion. */
function useScene<S>(initial: S, final: S, script: (set: (s: S) => void, later: (ms: number) => Promise<void>) => Promise<void>): S {
  const [state, setState] = useState<S>(initial);
  useEffect(() => {
    if (prefersReducedMotion()) { setState(final); return; }
    let cancelled = false;
    const timers: number[] = [];
    const later = (ms: number) => new Promise<void>((r) => { timers.push(window.setTimeout(r, ms)); });
    const set = (s: S) => { if (!cancelled) setState(s); };
    (async () => { while (!cancelled) await script(set, later); })();
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}

// ── The example card (same look as the real one) ─────────────────────────────
/**
 * One example, rendered like the real card, built from the (half-typed) phrase
 * by the real parser against the made-up people above. Read-only.
 */
export function ExampleCard({ phrase, kind: fallbackKind, currency, tag, footer }: {
  phrase: string;
  kind: DemoKind;
  currency?: string | null;
  tag?: React.ReactNode;     // top-right, e.g. "Example 1 of 5" or "Looks right"
  footer?: React.ReactNode;
}) {
  const money = (n: number) => formatMoney(n, currency);
  const person = (id: string) => DEMO_PEOPLE.find((p) => p.id === id);
  const nameOf = (id: string) => (id === DEMO_ME ? "You" : person(id)?.name ?? "");
  // A plain render function, not a component: a component defined in here would
  // be a new type every render, remounting (and re-animating) each avatar.
  const av = (id: string) => (
    <span key={id} className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[13px] font-serif ring-2 ring-background animate-in zoom-in-75 fade-in-0 duration-200" style={{ backgroundColor: id === DEMO_ME ? "#292624" : person(id)?.color }}>
      {nameOf(id).charAt(0)}
    </span>
  );

  const parsed = parseQuickAdd(phrase, DEMO_CTX);
  const kind = parsed && parsed.type !== "unknown" ? parsed.type : fallbackKind;

  const head = (icon: React.ComponentType<{ className?: string }>, label: string) => (
    <div className="flex items-start justify-between gap-2">
      <CardHead icon={icon} label={label} />
      {tag}
    </div>
  );

  if (kind === "settle") {
    const s = parsed?.type === "settle" ? parsed : null;
    const bal = s ? DEMO_BALANCES[s.friendId] ?? 0 : 0;
    return (
      <div className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300" data-testid="quick-add-example">
        {head(ArrowLeftRight, "Settle up")}
        <div className="rounded-2xl bg-background px-3.5 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[15px] min-w-0">
            {av(DEMO_ME)}
            <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
            {s ? <>{av(s.friendId)}<span className="truncate">You paid {nameOf(s.friendId)}</span></> : <span className="text-muted-foreground">Who did you pay?</span>}
          </div>
          <p className="font-mono tabular-nums text-[24px] shrink-0">{s?.amount ? money(s.amount) : <span className="text-muted-foreground">—</span>}</p>
        </div>
        {s && bal < 0 && <p className="text-xs text-muted-foreground mt-2 px-1">You owe {nameOf(s.friendId)} {money(Math.abs(bal))} in total.</p>}
        {footer}
      </div>
    );
  }

  if (kind === "balance") {
    const b = parsed?.type === "balance" ? parsed : null;
    const bal = b?.personId ? DEMO_BALANCES[b.personId] ?? 0 : 0;
    return (
      <div className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300" data-testid="quick-add-example">
        {head(Scale, "Balance")}
        <div className="rounded-2xl bg-background px-3.5 py-3 flex items-center gap-3">
          {b?.personId ? (
            <>
              {av(b.personId)}
              <p className="flex-1 text-[15px]">{bal > 0 ? `${nameOf(b.personId)} owes you` : `You owe ${nameOf(b.personId)}`}</p>
              <p className={`font-mono tabular-nums text-[24px] ${bal > 0 ? AMOUNT_IN_CLASS : AMOUNT_OUT_CLASS}`}>{money(Math.abs(bal))}</p>
            </>
          ) : (
            <p className="flex-1 text-[15px] text-muted-foreground py-1">Ask about anyone…</p>
          )}
        </div>
        {footer}
      </div>
    );
  }

  const e = parsed?.type === "expense" ? parsed : null;
  const splitIds = e?.splitIds ?? [DEMO_ME];
  const ready = !!e?.amount && splitIds.length > 1;
  const group = e?.groupId ? DEMO_CTX.groups.find((g) => g.id === e.groupId) : null;
  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300" data-testid="quick-add-example">
      {head(Receipt, "Expense")}
      <p className={`font-serif text-[26px] leading-[1.1] mb-2.5 ${e?.description ? "" : "text-muted-foreground"}`}>{e?.description ?? "Add a description"}</p>
      <div className="flex flex-wrap gap-1.5 mb-3.5">
        {e?.amount ? <Chip><span className="font-mono tabular-nums">{money(e.amount)}</span></Chip> : <Chip ghost>+ Amount</Chip>}
        {e && e.payerId !== DEMO_ME
          ? <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] bg-[#E3EEE6] text-[#2F5E43]"><Wallet className="w-3.5 h-3.5" />Paid by {nameOf(e.payerId)}</span>
          : <Chip icon={Wallet}>Paid by you</Chip>}
        {group && <Chip icon={Users2}>{group.name}</Chip>}
        <Chip icon={CalendarDays}>Today</Chip>
      </div>
      <div className="rounded-2xl bg-background px-3.5 py-3">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground mb-2">Split equally · {splitIds.length}</p>
            <div className="flex flex-wrap gap-1.5">{splitIds.map(av)}</div>
            <p className="text-[11px] text-muted-foreground mt-1.5 truncate">{splitIds.map(nameOf).join(", ")}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[11px] text-muted-foreground">Each pays</p>
            <p className="font-mono tabular-nums text-[24px] leading-tight">{ready ? money(e!.amount! / splitIds.length) : <span className="text-muted-foreground">—</span>}</p>
          </div>
        </div>
      </div>
      {footer}
    </div>
  );
}

// ── What's New stage + miniature pill ────────────────────────────────────────
// Scenes are laid out at real size and scaled down to fit the sheet, so they
// are pixel-for-pixel the real UI. No backdrop blur inside (nothing to blur,
// and it keeps iOS from repainting while the text types).
const STAGE_W = 380;
const STAGE_H = 410;

function DemoStage({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.85);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / STAGE_W));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    // text-left: the sheet around it centres its text; the real card doesn't.
    <div ref={ref} aria-hidden className="relative w-full overflow-hidden rounded-2xl bg-background text-left" style={{ height: STAGE_H * scale }}>
      <div className="absolute left-0 top-0" style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {/* The softened dashboard the pill sits over in the app. A static CSS
            blur (drawn once), not a backdrop blur, so nothing repaints as the
            scene types. */}
        <div className="absolute inset-0 px-5 pt-5 opacity-45 blur-[5px] pointer-events-none">
          <p className="font-serif text-[30px] leading-none">Hey, <em className="italic text-accent-foreground">there</em></p>
          <div className="grid grid-cols-2 gap-3 mt-5">
            <div className="h-[74px] rounded-2xl bg-foreground" />
            <div className="h-[74px] rounded-2xl bg-foreground" />
            <div className="h-[64px] rounded-2xl bg-card border border-border" />
            <div className="h-[64px] rounded-2xl bg-card border border-border" />
          </div>
          <div className="mt-5 space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-accent-foreground/70" />
                <div className="h-3 w-28 rounded bg-muted-foreground/50" />
                <div className="ml-auto h-3 w-16 rounded bg-foreground/60" />
              </div>
            ))}
          </div>
        </div>
        <div className="absolute inset-0 bg-background/45" />
        <div className="relative h-full flex flex-col justify-end gap-3 p-3.5">
          {children}
        </div>
      </div>
    </div>
  );
}

function CardShell({ children, visible = true }: { children: React.ReactNode; visible?: boolean }) {
  return (
    <div className={`rounded-[24px] border border-card-border bg-card p-4 shadow-[0_18px_48px_-16px_rgba(41,38,36,0.32),0_2px_8px_-2px_rgba(41,38,36,0.08)] transition-opacity duration-200 ${visible ? "opacity-100" : "opacity-0"}`}>
      {children}
    </div>
  );
}

const MINI_PILL = "flex items-center gap-2 h-[60px] rounded-full pr-2 bg-card border shadow-[0_10px_30px_-12px_rgba(41,38,36,0.22),0_1px_4px_-1px_rgba(41,38,36,0.06),inset_0_1px_0_rgba(255,255,255,0.9)]";

function Circle({ tone = "plain", className = "", children }: { tone?: "plain" | "live" | "ink"; className?: string; children: React.ReactNode }) {
  const toneCls = tone === "ink" ? "bg-foreground text-background" : tone === "live" ? "bg-accent-foreground text-white" : "bg-card text-secondary-foreground";
  return (
    <span className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center transition-colors duration-200 ring-1 ring-black/[0.04] shadow-[0_2px_8px_-1px_rgba(41,38,36,0.16)] ${toneCls} ${className}`}>
      {children}
    </span>
  );
}

const Caret = () => <span className="inline-block w-[1.5px] h-[22px] bg-accent-foreground align-[-3px] ml-px animate-pulse" />;

/** The pill at rest or typing: text (tail-trimmed like a scrolled input), mic, send/speak. */
function MiniPill({ text, caret, listening, send }: { text: string; caret?: boolean; listening?: boolean; send?: boolean }) {
  const shown = text.length > 25 ? "…" + text.slice(-24) : text;
  return (
    <div className={`${MINI_PILL} pl-6 ${text || listening ? "border-accent-foreground/40" : "border-white/90"}`}>
      <p className={`flex-1 min-w-0 whitespace-nowrap overflow-hidden font-serif text-[22px] ${text ? "text-foreground" : "italic text-muted-foreground"}`}>
        {shown || "Tell Spliiit anything…"}{caret && <Caret />}
      </p>
      <Circle tone={listening ? "live" : "plain"}>{listening ? <Bars /> : <Mic className="w-[19px] h-[19px]" strokeWidth={1.75} />}</Circle>
      {!listening && <Circle tone={send ? "ink" : "plain"}>{send ? <ArrowUp className="w-[18px] h-[18px]" strokeWidth={2} /> : <SpeakGlyph />}</Circle>}
    </div>
  );
}

/** The pill during a talk-back call: one live line, level bars, end button. */
function MiniCallPill({ line, talking }: { line: string; talking: boolean }) {
  return (
    <div className={`${MINI_PILL} pl-5 border-accent-foreground/40`}>
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-full bg-accent-foreground opacity-60 animate-ping" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent-foreground" />
      </span>
      <p className="flex-1 min-w-0 font-serif italic text-[18px] leading-tight text-secondary-foreground line-clamp-2">{line}</p>
      <Circle className="text-accent-foreground">{talking ? <Bars /> : <SpeakGlyph />}</Circle>
      <Circle tone="ink"><X className="w-[18px] h-[18px]" strokeWidth={2} /></Circle>
    </div>
  );
}

const isReady = (phrase: string) => {
  const p = parseQuickAdd(phrase, DEMO_CTX);
  return p?.type === "expense" && !!p.amount && p.splitIds.length > 1;
};

// ── Scenes ───────────────────────────────────────────────────────────────────
const TYPE_PHRASES = DEMO_PHRASES.slice(0, 3);

/** Slide 1: type it. Same loop and card as the dashboard pill. */
export function TypeScene({ currency }: { currency?: string | null }) {
  const d = useDemoLoop(TYPE_PHRASES, true);
  return (
    <DemoStage>
      {d.card && (
        <CardShell visible={d.visible}>
          <ExampleCard key={d.index} phrase={d.card} kind="expense" currency={currency} />
        </CardShell>
      )}
      <MiniPill text={d.typed} caret send={d.typed === TYPE_PHRASES[d.index] && isReady(d.typed)} />
    </DemoStage>
  );
}

const DICTATED = "coffee 18 with sam";
type DictateState = { words: number; listening: boolean; visible: boolean };

/** Slide 2: say it. The mic listens, words arrive one at a time, the card builds. */
export function DictateScene({ currency }: { currency?: string | null }) {
  const words = DICTATED.split(" ");
  const s = useScene<DictateState>(
    { words: 0, listening: false, visible: true },
    { words: words.length, listening: false, visible: true },
    async (set, later) => {
      set({ words: 0, listening: false, visible: true });
      await later(900);
      set({ words: 0, listening: true, visible: true });
      await later(700);
      for (let i = 1; i <= words.length; i++) {
        set({ words: i, listening: true, visible: true });
        await later(340);
      }
      await later(450);
      set({ words: words.length, listening: false, visible: true });
      await later(2600);
      set({ words: words.length, listening: false, visible: false });
      await later(300);
    },
  );
  const text = words.slice(0, s.words).join(" ");
  return (
    <DemoStage>
      {text && (
        <CardShell visible={s.visible}>
          <ExampleCard phrase={text} kind="expense" currency={currency} />
        </CardShell>
      )}
      <MiniPill text={text} listening={s.listening} send={!s.listening && isReady(text)} />
      <p className={`-mt-1 text-center text-[12px] text-muted-foreground transition-opacity ${s.listening ? "opacity-100" : "opacity-0"}`}>Listening… tap the mic to stop</p>
    </DemoStage>
  );
}

const CALL_PHRASE = "dinner 180 with maya and leo";
type CallState = { inCall: boolean; line: string; talking: boolean; card: boolean; pressed: boolean };

/**
 * Slide 3: talk it through (~12s). The pill becomes the call, shows one line at
 * a time, the card appears with Jev's "Looks right", it's added, Spliiit asks if
 * there's anything else, and hangs up.
 */
export function CallScene({ currency }: { currency?: string | null }) {
  const s = useScene<CallState>(
    { inCall: false, line: "", talking: false, card: false, pressed: false },
    { inCall: true, line: "Sixty each. Tap add if it looks right.", talking: false, card: true, pressed: false },
    async (set, later) => {
      let st: CallState = { inCall: false, line: "", talking: false, card: false, pressed: false };
      const put = (patch: Partial<CallState>) => { st = { ...st, ...patch }; set(st); };
      const say = async (text: string, wordMs: number) => {
        const w = text.split(" ");
        for (let i = 1; i <= w.length; i++) { put({ line: w.slice(0, i).join(" "), talking: true }); await later(wordMs); }
        put({ talking: false });
      };
      put({ inCall: false, line: "", card: false, pressed: false });
      await later(700);
      put({ inCall: true, line: "Connecting…" });
      await later(700);
      await say("What are we splitting today?", 150);   // Spliiit
      await later(500);
      await say("Dinner, 180, with Maya and Leo", 230); // you
      await later(300);
      put({ line: "Working out the split…" });
      await later(700);
      put({ card: true });
      await say("Sixty each. Tap add if it looks right.", 150);
      await later(700);
      put({ pressed: true });
      await later(220);
      put({ pressed: false, card: false });
      await say("Saved! Anything else?", 150);
      await later(500);
      await say("Nope, that's all.", 230);
      await later(300);
      await say("Talk soon!", 150);
      await later(900);
      put({ inCall: false, line: "" });
      await later(400);
    },
  );
  return (
    <DemoStage>
      {s.card && (
        <CardShell>
          <ExampleCard
            phrase={CALL_PHRASE}
            kind="expense"
            currency={currency}
            tag={<span className="inline-flex items-center gap-1 rounded-full bg-[#E3EEE6] px-2.5 py-1 text-[12px] text-[#2F5E43]"><Check className="w-3.5 h-3.5" />Looks right</span>}
            footer={
              <div className="flex justify-between items-center mt-3.5">
                <span className="text-[13px] text-muted-foreground px-1">Not quite</span>
                <span className={`h-9 inline-flex items-center rounded-full px-4 text-[13px] font-medium bg-foreground text-background transition-transform duration-150 ${s.pressed ? "scale-95" : ""}`}>Add expense</span>
              </div>
            }
          />
        </CardShell>
      )}
      {s.inCall ? <MiniCallPill line={s.line} talking={s.talking} /> : <MiniPill text="" />}
    </DemoStage>
  );
}
