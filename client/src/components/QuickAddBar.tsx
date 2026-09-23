/**
 * QuickAddBar — the dashboard's floating "type it, it becomes a card" input.
 *
 * A frosted pill docked just above the bottom nav. As you type, a live card
 * grows out of it (expense / settle up / balance), parsed on-device by
 * quickAddParser — no network, no AI cost. The card is the source of truth:
 * whatever it shows (payer, who's in the split) is exactly what gets saved,
 * including any taps the user made on it after typing.
 *
 * Anything the parser can't read falls back to AI Mode (/ai), which this bar
 * replaces as the dashboard entry point.
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Mic, Loader2, X, Check, ArrowUp, Receipt, ArrowLeftRight, Scale, Users2, CalendarDays, Wallet, ArrowRight } from "lucide-react";
import type { Group, SafeUser } from "@shared/schema";
import { useAuth } from "@/lib/auth";
import { apiFormRequest, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useKeyboardOpen } from "@/hooks/use-keyboard-open";
import { track } from "@/lib/analytics";
import { formatMoney } from "@/components/CurrencySelector";
import { AMOUNT_IN_CLASS, AMOUNT_OUT_CLASS } from "@/lib/balance-display";
import { parseQuickAdd, type QuickIntent } from "@/lib/quickAddParser";
import { useVoiceMode } from "@/hooks/useVoiceMode";
import { useVoiceCall, WEAK_LABEL } from "@/hooks/use-voice-call";

export interface QuickAddBalance { personId: string; amount: number } // + = they owe you

interface QuickAddBarProps {
  friends: SafeUser[];
  groups: Group[];
  people: SafeUser[];               // friends + group members, for names
  balances: QuickAddBalance[];
  avatarColor: (id: string) => string;
}

export interface QuickAddBarHandle { focus: () => void }

export const QuickAddBar = forwardRef<QuickAddBarHandle, QuickAddBarProps>(function QuickAddBar(
  { friends, groups, people, balances, avatarColor },
  ref,
) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const keyboardOpen = useKeyboardOpen();
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);       // card / hints showing
  const [callOn, setCallOn] = useState(false);   // talk-back call running in the pill
  const currency = user?.defaultCurrency;

  // ── Dictation (mic): the phone's own speech recognition, free for everyone.
  // Words stream into the pill and the card builds from them exactly like typing.
  const voiceCtx = useMemo(() => ({ currentUserId: user?.id ?? "", friends: [], groups: [], defaultCurrency: currency ?? "CAD" }), [user?.id, currency]);
  const {
    voiceState, transcript: heard, interimTranscript, errorMessage: voiceError,
    isSupported: micSupported, startListening, stopListening, reset: resetVoice,
  } = useVoiceMode(voiceCtx);
  const listening = voiceState === "listening" || voiceState === "processing";

  useEffect(() => {
    if (voiceState === "result" && heard) {
      setText((prev) => (prev.trim() ? `${prev.trim()} ${heard}` : heard));
      setOpen(true);
      resetVoice();
    }
    if (voiceState === "error" && voiceError) {
      toast({ title: "Didn't catch that", description: voiceError, variant: "destructive" });
      resetVoice();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState, heard, voiceError]);

  const toggleMic = () => {
    if (listening) { stopListening(); return; }
    if (!micSupported) {
      toast({ title: "Voice needs the Spliiit app", description: "This browser doesn't allow speech input. Type it instead, or use the iOS app.", variant: "destructive" });
      return;
    }
    inputRef.current?.blur();
    setOpen(true);
    startListening();
  };

  // ── Talk-back call: offered to everyone whenever the server has voice
  // switched on. Cost is bounded server-side by voiceQuota's per-user daily
  // cap and global daily budget, which surface as a message in the pill.
  const { data: voiceHealth } = useQuery<{ enabled?: boolean }>({
    queryKey: ["/api/voice/health"],
    queryFn: async () => (await apiRequest("GET", "/api/voice/health")).json(),
    staleTime: 5 * 60_000,
  });
  const callAvailable = !!voiceHealth?.enabled;
  const startCall = () => {
    if (listening) resetVoice();
    inputRef.current?.blur();
    setText("");
    setCallOn(true);
  };

  // While dictating, show what's been heard so far after anything typed.
  const shownText = listening ? [text.trim(), heard, interimTranscript].filter(Boolean).join(" ") : text;

  const ctx = useMemo(() => ({
    meId: user?.id ?? "",
    friends: friends.map((f) => ({ id: f.id, name: f.name })),
    groups: groups.map((g) => ({ id: g.id, name: g.name, memberIds: g.memberIds })),
    people: people.map((p) => ({ id: p.id, name: p.name })),
  }), [user?.id, friends, groups, people]);

  const intent = useMemo(() => (user ? parseQuickAdd(shownText, ctx) : null), [shownText, ctx, user]);

  // Card edits (payer, who's in) survive further typing as long as the
  // parsed people stay the same; they reset when the text points elsewhere.
  const [payerOverride, setPayerOverride] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const peopleKey = intent?.type === "expense" ? `${intent.groupId}|${intent.payerId}|${intent.splitIds.join(",")}` : "";
  useEffect(() => { setPayerOverride(null); setExcluded([]); }, [peopleKey]);

  const nameOf = (id: string) => {
    if (id === user?.id) return "You";
    const n = people.find((p) => p.id === id)?.name ?? friends.find((f) => f.id === id)?.name ?? "Someone";
    return n.split(" ")[0];
  };
  const balanceWith = (id: string) => balances.find((b) => b.personId === id)?.amount ?? 0;

  // ── Resolved expense (parse + card edits) ──
  const expense = intent?.type === "expense" ? (() => {
    const payerId = payerOverride && intent.splitIds.includes(payerOverride) ? payerOverride : intent.payerId;
    const included = intent.splitIds.filter((id) => !excluded.includes(id));
    const involved = new Set([payerId, ...included]);
    const ready = !!intent.amount && included.length > 0 && involved.size > 1;
    return { ...intent, payerId, included, ready, each: intent.amount && included.length ? intent.amount / included.length : null };
  })() : null;

  const ready =
    (expense?.ready ?? false) ||
    (intent?.type === "settle" && !!intent.amount);

  const reset = () => { setText(""); setOpen(false); inputRef.current?.blur(); };

  const invalidate = (groupId?: string | null) => {
    queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
    queryClient.invalidateQueries({ queryKey: ["/api/friends/expenses"] });
    queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
    if (groupId) queryClient.invalidateQueries({ queryKey: ["/api/expenses/group", groupId] });
  };

  const saveMutation = useMutation({
    mutationFn: async (i: QuickIntent) => {
      if (i.type === "settle") {
        const res = await apiRequest("POST", "/api/settle-up", { friendId: i.friendId, amount: i.amount, friendIsPayer: i.friendIsPayer });
        return res.json();
      }
      if (!expense) throw new Error("Nothing to save");
      const fd = new FormData();
      fd.append("description", expense.description ?? "Expense");
      fd.append("amount", String(expense.amount));
      fd.append("paidById", expense.payerId);
      fd.append("splitAmongIds", JSON.stringify(expense.included));
      fd.append("date", new Date().toISOString());
      if (expense.groupId) fd.append("groupId", expense.groupId);
      const res = await apiFormRequest("POST", expense.groupId ? "/api/expenses" : "/api/friends/expenses", fd);
      return res.json();
    },
    onSuccess: (_d, i) => {
      if (i.type === "settle") {
        invalidate();
        track("expense_settled", { context: "quick_add", amount: i.amount });
        toast({ title: "Payment recorded" });
      } else if (expense) {
        invalidate(expense.groupId);
        track("expense_created", { context: "quick_add", split_type: "equal", amount: expense.amount, has_group: !!expense.groupId, people: expense.included.length });
        toast({ title: "Expense added", description: `${expense.description ?? "Expense"} · ${formatMoney(expense.amount ?? 0, currency)}` });
      }
      reset();
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Couldn't save", description: msg, variant: "destructive" });
    },
  });

  const submit = () => {
    if (!intent || !ready || saveMutation.isPending) return;
    saveMutation.mutate(intent);
  };

  const fill = (s: string) => { setText(s); inputRef.current?.focus(); };

  // With the pill open and nothing typed yet, made-up examples type themselves
  // and build the real cards above it ("watch it work"). Any typing, the mic or
  // a call stops it and the user's own card takes over.
  const demoActive = open && !listening && !callOn && !text.trim();
  const demo = useDemoLoop(DEMO_PHRASES, demoActive);
  const showCard = open && !callOn && !!intent && intent.type !== "unknown";

  const ghost = useGhostTyping(GHOST_PHRASES, !focused && !text && !listening && !callOn);

  // Nav is h-16 + safe area; it hides while the keyboard is up.
  const dockBottom = keyboardOpen ? "12px" : "calc(4rem + env(safe-area-inset-bottom) + 12px)";

  return (
    <>
      {/* While a card is open, soften the page behind it; tapping it closes. */}
      {(showCard || demoActive || listening || callOn) && (
        <div
          aria-hidden
          className="fixed inset-0 z-[35] bg-background/70 backdrop-blur-[3px] animate-in fade-in-0 duration-200"
          onMouseDown={(e) => {
            e.preventDefault();
            if (callOn || listening) return; // end those from their own buttons
            setOpen(false);
            inputRef.current?.blur();
          }}
        />
      )}

      <div className="fixed inset-x-0 z-40 transition-[bottom] duration-200" style={{ bottom: dockBottom }}>
        <div className="relative max-w-3xl mx-auto px-4">
          {(showCard || demoActive) && (
            <div
              className="absolute bottom-full left-4 right-4 mb-3 max-h-[58vh] overflow-y-auto rounded-[24px] border border-card-border bg-card p-4 shadow-[0_18px_48px_-16px_rgba(41,38,36,0.32),0_2px_8px_-2px_rgba(41,38,36,0.08)] animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
              // Keep taps on the card from blurring the input first.
              onMouseDown={(e) => e.preventDefault()}
              data-testid="quick-add-card"
            >
              {demoActive && (
                <div className={`transition-opacity duration-200 ${demo.visible ? "opacity-100" : "opacity-0"}`}>
                  <ExampleCard key={demo.index} phrase={demo.card} index={demo.index} currency={currency} />
                </div>
              )}

              {expense && (
                <div>
                  <CardHead icon={Receipt} label="Expense" />
                  <p className={`font-serif text-[26px] leading-[1.1] mb-2.5 ${expense.description ? "" : "text-muted-foreground"}`}>
                    {expense.description ?? "Add a description"}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mb-3.5">
                    {expense.amount
                      ? <Chip><span className="font-mono tabular-nums">{formatMoney(expense.amount, currency)}</span></Chip>
                      : <Chip ghost>+ Amount</Chip>}
                    <Chip
                      icon={Wallet}
                      onClick={() => {
                        const order = expense.splitIds;
                        setPayerOverride(order[(order.indexOf(expense.payerId) + 1) % order.length]);
                      }}
                    >
                      Paid by {nameOf(expense.payerId) === "You" ? "you" : nameOf(expense.payerId)}
                    </Chip>
                    {expense.groupId && <Chip icon={Users2}>{groups.find((g) => g.id === expense.groupId)?.name}</Chip>}
                    <Chip icon={CalendarDays}>Today</Chip>
                  </div>

                  <div className="rounded-2xl bg-background px-3.5 py-3">
                    <div className="flex items-end justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] text-muted-foreground mb-2">Split equally · {expense.included.length}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {expense.splitIds.map((id) => {
                            const out = excluded.includes(id);
                            return (
                              <button
                                key={id}
                                type="button"
                                aria-pressed={!out}
                                aria-label={`${out ? "Add" : "Remove"} ${nameOf(id)}`}
                                onClick={() => setExcluded((ex) => out ? ex.filter((x) => x !== id) : (expense.included.length > 1 ? [...ex, id] : ex))}
                                className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-[13px] font-serif transition-opacity ring-2 ring-background ${out ? "opacity-25" : ""}`}
                                style={{ backgroundColor: avatarColor(id) }}
                              >
                                {nameOf(id).charAt(0)}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1.5 truncate">{expense.included.map(nameOf).join(", ")}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[11px] text-muted-foreground">Each pays</p>
                        <p className="font-mono tabular-nums text-[24px] leading-tight">
                          {expense.each ? formatMoney(expense.each, currency) : <span className="text-muted-foreground">—</span>}
                        </p>
                      </div>
                    </div>
                  </div>
                  <CardFoot label="Add expense" ready={ready} pending={saveMutation.isPending} onClear={reset} onSubmit={submit} />
                </div>
              )}

              {intent?.type === "settle" && (() => {
                const bal = balanceWith(intent.friendId);
                const name = nameOf(intent.friendId);
                const from = intent.friendIsPayer ? intent.friendId : user!.id;
                const to = intent.friendIsPayer ? user!.id : intent.friendId;
                const matchesDebt = intent.friendIsPayer ? bal > 0 : bal < 0;
                return (
                  <div>
                    <CardHead icon={ArrowLeftRight} label="Settle up" />
                    <div className="rounded-2xl bg-background px-3.5 py-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-[15px] min-w-0">
                        <Avatar id={from} name={nameOf(from)} color={avatarColor} />
                        <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                        <Avatar id={to} name={nameOf(to)} color={avatarColor} />
                        <span className="truncate">{intent.friendIsPayer ? `${name} paid you` : `You paid ${name}`}</span>
                      </div>
                      <p className="font-mono tabular-nums text-[24px] shrink-0">
                        {intent.amount ? formatMoney(intent.amount, currency) : <span className="text-muted-foreground">—</span>}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 px-1">
                      {bal === 0
                        ? `You and ${name} are settled up right now.`
                        : matchesDebt
                          ? `${bal > 0 ? `${name} owes you` : `You owe ${name}`} ${formatMoney(Math.abs(bal), currency)} in total.`
                          : `Heads up: ${bal > 0 ? `${name} owes you` : `you owe ${name}`} ${formatMoney(Math.abs(bal), currency)}, so this adds to it.`}
                    </p>
                    {!intent.amount && matchesDebt && (
                      <div className="mt-2.5">
                        <Chip onClick={() => fill(`${text.trim()} ${Math.abs(bal).toFixed(2)}`)}>Use full balance · {formatMoney(Math.abs(bal), currency)}</Chip>
                      </div>
                    )}
                    <CardFoot label="Record payment" ready={ready} pending={saveMutation.isPending} onClear={reset} onSubmit={submit} />
                  </div>
                );
              })()}

              {intent?.type === "balance" && (() => {
                if (!intent.personId) {
                  const owed = balances.filter((b) => b.amount > 0).reduce((s, b) => s + b.amount, 0);
                  const owe = balances.filter((b) => b.amount < 0).reduce((s, b) => s - b.amount, 0);
                  return (
                    <div>
                      <CardHead icon={Scale} label="Balance" />
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-2xl bg-background px-3.5 py-3"><p className="text-[11px] text-muted-foreground">You're owed</p><p className={`font-mono tabular-nums text-[22px] ${AMOUNT_IN_CLASS}`}>{formatMoney(owed, currency)}</p></div>
                        <div className="rounded-2xl bg-background px-3.5 py-3"><p className="text-[11px] text-muted-foreground">You owe</p><p className={`font-mono tabular-nums text-[22px] ${AMOUNT_OUT_CLASS}`}>{formatMoney(owe, currency)}</p></div>
                      </div>
                    </div>
                  );
                }
                const id = intent.personId;
                const bal = balanceWith(id);
                const name = nameOf(id);
                return (
                  <div>
                    <CardHead icon={Scale} label="Balance" />
                    <div className="rounded-2xl bg-background px-3.5 py-3 flex items-center gap-3">
                      <Avatar id={id} name={name} color={avatarColor} />
                      <p className="flex-1 text-[15px]">{bal > 0 ? `${name} owes you` : bal < 0 ? `You owe ${name}` : `You and ${name} are settled`}</p>
                      <p className={`font-mono tabular-nums text-[24px] ${bal > 0 ? AMOUNT_IN_CLASS : bal < 0 ? AMOUNT_OUT_CLASS : "text-muted-foreground"}`}>{formatMoney(Math.abs(bal), currency)}</p>
                    </div>
                    <div className="flex justify-between items-center mt-3.5">
                      <button type="button" onClick={reset} className="text-[13px] text-muted-foreground px-1">Clear</button>
                      <button type="button" onClick={() => { reset(); setLocation(`/friends/${id}`); }} className="h-9 rounded-full bg-foreground px-4 text-[13px] font-medium text-background">
                        Open {name}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {callOn && (
            <PillCall
              onClose={() => setCallOn(false)}
              currency={currency}
              avatarColor={avatarColor}
              groups={groups}
            />
          )}

          {/* The pill */}
          {!callOn && (
          <form
            onSubmit={(e) => { e.preventDefault(); submit(); }}
            className={`${PILL} pl-6 ${focused || listening ? "border-accent-foreground/40" : "border-white/90"}`}
            data-testid="quick-add-bar"
          >
            <input
              ref={inputRef}
              value={shownText}
              readOnly={listening}
              onChange={(e) => setText(e.target.value)}
              onFocus={() => { setFocused(true); setOpen(true); }}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => { if (e.key === "Escape") reset(); }}
              placeholder={demoActive ? demo.typed : ghost || "Tell Spliiit anything…"}
              enterKeyHint="done"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="flex-1 min-w-0 bg-transparent outline-none font-serif text-[22px] text-foreground placeholder:italic placeholder:text-muted-foreground"
              aria-label="Quick add an expense"
              data-testid="quick-add-input"
            />
            {/* Mic (dictation) — always here; turns terracotta while listening. */}
            <PillButton
              label={listening ? "Stop dictation" : "Dictate"}
              tone={listening ? "live" : "plain"}
              onClick={toggleMic}
              testId="quick-add-mic"
            >
              {listening ? <Bars /> : <Mic className="w-[19px] h-[19px]" strokeWidth={1.75} />}
            </PillButton>
            {/* Second slot: send when a card is ready, otherwise the talk-back call. */}
            {ready && !listening ? (
              <PillButton label="Save" tone="ink" type="submit" testId="quick-add-action">
                <ArrowUp className="w-[18px] h-[18px]" strokeWidth={2} />
              </PillButton>
            ) : callAvailable && !listening ? (
              <PillButton label="Talk to Spliiit" tone="plain" onClick={startCall} testId="quick-add-call">
                <SpeakGlyph />
              </PillButton>
            ) : null}
          </form>
          )}
          {listening && (
            <p className="text-center text-[11.5px] text-muted-foreground mt-2">Listening… tap the mic to stop</p>
          )}
          {demoActive && (
            <p className="text-center text-[11.5px] text-muted-foreground mt-2">
              or{" "}
              <Link href="/ai">
                <button type="button" onMouseDown={(e) => e.preventDefault()} className="underline underline-offset-2 text-secondary-foreground" data-testid="quick-add-ai-link">
                  scan a receipt
                </button>
              </Link>
            </p>
          )}
        </div>
      </div>
    </>
  );
});

// What the empty pill types out as inspiration. Deliberately made-up: this is
// visible on screen (and in screenshots / screen recordings), so it must never
// use the user's real friends, group names or addresses.
const GHOST_PHRASES = [
  "sushi night 96 with maya and leo",
  "concert tickets 240 with sam",
  "cabin weekend 900 with the ski crew",
  "sam paid 64 for tacos",
  "paid jordan back 35",
  "who owes me for the road trip?",
];

/**
 * Types example phrases into the empty pill's placeholder, one after another,
 * starting from the plain "Tell Spliiit anything…" line. Off while the user is
 * focused or busy, and for reduced-motion users.
 */
function useGhostTyping(phrases: string[], active: boolean): string {
  const [ghost, setGhost] = useState("");
  useEffect(() => {
    setGhost("");
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!active || reduce || phrases.length === 0) return;
    let cancelled = false;
    const timers: number[] = [];
    const later = (ms: number) => new Promise<void>((r) => { timers.push(window.setTimeout(r, ms)); });
    (async () => {
      await later(3500); // let the plain line sit first
      for (let k = 0; !cancelled; k++) {
        const phrase = phrases[k % phrases.length];
        for (let i = 1; i <= phrase.length && !cancelled; i++) { setGhost(phrase.slice(0, i)); await later(65); }
        await later(1700);
        for (let i = phrase.length - 1; i >= 0 && !cancelled; i--) { setGhost(phrase.slice(0, i)); await later(22); }
        await later(350);
      }
    })();
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [active, phrases]);
  return ghost;
}

// ── "Watch it work" examples ─────────────────────────────────────────────────
// Made-up people and groups only: this plays on screen (and in screenshots and
// screen recordings), so it must never use the user's real friends or groups.
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
const DEMO_PHRASES = [
  "sushi night 96 with maya and leo",
  "cabin weekend 900 ski crew",
  "sam paid 64 for tacos",
  "paid jordan back 35",
  "what does maya owe",
];
// What each example becomes, so a half-typed phrase still shows the right empty card.
const DEMO_KINDS: Array<"expense" | "settle" | "balance"> = ["expense", "expense", "expense", "settle", "balance"];

/**
 * Types each example into the pill, holds it, deletes it, moves on.
 * - `typed`: what the pill shows (letter by letter).
 * - `card`: what the card is built from. It only advances at word boundaries
 *   and stays frozen while the pill deletes, so the card doesn't rebuild dozens
 *   of times a second (on iOS that also repaints the blur behind it: flicker).
 * - `visible`: false briefly between examples so the card fades out and in.
 * Static for reduced motion.
 */
type DemoState = { index: number; typed: string; card: string; visible: boolean };
function useDemoLoop(phrases: string[], active: boolean): DemoState {
  const [state, setState] = useState<DemoState>({ index: 0, typed: "", card: "", visible: true });
  useEffect(() => {
    setState({ index: 0, typed: "", card: "", visible: true });
    if (!active) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
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

/**
 * One example, rendered like the real card, built live from the half-typed
 * phrase by the real parser (against the made-up people above). Read-only:
 * no buttons, so nobody thinks they saved a pretend expense.
 */
function ExampleCard({ phrase, index, currency }: { phrase: string; index: number; currency?: string | null }) {
  const money = (n: number) => formatMoney(n, currency);
  const person = (id: string) => DEMO_PEOPLE.find((p) => p.id === id);
  const nameOf = (id: string) => (id === DEMO_ME ? "You" : person(id)?.name ?? "");
  // A plain render function, not a component: a component defined in here would
  // be a new type every keystroke, remounting (and re-animating) each avatar.
  const av = (id: string) => (
    <span key={id} className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[13px] font-serif ring-2 ring-background animate-in zoom-in-75 fade-in-0 duration-200" style={{ backgroundColor: id === DEMO_ME ? "#292624" : person(id)?.color }}>
      {nameOf(id).charAt(0)}
    </span>
  );

  const parsed = parseQuickAdd(phrase, DEMO_CTX);
  const kind = parsed && parsed.type !== "unknown" ? parsed.type : DEMO_KINDS[index];

  const head = (icon: React.ComponentType<{ className?: string }>, label: string) => (
    <div className="flex items-start justify-between gap-2">
      <CardHead icon={icon} label={label} />
      <span className="rounded-full border border-card-border px-2 py-0.5 text-[11px] text-muted-foreground">Example {index + 1} of {DEMO_PHRASES.length}</span>
    </div>
  );
  const foot = <p className="mt-3.5 text-[12.5px] text-muted-foreground">Your turn: start typing</p>;

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
        {foot}
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
        {foot}
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
      {foot}
    </div>
  );
}

// Frosted pill shell, shared by the resting/typing pill and the in-pill call.
const PILL = "flex items-center gap-2 h-[60px] rounded-full pr-2 bg-card/60 backdrop-blur-2xl backdrop-saturate-150 border transition-colors shadow-[0_10px_30px_-12px_rgba(41,38,36,0.22),0_1px_4px_-1px_rgba(41,38,36,0.06),inset_0_1px_0_rgba(255,255,255,0.9)]";

function PillButton({ children, label, tone, onClick, type = "button", testId }: {
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
function Bars({ className = "" }: { className?: string }) {
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
function SpeakGlyph() {
  return (
    <span className="flex items-center gap-[2.5px]" aria-hidden>
      {[7, 13, 18, 12, 6].map((h, i) => <span key={i} style={{ width: 2, height: h, borderRadius: 9999, background: "currentColor" }} />)}
    </span>
  );
}

/**
 * The talk-back call, living inside the pill. No transcript: the pill shows
 * only the line being said right now. When the model proposes a split, the
 * same Expense card as typing appears above it (server-resolved, Jev-checked).
 * After saving, the model asks if there's anything else and hangs up when the
 * user is done (end_call) — which unmounts this and returns the resting pill.
 */
function PillCall({ onClose, currency, avatarColor, groups }: {
  onClose: () => void; currency?: string | null; avatarColor: (id: string) => string; groups: Group[];
}) {
  const {
    state, error, turns, proposal, setProposal, preview, setPreview, previewing, committing,
    ending, speaking, userSpeaking, audioRef, meterRef, hangUp, commit,
  } = useVoiceCall({ onClose });

  // The single live line: whatever was said last (you or Spliiit), tail-trimmed
  // so a long sentence shows its newest words.
  const last = [...turns].reverse().find((t) => t.text.trim());
  let line =
    state === "connecting" ? "Connecting…" :
    state === "reconnecting" ? "Reconnecting…" :
    state === "error" || state === "capped" ? (error ?? "Voice isn't available right now.") :
    previewing ? "Working out the split…" :
    userSpeaking && (!last || last.role !== "user") ? "Listening…" :
    last?.text.replace(/^[^A-Za-z0-9$"'(]+/, "") ?? (ending ? "Wrapping up…" : "Listening…");
  // Only trim live speech (it streams, so the newest words matter); status and
  // error messages always show in full.
  const fromSpeech = state === "live" && !previewing && !!last;
  if (fromSpeech && line.length > 64) line = "…" + line.slice(-62).replace(/^\S*\s/, "");

  const live = state === "live";
  const equal = preview ? preview.people.every((p) => Math.abs(p.share - preview.perPerson) < 0.01) : true;
  const groupName = preview?.groupName ?? (preview?.groupId ? groups.find((g) => g.id === preview.groupId)?.name : null);

  return (
    <>
      <audio ref={audioRef} autoPlay className="hidden" />

      {preview && (
        <div className="absolute bottom-full left-4 right-4 mb-3 max-h-[58vh] overflow-y-auto rounded-[24px] border border-card-border bg-card p-4 shadow-[0_18px_48px_-16px_rgba(41,38,36,0.32),0_2px_8px_-2px_rgba(41,38,36,0.08)] animate-in fade-in-0 slide-in-from-bottom-2 duration-200" data-testid="quick-add-call-card">
          <div className="flex items-start justify-between gap-2">
            <CardHead icon={Receipt} label="Expense" />
            {preview.verdict === "high" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#E3EEE6] px-2.5 py-1 text-[12px] text-[#2F5E43]"><Check className="w-3.5 h-3.5" />Looks right</span>
            )}
            {preview.verdict === "check" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#F4E7D3] px-2.5 py-1 text-[12px] text-[#8A5A1A]">Check {WEAK_LABEL[preview.weakField ?? ""] ?? "this"}</span>
            )}
          </div>
          <p className="font-serif text-[26px] leading-[1.1] mb-2.5">{preview.description.charAt(0).toUpperCase() + preview.description.slice(1)}</p>
          <div className="flex flex-wrap gap-1.5 mb-3.5">
            <Chip><span className="font-mono tabular-nums">{formatMoney(preview.amount, currency)}</span></Chip>
            <Chip icon={Wallet}>Paid by you</Chip>
            {groupName && <Chip icon={Users2}>{groupName}</Chip>}
            <Chip icon={CalendarDays}>{new Date(preview.date).toDateString() === new Date().toDateString() ? "Today" : new Date(preview.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</Chip>
          </div>
          <div className="rounded-2xl bg-background px-3.5 py-3">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground mb-2">{equal ? "Split equally" : "Custom split"} · {preview.people.length}</p>
                <div className="flex flex-wrap gap-1.5">
                  {preview.people.map((p) => (
                    <span key={p.id} className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[13px] font-serif ring-2 ring-background" style={{ backgroundColor: avatarColor(p.id) }}>
                      {(p.isYou ? "You" : p.name).charAt(0)}
                    </span>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5 truncate">
                  {equal
                    ? preview.people.map((p) => (p.isYou ? "You" : p.name.split(" ")[0])).join(", ")
                    : preview.people.map((p) => `${p.isYou ? "You" : p.name.split(" ")[0]} ${formatMoney(p.share, currency)}`).join(" · ")}
                </p>
              </div>
              {equal && (
                <div className="text-right shrink-0">
                  <p className="text-[11px] text-muted-foreground">Each pays</p>
                  <p className="font-mono tabular-nums text-[24px] leading-tight">{formatMoney(preview.perPerson, currency)}</p>
                </div>
              )}
            </div>
          </div>
          <CardFoot
            label="Add expense"
            ready={!!proposal}
            pending={committing}
            clearLabel="Not quite"
            onClear={() => { setPreview(null); setProposal(null); }}
            onSubmit={() => proposal && commit(proposal)}
          />
        </div>
      )}

      <div className={`${PILL} pl-5 border-accent-foreground/40`} data-testid="quick-add-call-pill">
        <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
          {live && <span className="absolute inline-flex h-full w-full rounded-full bg-accent-foreground opacity-60 animate-ping" />}
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${live ? "bg-accent-foreground" : "bg-muted-foreground"}`} />
        </span>
        <p className="flex-1 min-w-0 font-serif italic text-[18px] leading-tight text-secondary-foreground line-clamp-2" aria-live="polite">
          {line}
        </p>
        {live && (
          <span className="w-11 h-11 shrink-0 rounded-full bg-card ring-1 ring-black/[0.04] shadow-[0_2px_8px_-1px_rgba(41,38,36,0.16)] flex items-center justify-center text-accent-foreground">
            {speaking ? (
              <Bars />
            ) : (
              // Your live mic level (CSS var set by the call's meter, no re-renders).
              <span ref={meterRef} className="flex items-center justify-center gap-[2.5px]" style={{ ["--mic" as any]: 0 }} aria-hidden>
                {[8, 14, 19, 12, 7].map((h, i) => (
                  <span key={i} style={{ width: 2.5, height: h, borderRadius: 9999, background: "currentColor", transform: "scaleY(calc(0.22 + var(--mic, 0) * 1.6))", transition: "transform 90ms linear" }} />
                ))}
              </span>
            )}
          </span>
        )}
        {state === "connecting" || state === "reconnecting" ? (
          <span className="w-11 h-11 shrink-0 flex items-center justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></span>
        ) : null}
        <PillButton label="End call" tone="ink" onClick={hangUp} testId="quick-add-end-call">
          <X className="w-[18px] h-[18px]" strokeWidth={2} />
        </PillButton>
      </div>
    </>
  );
}

function CardHead({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="w-7 h-7 rounded-[9px] bg-accent flex items-center justify-center"><Icon className="w-[15px] h-[15px] text-accent-foreground" /></span>
      <span className="text-[13px] text-secondary-foreground">{label}</span>
    </div>
  );
}

function Chip({ children, icon: Icon, ghost, onClick }: { children: React.ReactNode; icon?: React.ComponentType<{ className?: string }>; ghost?: boolean; onClick?: () => void }) {
  const cls = `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] ${ghost ? "border border-dashed border-border text-muted-foreground" : "bg-accent/70 text-secondary-foreground"} ${onClick ? "active:scale-[0.97] transition-transform" : ""}`;
  const inner = <>{Icon && <Icon className="w-3.5 h-3.5" />}{children}</>;
  return onClick ? <button type="button" onClick={onClick} className={cls}>{inner}</button> : <span className={cls}>{inner}</span>;
}

function Avatar({ id, name, color }: { id: string; name: string; color: (id: string) => string }) {
  return (
    <span className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[13px] font-serif shrink-0" style={{ backgroundColor: color(id) }}>
      {name.charAt(0)}
    </span>
  );
}

function CardFoot({ label, ready, pending, clearLabel = "Clear", onClear, onSubmit }: { label: string; ready: boolean; pending: boolean; clearLabel?: string; onClear: () => void; onSubmit: () => void }) {
  return (
    <div className="flex justify-between items-center mt-3.5">
      <button type="button" onClick={onClear} className="text-[13px] text-muted-foreground px-1">{clearLabel}</button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={!ready || pending}
        className={`h-9 rounded-full px-4 text-[13px] font-medium transition-colors ${ready ? "bg-foreground text-background" : "bg-foreground/25 text-background"}`}
        data-testid="quick-add-submit"
      >
        {pending ? "Saving…" : label}
      </button>
    </div>
  );
}
