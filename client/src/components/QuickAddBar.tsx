/**
 * QuickAddBar — the dashboard's floating "type it, it becomes a card" input.
 *
 * A frosted pill docked just above the bottom nav. As you type, a live card
 * grows out of it (expense / settle up / balance), built instantly on-device by
 * quickAddParser. When the user pauses, Claude Haiku reads the phrase too
 * (/api/quick-add/understand) and its card replaces the rules' card if it
 * understood more (uneven shares, dates…).
 * The card is the source of truth: whatever it shows (payer, who's in the
 * split, each share) is exactly what gets saved, including any taps the user
 * made on it after typing.
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Mic, Loader2, X, Check, Sparkles, ArrowUp, Receipt, ArrowLeftRight, Scale, Users2, CalendarDays, Wallet, ArrowRight } from "lucide-react";
import type { Group, SafeUser } from "@shared/schema";
import { useAuth } from "@/lib/auth";
import { apiFormRequest, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useKeyboardOpen } from "@/hooks/use-keyboard-open";
import { track } from "@/lib/analytics";
import { formatMoney } from "@/components/CurrencySelector";
import { AMOUNT_IN_CLASS, AMOUNT_OUT_CLASS } from "@/lib/balance-display";
import { parseQuickAdd, type QuickIntent } from "@/lib/quickAddParser";
import { PILL, PillButton, Bars, SpeakGlyph, CardHead, Chip } from "@/components/quick-add-parts";
import { DEMO_KINDS, DEMO_PHRASES, ExampleCard, useDemoLoop } from "@/components/quick-add-demo";
import { useVoiceMode } from "@/hooks/useVoiceMode";
import { useVoiceCall, WEAK_LABEL } from "@/hooks/use-voice-call";
import { FitText } from "@/components/FitText";

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

  const ruleIntent = useMemo(() => (user ? parseQuickAdd(shownText, ctx) : null), [shownText, ctx, user]);

  // ── AI read (Claude Haiku, server-side) ──
  // The rules above build an instant card on every keystroke. When the user
  // pauses, Haiku reads the phrase too, and its card replaces the rules' card
  // if the text hasn't changed since.
  const [aiRead, setAiRead] = useState<{ text: string; intent: QuickIntent } | null>(null);
  const [aiPending, setAiPending] = useState(false);
  const aiCache = useRef(new Map<string, QuickIntent>());
  const aiText = text.trim();
  const aiWorthIt = open && !listening && !callOn && aiText.split(/\s+/).length >= 2;
  useEffect(() => {
    setAiPending(false);
    if (!aiWorthIt) return;
    const cached = aiCache.current.get(aiText);
    if (cached) { setAiRead({ text: aiText, intent: cached }); return; }
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      setAiPending(true);
      try {
        const res = await fetch("/api/quick-add/understand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          signal: ctrl.signal,
          body: JSON.stringify({ text: aiText, today: localToday() }),
        });
        if (!res.ok) return; // capped, disabled or failed: the rules' card stays
        const out = (await res.json()) as QuickIntent;
        aiCache.current.set(aiText, out);
        setAiRead({ text: aiText, intent: out });
      } catch { /* aborted by more typing, or offline */ }
      finally { if (!ctrl.signal.aborted) setAiPending(false); }
    }, 700);
    return () => { window.clearTimeout(timer); ctrl.abort(); };
  }, [aiText, aiWorthIt]);
  const aiIntent = aiRead && aiRead.text === aiText && !listening ? aiRead.intent : null;
  // An AI "don't know" never replaces a card the rules could build.
  const intent = aiIntent && aiIntent.type !== "unknown" ? aiIntent : ruleIntent;

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

    // Stated shares ("she has to pay 30") are used as given; everyone else
    // splits what's left equally. Worked in cents so the parts always add up.
    const stated = Object.fromEntries(Object.entries(intent.shares ?? {}).filter(([id]) => included.includes(id)));
    const custom = Object.keys(stated).length > 0;
    let amounts: Record<string, number> | null = null;
    let mismatch: { stated: number; total: number } | null = null;
    if (intent.amount && included.length) {
      const totalC = Math.round(intent.amount * 100);
      const statedC = Object.values(stated).reduce((s, v) => s + Math.round(v * 100), 0);
      const rest = included.filter((id) => !(id in stated));
      const leftC = totalC - statedC;
      if (leftC < 0 || (rest.length === 0 && leftC !== 0)) mismatch = { stated: statedC / 100, total: intent.amount };
      else {
        amounts = {};
        for (const [id, v] of Object.entries(stated)) amounts[id] = Math.round(v * 100) / 100;
        const base = rest.length ? Math.floor(leftC / rest.length) : 0;
        rest.forEach((id, i) => { amounts![id] = (base + (i < leftC - base * rest.length ? 1 : 0)) / 100; });
      }
    }
    const ready = !!intent.amount && included.length > 0 && involved.size > 1 && !mismatch;
    return { ...intent, payerId, included, ready, custom, amounts, mismatch, each: intent.amount && included.length ? intent.amount / included.length : null };
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
      // Uneven split: send exactly what the card shows. Equal splits send none.
      if (expense.custom && expense.amounts) fd.append("splitAmounts", JSON.stringify(expense.amounts));
      fd.append("date", expense.date ? new Date(`${expense.date}T12:00:00`).toISOString() : new Date().toISOString());
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
        track("expense_created", { context: "quick_add", split_type: expense.custom ? "custom" : "equal", amount: expense.amount, has_group: !!expense.groupId, people: expense.included.length, ai: !!aiIntent });
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
              {/* The AI read: a quiet sparkle while Haiku thinks, steady once its
                  card is showing. */}
              {showCard && (aiPending || aiIntent) && (
                <span className="absolute top-4 right-4" title={aiPending ? "Reading with AI…" : "Read by AI"} data-testid="quick-add-ai-mark">
                  <Sparkles className={`w-4 h-4 text-accent-foreground ${aiPending ? "animate-pulse" : ""}`} />
                </span>
              )}

              {demoActive && (
                <div className={`transition-opacity duration-200 ${demo.visible ? "opacity-100" : "opacity-0"}`}>
                  <ExampleCard
                    key={demo.index}
                    phrase={demo.card}
                    kind={DEMO_KINDS[demo.index]}
                    currency={currency}
                    tag={<span className="rounded-full border border-card-border px-2 py-0.5 text-[11px] text-muted-foreground">Example {demo.index + 1} of {DEMO_PHRASES.length}</span>}
                    footer={<p className="mt-3.5 text-[12.5px] text-muted-foreground">Your turn: start typing</p>}
                  />
                </div>
              )}

              {expense && (
                <div>
                  <CardHead icon={Receipt} label="Expense" />
                  <p className={`font-serif text-[26px] leading-[1.1] mb-2.5 break-words ${expense.description ? "" : "text-muted-foreground"}`}>
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
                    <Chip icon={CalendarDays}>{dateLabel(expense.date)}</Chip>
                  </div>

                  <div className="rounded-2xl bg-background px-3.5 py-3">
                    <div className="flex items-end justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] text-muted-foreground mb-2">{expense.custom ? "Custom split" : "Split equally"} · {expense.included.length}</p>
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
                        <p className="text-[11px] text-muted-foreground mt-1.5 truncate">
                          {expense.custom && expense.amounts
                            ? expense.included.map((id) => `${nameOf(id)} ${formatMoney(expense.amounts![id] ?? 0, currency)}`).join(" · ")
                            : expense.included.map(nameOf).join(", ")}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {expense.custom ? (
                          <>
                            <p className="text-[11px] text-muted-foreground">You pay</p>
                            <p className="font-mono tabular-nums text-[clamp(18px,6vw,24px)] leading-tight whitespace-nowrap">
                              {expense.amounts && user && expense.amounts[user.id] != null
                                ? formatMoney(expense.amounts[user.id], currency)
                                : <span className="text-muted-foreground">—</span>}
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-[11px] text-muted-foreground">Each pays</p>
                            <p className="font-mono tabular-nums text-[clamp(18px,6vw,24px)] leading-tight whitespace-nowrap">
                              {expense.each ? formatMoney(expense.each, currency) : <span className="text-muted-foreground">—</span>}
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {expense.unresolved?.length ? (
                    <p className="mt-2 px-1 text-xs text-muted-foreground">
                      Couldn't find {expense.unresolved.join(", ")}. Add them as a friend first, or tap the avatars to adjust.
                    </p>
                  ) : null}
                  {expense.mismatch && (
                    <p className="mt-2 px-1 text-xs text-[#8A5A1A]">
                      The shares add up to {formatMoney(expense.mismatch.stated, currency)}, but the total is {formatMoney(expense.mismatch.total, currency)}.
                    </p>
                  )}
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
                      <p className="font-mono tabular-nums text-[clamp(18px,6vw,24px)] shrink-0 whitespace-nowrap">
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
                        <div className="rounded-2xl bg-background px-3.5 py-3 min-w-0"><p className="text-[11px] text-muted-foreground">You're owed</p><FitText max={22} syncGroup="qa-balance" className={`font-mono tabular-nums ${AMOUNT_IN_CLASS}`}>{formatMoney(owed, currency)}</FitText></div>
                        <div className="rounded-2xl bg-background px-3.5 py-3 min-w-0"><p className="text-[11px] text-muted-foreground">You owe</p><FitText max={22} syncGroup="qa-balance" className={`font-mono tabular-nums ${AMOUNT_OUT_CLASS}`}>{formatMoney(owe, currency)}</FitText></div>
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
                      <div className="flex-1 min-w-0">
                        <p className="text-[15px] break-words">{bal > 0 ? `${name} owes you` : bal < 0 ? `You owe ${name}` : `You and ${name} are settled`}</p>
                        <FitText max={24} className={`font-mono tabular-nums leading-tight ${bal > 0 ? AMOUNT_IN_CLASS : bal < 0 ? AMOUNT_OUT_CLASS : "text-muted-foreground"}`}>{formatMoney(Math.abs(bal), currency)}</FitText>
                      </div>
                    </div>
                    <div className="flex justify-between items-center mt-3.5">
                      <button type="button" onClick={reset} className="text-[13px] text-muted-foreground px-1">Clear</button>
                      <button type="button" onClick={() => { reset(); setLocation(`/friends/${id}`); }} className="h-9 max-w-[60%] truncate rounded-full bg-foreground px-4 text-[13px] font-medium text-background">
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

// ── AI read helpers ──────────────────────────────────────────────────────────
/** The user's local date as YYYY-MM-DD (so "yesterday" means their yesterday). */
function localToday(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateLabel(date?: string): string {
  if (!date || date === localToday()) return "Today";
  if (date === localToday(new Date(Date.now() - 864e5))) return "Yesterday";
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

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
    settle, setSettle, settling, commitSettle,
    ending, speaking, userSpeaking, audioRef, meterRef, hangUp, commit,
  } = useVoiceCall({ onClose });
  const { user } = useAuth();

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
          <p className="font-serif text-[26px] leading-[1.1] mb-2.5 break-words">{preview.description.charAt(0).toUpperCase() + preview.description.slice(1)}</p>
          <div className="flex flex-wrap gap-1.5 mb-3.5">
            <Chip><span className="font-mono tabular-nums">{formatMoney(preview.amount, currency)}</span></Chip>
            <Chip icon={Wallet}>Paid by {preview.paidByYou === false && preview.paidByName ? preview.paidByName.split(" ")[0] : "you"}</Chip>
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
                  <p className="font-mono tabular-nums text-[clamp(18px,6vw,24px)] leading-tight whitespace-nowrap">{formatMoney(preview.perPerson, currency)}</p>
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

      {settle && user && (
        <div className="absolute bottom-full left-4 right-4 mb-3 rounded-[24px] border border-card-border bg-card p-4 shadow-[0_18px_48px_-16px_rgba(41,38,36,0.32),0_2px_8px_-2px_rgba(41,38,36,0.08)] animate-in fade-in-0 slide-in-from-bottom-2 duration-200" data-testid="quick-add-call-settle-card">
          <CardHead icon={ArrowLeftRight} label="Settle up" />
          <div className="rounded-2xl bg-background px-3.5 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[15px] min-w-0">
              <Avatar id={settle.friendIsPayer ? settle.personId : user.id} name={settle.friendIsPayer ? settle.name : "You"} color={avatarColor} />
              <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
              <Avatar id={settle.friendIsPayer ? user.id : settle.personId} name={settle.friendIsPayer ? "You" : settle.name} color={avatarColor} />
              <span className="truncate">{settle.friendIsPayer ? `${settle.name.split(" ")[0]} paid you` : `You paid ${settle.name.split(" ")[0]}`}</span>
            </div>
            <p className="font-mono tabular-nums text-[clamp(18px,6vw,24px)] shrink-0 whitespace-nowrap">{formatMoney(settle.amount, currency)}</p>
          </div>
          <p className="text-xs text-muted-foreground mt-2 px-1">
            {settle.groupName ? `In ${settle.groupName}. ` : ""}
            {Math.abs(settle.balanceAfter) < 0.01
              ? "This settles you up."
              : `After this, ${settle.balanceAfter > 0 ? `${settle.name.split(" ")[0]} owes you` : `you owe ${settle.name.split(" ")[0]}`} ${formatMoney(Math.abs(settle.balanceAfter), currency)}.`}
          </p>
          <CardFoot label="Record payment" ready pending={settling} clearLabel="Not quite" onClear={() => setSettle(null)} onSubmit={commitSettle} />
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
