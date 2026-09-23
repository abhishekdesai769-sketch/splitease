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
import { Mic, Loader2, X, Check, AudioLines, ArrowUp, Receipt, ArrowLeftRight, Scale, Users2, CalendarDays, Wallet, ArrowRight } from "lucide-react";
import type { Group, SafeUser } from "@shared/schema";
import { useAuth } from "@/lib/auth";
import { apiFormRequest, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useKeyboardOpen } from "@/hooks/use-keyboard-open";
import { track } from "@/lib/analytics";
import { formatMoney, currencySymbol } from "@/components/CurrencySelector";
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

  const showHints = open && !listening && !callOn && (!intent || intent.type === "unknown");
  const showCard = open && !callOn && !!intent && intent.type !== "unknown";

  const ghost = useGhostTyping(GHOST_PHRASES, !focused && !text && !listening && !callOn);

  // Nav is h-16 + safe area; it hides while the keyboard is up.
  const dockBottom = keyboardOpen ? "12px" : "calc(4rem + env(safe-area-inset-bottom) + 12px)";

  return (
    <>
      {/* While a card is open, soften the page behind it; tapping it closes. */}
      {(showCard || showHints || listening || callOn) && (
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
          {(showCard || showHints) && (
            <div
              className="absolute bottom-full left-4 right-4 mb-3 max-h-[58vh] overflow-y-auto rounded-[24px] border border-card-border bg-card p-4 shadow-[0_18px_48px_-16px_rgba(41,38,36,0.32),0_2px_8px_-2px_rgba(41,38,36,0.08)] animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
              // Keep taps on the card from blurring the input first.
              onMouseDown={(e) => e.preventDefault()}
              data-testid="quick-add-card"
            >
              {showHints && (
                <div>
                  <Showcase
                    friends={friends}
                    groups={groups}
                    balances={balances}
                    currency={currency}
                    avatarColor={avatarColor}
                    nameOf={nameOf}
                    onPick={fill}
                    onTalk={callAvailable ? startCall : undefined}
                  />
                  <Link href="/ai">
                    <button type="button" className="mt-3 w-full flex items-center gap-3 border-t border-card-border pt-3.5 text-left" data-testid="quick-add-ai-link">
                      <span className="w-8 h-8 rounded-[10px] bg-foreground flex items-center justify-center shrink-0"><Receipt className="w-4 h-4 text-background" /></span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14px] font-medium">Scan a receipt or screenshot</span>
                        <span className="block text-xs text-muted-foreground">It reads the bill and splits it for you</span>
                      </span>
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </Link>
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
              placeholder={ghost || "Tell Spliiit anything…"}
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

/**
 * "What it can do" — a swipeable row of tiny previews of the real cards each
 * kind of phrase creates, with the phrase underneath. Built from the user's own
 * friends, groups and balances, so tapping any card fills a phrase that works.
 * Only shows things the pill actually does today.
 */
function Showcase({ friends, groups, balances, currency, avatarColor, nameOf, onPick, onTalk }: {
  friends: SafeUser[]; groups: Group[]; balances: QuickAddBalance[]; currency?: string | null;
  avatarColor: (id: string) => string; nameOf: (id: string) => string;
  onPick: (phrase: string) => void; onTalk?: () => void;
}) {
  const [active, setActive] = useState(0);
  const money = (n: number) => formatMoney(n, currency);
  const first = (id: string) => nameOf(id);
  const low = (id: string) => nameOf(id).toLowerCase();
  const [fa, fb] = friends;
  const group = groups.find((g) => g.memberIds.length > 2) ?? groups[0];
  const owesMe = [...balances].filter((b) => b.amount > 0).sort((a, b) => b.amount - a.amount)[0];
  const iOwe = [...balances].filter((b) => b.amount < 0).sort((a, b) => a.amount - b.amount)[0];
  const meId = "__me__";

  const Avs = ({ ids }: { ids: string[] }) => (
    <span className="flex">
      {ids.slice(0, 4).map((id) => (
        <span key={id} className="w-[18px] h-[18px] -mr-1 rounded-full ring-[1.5px] ring-card flex items-center justify-center text-white text-[10px] font-serif" style={{ backgroundColor: id === meId ? "#292624" : avatarColor(id) }}>
          {id === meId ? "Y" : first(id).charAt(0)}
        </span>
      ))}
      {ids.length > 4 && <span className="ml-2 text-[10px] text-muted-foreground">+{ids.length - 4}</span>}
    </span>
  );
  const Each = ({ ids, amount }: { ids: string[]; amount: string }) => (
    <div className="flex items-end justify-between mt-2">
      <Avs ids={ids} />
      <span className="text-right">
        <span className="block text-[9.5px] text-muted-foreground">each</span>
        <span className="font-mono tabular-nums text-[14px]">{amount}</span>
      </span>
    </div>
  );
  const Pair = ({ from, to, label }: { from: string; to: string; label: string }) => (
    <div className="flex items-center gap-1.5 mt-0.5">
      <Avs ids={[from]} />
      <ArrowRight className="w-3 h-3 ml-1.5 text-muted-foreground" />
      <Avs ids={[to]} />
      <span className="ml-1.5 text-[12px] truncate">{label}</span>
    </div>
  );

  type Item = { key: string; icon: React.ComponentType<{ className?: string }>; kind: string; phrase: string; body: React.ReactNode; action?: () => void };
  const items: Item[] = [];

  if (fa) {
    const ids = [meId, fa.id, ...(fb ? [fb.id] : [])];
    const phrase = fb ? `dinner 120 with ${low(fa.id)} and ${low(fb.id)}` : `dinner 120 with ${low(fa.id)}`;
    items.push({ key: "friends", icon: Receipt, kind: "Split with friends", phrase, body: (
      <><p className="font-serif text-[18px] leading-tight">Dinner</p><p className="text-[10.5px] text-muted-foreground">{money(120)} · paid by you</p><Each ids={ids} amount={money(120 / ids.length)} /></>
    ) });
  }
  if (group) {
    const ids = group.memberIds.map((id) => (nameOf(id) === "You" ? meId : id));
    const members = group.memberIds.length;
    items.push({ key: "group", icon: Users2, kind: "A whole group, by name", phrase: `uber 45 ${group.name.toLowerCase()}`, body: (
      <><p className="font-serif text-[18px] leading-tight">Uber</p><p className="text-[10.5px] text-muted-foreground truncate">{money(45)} · {group.name}</p><Each ids={ids} amount={money(45 / Math.max(members, 1))} /></>
    ) });
  }
  if (fa) {
    items.push({ key: "paid", icon: Wallet, kind: "When someone else paid", phrase: `${low(fa.id)} paid 180 for groceries`, body: (
      <><p className="font-serif text-[18px] leading-tight">Groceries</p><p className="text-[10.5px] text-[#2F5E43]">Paid by {first(fa.id)}</p><Each ids={[meId, fa.id]} amount={money(90)} /></>
    ) });
  }
  const settleWith = iOwe?.personId ?? fa?.id;
  if (settleWith && friends.some((f) => f.id === settleWith)) {
    const amt = iOwe ? Math.abs(iOwe.amount) : 20;
    items.push({ key: "settle", icon: ArrowLeftRight, kind: "Settle up", phrase: `paid ${low(settleWith)} ${amt % 1 ? amt.toFixed(2) : amt}`, body: (
      <><Pair from={meId} to={settleWith} label={`You paid ${first(settleWith)}`} /><p className="font-mono tabular-nums text-[20px] mt-2">{money(amt)}</p></>
    ) });
  }
  const askAbout = owesMe?.personId ?? fa?.id;
  if (askAbout) {
    const bal = balances.find((b) => b.personId === askAbout)?.amount ?? 0;
    items.push({ key: "ask", icon: Scale, kind: "Ask who owes what", phrase: `what does ${low(askAbout)} owe`, body: (
      <><div className="flex items-center gap-1.5 mt-0.5"><Avs ids={[askAbout]} /><span className="ml-1 text-[12px] truncate">{bal > 0 ? `${first(askAbout)} owes you` : bal < 0 ? `You owe ${first(askAbout)}` : `You're settled up`}</span></div>
        <p className={`font-mono tabular-nums text-[20px] mt-2 ${bal > 0 ? AMOUNT_IN_CLASS : bal < 0 ? AMOUNT_OUT_CLASS : "text-muted-foreground"}`}>{money(Math.abs(bal))}</p></>
    ) });
  }
  if (onTalk) {
    const who = fa ? first(fa.id) : "Sam";
    items.push({ key: "talk", icon: AudioLinesIcon, kind: "Talk it through", phrase: "Tap to talk to Spliiit", action: onTalk, body: (
      <><p className="font-serif italic text-[13px] leading-snug text-secondary-foreground">“Who had the steak?”</p>
        <div className="flex gap-1.5 mt-2 text-[10.5px] whitespace-nowrap"><span className="rounded-full bg-accent/70 px-2 py-0.5">You <span className="font-mono">{currencySymbol(currency)}50</span></span><span className="rounded-full bg-accent/70 px-2 py-0.5">{who} <span className="font-mono">{currencySymbol(currency)}70</span></span></div>
        <p className="text-[10px] text-[#2F5E43] mt-2 flex items-center gap-1"><Check className="w-3 h-3" />Uneven splits, by voice</p></>
    ) });
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">What it can do</p>
        <p className="text-[11px] text-muted-foreground">Swipe ›</p>
      </div>
      <div
        className="-mx-4 px-4 mt-2.5 flex gap-2.5 overflow-x-auto snap-x snap-mandatory pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={(e) => setActive(Math.round(e.currentTarget.scrollLeft / 214))}
        data-testid="quick-add-showcase"
      >
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            onClick={it.action ?? (() => onPick(it.phrase))}
            className="snap-start shrink-0 w-[204px] flex flex-col justify-start rounded-[18px] bg-background px-3 pt-2.5 pb-2.5 text-left active:scale-[0.97] transition-transform"
            data-testid={`quick-add-showcase-${it.key}`}
          >
            <span className="w-full flex items-center gap-1.5 text-[11.5px] text-secondary-foreground mb-2">
              <span className="w-[22px] h-[22px] rounded-[7px] bg-card flex items-center justify-center"><it.icon className="w-3.5 h-3.5 text-accent-foreground" /></span>
              {it.kind}
            </span>
            <span className="block w-full flex-1 rounded-xl bg-card px-2.5 py-2 min-h-[80px]">{it.body}</span>
            <span className="block w-full font-serif italic text-[14px] text-secondary-foreground mt-2 truncate">
              {it.action ? it.phrase : `“${it.phrase}”`}
            </span>
          </button>
        ))}
      </div>
      {items.length > 1 && (
        <div className="flex justify-center gap-1 mt-2" aria-hidden>
          {items.map((it, i) => (
            <span key={it.key} className={`h-[5px] rounded-full transition-all ${i === Math.min(active, items.length - 1) ? "w-3.5 bg-foreground" : "w-[5px] bg-border"}`} />
          ))}
        </div>
      )}
    </div>
  );
}

// lucide's AudioLines, typed to match the other card icons.
const AudioLinesIcon = AudioLines as React.ComponentType<{ className?: string }>;

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
