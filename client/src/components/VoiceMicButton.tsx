/**
 * VoiceMicButton — floating mic button + full voice mode UI
 *
 * Renders:
 *   1. A fixed floating mic button (bottom-right, above nav bar)
 *   2. A bottom sheet that opens when voice mode is active:
 *      - Listening state: waveform + live transcript
 *      - Processing state: spinner
 *      - Result state: parsed intent confirmation card
 *      - Error state: error message + retry
 *
 * Premium-gated: non-premium users see the upgrade sheet on tap.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Mic, MicOff, Check, Loader2, Crown, AlertCircle,
  DollarSign, Users, UsersRound, Navigation, BarChart2, ChevronRight, Square,
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useVoiceMode } from "@/hooks/useVoiceMode";
import { formatVoiceAmount, VOICE_EXAMPLES } from "@/lib/voiceParser";
import type { SafeUser, Group } from "@shared/schema";
import { UpgradePromptSheet } from "./UpgradePromptSheet";
import { track } from "@/lib/analytics";
import { recordExpenseAndCheck, triggerReview } from "@/lib/reviewPrompt";
import { isIosNative } from "@/lib/iap";

// All iOS browsers (Safari, Chrome, Firefox) use WebKit — Apple blocks microphone
// access for web apps on iOS entirely. Only the native Capacitor app can use it.
const isIOSSafariWeb = !isIosNative && /iPhone|iPad|iPod/i.test(
  typeof navigator !== "undefined" ? navigator.userAgent : ""
);

// ─── Waveform animation ────────────────────────────────────────────────────────

const WAVE_KEYFRAMES = `
@keyframes voiceBarAnim {
  0%, 100% { transform: scaleY(0.15); }
  50%       { transform: scaleY(1); }
}
`;

// Bar heights give a natural-looking waveform shape
const BAR_HEIGHTS = [28, 48, 72, 56, 88, 100, 64, 44, 80, 96, 52, 76, 40, 88, 60, 36, 72, 56, 84, 48];

function VoiceWaveform({ active }: { active: boolean }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: WAVE_KEYFRAMES }} />
      <div className="flex items-center justify-center gap-[3px]" style={{ height: 40 }}>
        {BAR_HEIGHTS.map((h, i) => (
          <div
            key={i}
            style={{
              width: 3,
              height: 40,
              borderRadius: 9999,
              backgroundColor: "hsl(var(--primary))",
              transformOrigin: "center",
              transform: active ? undefined : "scaleY(0.15)",
              animation: active
                ? `voiceBarAnim ${0.6 + (i % 5) * 0.12}s ease-in-out infinite alternate`
                : "none",
              animationDelay: active ? `${i * 0.04}s` : "0s",
              opacity: active ? (0.4 + (h / 100) * 0.6) : 0.3,
            }}
          />
        ))}
      </div>
    </>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function VoiceMicButton() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showExamples, setShowExamples] = useState(false);

  // ── Clarification flow state ────────────────────────────────────────────────
  type ClarifyStep = "pick_target" | "get_amount" | "unequal_amounts";
  const [clarifyStep, setClarifyStep] = useState<ClarifyStep | null>(null);
  const [supp, setSupp] = useState<{
    groupId?: string; groupName?: string; friendId?: string; friendName?: string;
    splitAmongIds?: string[]; amount?: number; description?: string;
    splitType?: "equal" | "unequal"; unequalAmounts?: Record<string, number>;
    paidById?: string;
  }>({});
  const [amountStr, setAmountStr] = useState("");
  const [unequalStrs, setUnequalStrs] = useState<Record<string, string>>({});

  // Fetch friends + groups (uses existing cache — no extra API calls if already loaded)
  const { data: friends = [] } = useQuery<SafeUser[]>({
    queryKey: ["/api/friends"],
    enabled: !!user?.isPremium,
  });
  const { data: groups = [] } = useQuery<Group[]>({
    queryKey: ["/api/groups"],
    enabled: !!user?.isPremium,
  });

  const voiceCtx = {
    currentUserId: user?.id ?? "",
    friends: friends.map((f) => ({ id: f.id, name: f.name })),
    groups: groups.map((g) => ({ id: g.id, name: g.name, memberIds: g.memberIds })),
    defaultCurrency: user?.defaultCurrency ?? "CAD",
  };

  const {
    voiceState, transcript, interimTranscript, parsedIntent,
    errorMessage, isSupported, startListening, stopListening, reset,
  } = useVoiceMode(voiceCtx);

  const resolveName = useCallback((uid: string): string => {
    if (uid === user?.id) return user?.name ?? "You";
    return friends.find((f) => f.id === uid)?.name ?? "Member";
  }, [user, friends]);

  // Merge original parsed intent with clarification supplement
  const mergedIntent = useMemo(() => {
    if (!parsedIntent) return null;
    return { ...parsedIntent, ...supp };
  }, [parsedIntent, supp]);

  // After a voice result, determine if clarification steps are needed
  useEffect(() => {
    if (voiceState !== "result" || !parsedIntent) return;
    if (parsedIntent.type === "navigate" || parsedIntent.type === "cancel") return;
    const hasTarget = !!(parsedIntent.groupId || parsedIntent.friendId);
    const hasAmount = !!parsedIntent.amount;
    if (!hasTarget) {
      setSupp({ paidById: parsedIntent.paidById, description: parsedIntent.description, amount: parsedIntent.amount });
      setClarifyStep("pick_target");
    } else if (!hasAmount) {
      setSupp({ groupId: parsedIntent.groupId, groupName: parsedIntent.groupName, friendId: parsedIntent.friendId, friendName: parsedIntent.friendName, splitAmongIds: parsedIntent.splitAmongIds, paidById: parsedIntent.paidById, description: parsedIntent.description, splitType: parsedIntent.splitType });
      setClarifyStep("get_amount");
    } else if (parsedIntent.splitType === "unequal") {
      const members = parsedIntent.splitAmongIds ?? [];
      const initStrs: Record<string, string> = {};
      members.forEach((id) => { initStrs[id] = ""; });
      setUnequalStrs(initStrs);
      setSupp({ ...parsedIntent });
      setClarifyStep("unequal_amounts");
    }
    // else: clarifyStep stays null → normal confirmation card shown
  }, [voiceState, parsedIntent?.type, parsedIntent?.groupId, parsedIntent?.friendId, parsedIntent?.amount, parsedIntent?.splitType]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleMicTap = useCallback(() => {
    if (!user?.isPremium) {
      setUpgradeOpen(true);
      return;
    }
    // Tap-to-toggle: if already listening → stop; otherwise open sheet + start
    if (voiceState === "listening") {
      stopListening();
      return;
    }
    setSheetOpen(true);
    if (isIOSSafariWeb) return; // Show "use the app" card — no iOS browser supports Web Speech API
    setShowExamples(false);
    startListening();
  }, [user?.isPremium, voiceState, stopListening, startListening]);

  const handleClose = useCallback(() => {
    reset();
    setSheetOpen(false);
    setShowExamples(false);
    setSubmitting(false);
    setClarifyStep(null);
    setSupp({});
    setAmountStr("");
    setUnequalStrs({});
  }, [reset]);

  // ── Clarification handlers ────────────────────────────────────────────────

  const handlePickGroup = useCallback((g: { id: string; name: string; memberIds: string[] }) => {
    const updated = { ...supp, groupId: g.id, groupName: g.name, splitAmongIds: g.memberIds, splitType: (supp.splitType ?? "equal") as "equal" | "unequal" };
    setSupp(updated);
    if (!updated.amount) {
      setClarifyStep("get_amount");
    } else if (updated.splitType === "unequal") {
      const initStrs: Record<string, string> = {};
      g.memberIds.forEach((id) => { initStrs[id] = ""; });
      setUnequalStrs(initStrs);
      setClarifyStep("unequal_amounts");
    } else {
      setClarifyStep(null);
    }
  }, [supp]);

  const handlePickFriend = useCallback((f: { id: string; name: string }) => {
    const splitAmongIds = [voiceCtx.currentUserId, f.id];
    const updated = { ...supp, friendId: f.id, friendName: f.name, splitAmongIds, splitType: (supp.splitType ?? "equal") as "equal" | "unequal" };
    setSupp(updated);
    if (!updated.amount) {
      setClarifyStep("get_amount");
    } else {
      setClarifyStep(null);
    }
  }, [supp, voiceCtx.currentUserId]);

  const handleAmountConfirm = useCallback(() => {
    const amt = parseFloat(amountStr);
    if (!amt || amt <= 0) return;
    const updated = { ...supp, amount: amt };
    setSupp(updated);
    if (updated.splitType === "unequal" && updated.splitAmongIds) {
      const initStrs: Record<string, string> = {};
      updated.splitAmongIds.forEach((id) => { initStrs[id] = ""; });
      setUnequalStrs(initStrs);
      setClarifyStep("unequal_amounts");
    } else {
      setClarifyStep(null);
    }
  }, [amountStr, supp]);

  const handleUnequalConfirm = useCallback(() => {
    const amounts: Record<string, number> = {};
    for (const [id, val] of Object.entries(unequalStrs)) {
      const n = parseFloat(val);
      if (n > 0) amounts[id] = n;
    }
    setSupp((prev) => ({ ...prev, unequalAmounts: amounts }));
    setClarifyStep(null);
  }, [unequalStrs]);

  // ── Handle "navigate" intent immediately ──────────────────────────────────

  if (voiceState === "result" && parsedIntent?.type === "navigate" && parsedIntent.destination) {
    setLocation(parsedIntent.destination);
    handleClose();
    toast({ title: "Navigated ✓" });
  }

  if (voiceState === "result" && parsedIntent?.type === "cancel") {
    handleClose();
  }

  // ── Confirm expense / balance action ─────────────────────────────────────

  const handleConfirm = useCallback(async () => {
    const intent = mergedIntent;
    if (!intent || submitting) return;

    if (intent.type === "ask_balance") {
      handleClose();
      setLocation("/");
      toast({ title: "Here are your balances" });
      return;
    }

    if ((intent.type === "add_expense" || intent.type === "split_friend" || intent.type === "split_group") && !intent.friendId && !intent.groupId) {
      toast({ title: "Who to split with?", description: "Say the name of a friend or group, or add it manually.", variant: "destructive" });
      return;
    }

    if (!intent.amount || !intent.description) {
      toast({ title: "Missing info", description: "Couldn't get the full expense details.", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("description", intent.description);
      fd.append("amount", intent.amount.toString());
      fd.append("paidById", intent.paidById ?? voiceCtx.currentUserId);
      fd.append("date", new Date().toISOString());

      // Unequal split — use splitAmounts JSON
      if (intent.unequalAmounts && Object.keys(intent.unequalAmounts).length > 0) {
        fd.append("splitAmongIds", JSON.stringify(Object.keys(intent.unequalAmounts)));
        fd.append("splitAmounts", JSON.stringify(intent.unequalAmounts));
      } else {
        fd.append("splitAmongIds", JSON.stringify(intent.splitAmongIds ?? []));
      }

      if ((intent.type === "split_group" || intent.groupId) && intent.groupId) {
        fd.append("groupId", intent.groupId);
        await fetch("/api/expenses", { method: "POST", body: fd, credentials: "include" });
        await queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
        await queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      } else {
        await fetch("/api/friends/expenses", { method: "POST", body: fd, credentials: "include" });
        await queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
        await queryClient.invalidateQueries({ queryKey: ["/api/friends"] });
      }

      track("voice_action_confirmed", { intent: intent.type, amount: intent.amount });
      handleClose();
      toast({ title: "Expense added ✓", description: `${intent.description} — ${formatVoiceAmount(intent.amount, voiceCtx.defaultCurrency)}` });
      if (recordExpenseAndCheck()) setTimeout(() => triggerReview("expense_6"), 2000);
    } catch {
      toast({ title: "Failed to add expense", description: "Try again or add it manually.", variant: "destructive" });
      track("voice_error", { reason: "api_failure" });
    } finally {
      setSubmitting(false);
    }
  }, [mergedIntent, submitting, handleClose, setLocation, toast, voiceCtx.defaultCurrency, voiceCtx.currentUserId]);

  // ─── Don't render if not logged in ────────────────────────────────────────

  if (!user) return null;

  // ─── Floating mic button ───────────────────────────────────────────────────

  const isPremium = !!user.isPremium;

  return (
    <>
      {/* Floating mic button — fixed above bottom nav */}
      <button
        className={`fixed right-4 z-40 flex items-center justify-center rounded-full shadow-lg transition-all duration-200 select-none
          ${isPremium
            ? "w-14 h-14 bg-primary text-primary-foreground hover:scale-105 active:scale-95"
            : "w-14 h-14 bg-muted border border-border text-muted-foreground hover:bg-muted/80"
          }`}
        style={{ bottom: "76px" }} // clears the 64px nav bar
        onClick={handleMicTap}
        aria-label="Voice mode"
        data-testid="voice-mic-button"
      >
        {isPremium ? (
          <Mic className="w-6 h-6" />
        ) : (
          <>
            <Mic className="w-5 h-5" />
            <Crown className="w-3 h-3 absolute bottom-2 right-2 text-amber-500" />
          </>
        )}
      </button>

      {/* Voice mode bottom sheet */}
      <Sheet open={sheetOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl pb-safe select-none"
          style={{ maxHeight: "70vh", touchAction: "none" }}
        >
          <div className="pt-1 pb-6 px-1">
            {/* Header */}
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                <Mic className="w-3.5 h-3.5 text-primary" />
              </div>
              <span className="text-sm font-semibold text-foreground">Voice Mode</span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/20 tracking-wide">
                BETA
              </span>
            </div>

            {/* ── iOS: Voice Mode not yet supported ────────────────────── */}
            {isIOSSafariWeb ? (
              <div className="space-y-4 py-2">
                <div className="rounded-2xl border border-border bg-muted/20 px-4 py-5 flex flex-col items-center gap-3 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <Mic className="w-6 h-6 text-primary" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">Voice Mode needs the app 🎤</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      iOS doesn't allow microphone access in web browsers — it's an Apple restriction that applies to all browsers on iPhone, including Chrome.
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Get the free <span className="font-medium text-foreground">Spliiit app from the App Store</span> to use Voice Mode.
                    </p>
                  </div>
                </div>
                <Button className="w-full" variant="outline" onClick={handleClose}>
                  Got it
                </Button>
              </div>
            ) : <>

            {/* ── LISTENING STATE ──────────────────────────────────────── */}
            {(voiceState === "listening" || voiceState === "idle") && (
              <div className="space-y-5">
                {/* Waveform */}
                <div className="rounded-2xl border border-border bg-muted/20 px-4 py-5 space-y-3">
                  <VoiceWaveform active={voiceState === "listening"} />
                  <div className="text-center space-y-1">
                    {voiceState === "listening" ? (
                      <>
                        <p className="text-sm font-medium text-primary">Listening…</p>
                        <p className="text-xs text-muted-foreground">Tap the stop button when done</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-muted-foreground">Tap the mic to speak</p>
                        <p className="text-xs text-muted-foreground">Tap stop when you're done</p>
                      </>
                    )}
                  </div>
                  {/* Live transcript */}
                  {(transcript || interimTranscript) && (
                    <div className="mt-2 px-3 py-2 rounded-xl bg-background border border-border text-sm text-foreground text-center min-h-[2rem]">
                      {transcript || interimTranscript}
                      {interimTranscript && <span className="text-muted-foreground">…</span>}
                    </div>
                  )}
                </div>

                {/* Stop button — big circular button, only shown while actively listening */}
                {voiceState === "listening" && (
                  <div className="flex justify-center">
                    <button
                      onClick={stopListening}
                      className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg hover:bg-red-600 active:scale-95 transition-all duration-150"
                      aria-label="Stop listening"
                    >
                      <Square className="w-6 h-6 fill-current" />
                    </button>
                  </div>
                )}

                {/* Examples hint */}
                <div>
                  <button
                    onClick={() => setShowExamples(!showExamples)}
                    className="w-full flex items-center justify-between text-xs text-muted-foreground px-1 py-1 hover:text-foreground transition-colors"
                  >
                    <span>What can I say?</span>
                    <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showExamples ? "rotate-90" : ""}`} />
                  </button>
                  {showExamples && (
                    <div className="mt-2 space-y-1.5">
                      {VOICE_EXAMPLES.map((ex) => (
                        <div key={ex} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40 text-xs text-muted-foreground">
                          <Mic className="w-3 h-3 shrink-0 text-primary" />
                          <span>"{ex}"</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Early access disclaimer */}
                <p className="text-[11px] text-muted-foreground text-center leading-relaxed px-3">
                  🧪 <span className="font-medium">Early Access</span> — Voice Mode is still being trained and improved. As a premium member, you get it first. It'll keep getting better!
                </p>
              </div>
            )}

            {/* ── PROCESSING STATE ─────────────────────────────────────── */}
            {voiceState === "processing" && (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <p className="text-sm text-muted-foreground">Understanding…</p>
                {transcript && (
                  <p className="text-xs text-muted-foreground italic text-center max-w-[260px]">
                    "{transcript}"
                  </p>
                )}
              </div>
            )}

            {/* ── ERROR STATE ──────────────────────────────────────────── */}
            {voiceState === "error" && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-4 py-4 flex gap-3">
                  <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{errorMessage ?? "Something went wrong"}</p>
                    {!isSupported && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Voice Mode works best in Chrome or Edge.
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => { reset(); startListening(); }}
                >
                  <Mic className="w-4 h-4 mr-2" />
                  Try again
                </Button>
              </div>
            )}

            {/* ── RESULT STATE ─────────────────────────────────────────── */}
            {voiceState === "result" && parsedIntent && (
              <div className="space-y-3">

                {/* ── CLARIFY: pick target ─────────────────────────────── */}
                {clarifyStep === "pick_target" && (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
                      <p className="text-xs text-muted-foreground mb-1">I heard:</p>
                      <p className="text-sm font-medium text-foreground italic">"{transcript}"</p>
                      {supp.amount && <p className="text-xs text-muted-foreground mt-1">Amount: {formatVoiceAmount(supp.amount, voiceCtx.defaultCurrency)}</p>}
                    </div>
                    <p className="text-sm font-semibold text-foreground">Who to split it with?</p>
                    {voiceCtx.groups.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide px-1">Groups</p>
                        {voiceCtx.groups.slice(0, 5).map((g) => (
                          <button key={g.id} onClick={() => handlePickGroup(g)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-muted/20 hover:bg-muted/40 transition-colors text-left">
                            <UsersRound className="w-4 h-4 text-primary shrink-0" />
                            <span className="text-sm font-medium text-foreground">{g.name}</span>
                            <span className="text-xs text-muted-foreground ml-auto">{g.memberIds.length} members</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {voiceCtx.friends.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide px-1">Friends</p>
                        {voiceCtx.friends.slice(0, 5).map((f) => (
                          <button key={f.id} onClick={() => handlePickFriend(f)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-muted/20 hover:bg-muted/40 transition-colors text-left">
                            <Users className="w-4 h-4 text-primary shrink-0" />
                            <span className="text-sm font-medium text-foreground">{f.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <Button variant="outline" className="w-full" onClick={handleClose}>Cancel</Button>
                  </div>
                )}

                {/* ── CLARIFY: get amount ──────────────────────────────── */}
                {clarifyStep === "get_amount" && (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 space-y-1">
                      <p className="text-xs text-muted-foreground">Got so far:</p>
                      {supp.groupName && <p className="text-sm font-medium text-foreground">Group: <span className="text-primary">{supp.groupName}</span></p>}
                      {supp.friendName && <p className="text-sm font-medium text-foreground">With: <span className="text-primary">{supp.friendName}</span></p>}
                      {supp.description && <p className="text-xs text-muted-foreground">For: {supp.description}</p>}
                    </div>
                    <p className="text-sm font-semibold text-foreground">How much was it?</p>
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={amountStr}
                      onChange={(e) => setAmountStr(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAmountConfirm()}
                      autoFocus
                      className="w-full h-11 rounded-xl border border-border bg-background px-4 text-lg font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={handleClose}>Cancel</Button>
                      <Button className="flex-1" onClick={handleAmountConfirm} disabled={!amountStr || parseFloat(amountStr) <= 0}>
                        <Check className="w-4 h-4 mr-1.5" /> Got it
                      </Button>
                    </div>
                  </div>
                )}

                {/* ── CLARIFY: unequal amounts ─────────────────────────── */}
                {clarifyStep === "unequal_amounts" && (() => {
                  const members = supp.splitAmongIds ?? [];
                  const totalEntered = members.reduce((s, id) => s + (parseFloat(unequalStrs[id] ?? "") || 0), 0);
                  const totalMatch = Math.abs(totalEntered - (supp.amount ?? 0)) < 0.02;
                  return (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 space-y-0.5">
                        <p className="text-xs text-muted-foreground">Custom split</p>
                        <p className="text-sm font-semibold text-foreground">{supp.description} — {formatVoiceAmount(supp.amount ?? 0, voiceCtx.defaultCurrency)}</p>
                        {supp.groupName && <p className="text-xs text-muted-foreground">in {supp.groupName}</p>}
                        {supp.friendName && <p className="text-xs text-muted-foreground">with {supp.friendName}</p>}
                      </div>
                      <p className="text-sm font-semibold text-foreground">Enter each person's share:</p>
                      <div className="space-y-2">
                        {members.map((uid) => (
                          <div key={uid} className="flex items-center gap-3">
                            <span className="text-sm text-foreground flex-1 truncate">{resolveName(uid)}</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              placeholder="0.00"
                              value={unequalStrs[uid] ?? ""}
                              onChange={(e) => setUnequalStrs((prev) => ({ ...prev, [uid]: e.target.value }))}
                              className="w-24 h-9 rounded-lg border border-border bg-background px-3 text-sm text-right text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between items-center text-xs px-1">
                        <span className="text-muted-foreground">Total assigned</span>
                        <span className={totalMatch ? "text-green-500 font-semibold" : "text-amber-500 font-semibold"}>
                          {formatVoiceAmount(totalEntered, voiceCtx.defaultCurrency)} / {formatVoiceAmount(supp.amount ?? 0, voiceCtx.defaultCurrency)}
                        </span>
                      </div>
                      {!totalMatch && totalEntered > 0 && (
                        <p className="text-[11px] text-amber-600 text-center">Amounts don't add up to the total yet</p>
                      )}
                      <div className="flex gap-2">
                        <Button variant="outline" className="flex-1" onClick={handleClose}>Cancel</Button>
                        <Button className="flex-1" onClick={handleUnequalConfirm} disabled={!totalMatch}>
                          <Check className="w-4 h-4 mr-1.5" /> Confirm Split
                        </Button>
                      </div>
                    </div>
                  );
                })()}

                {/* ── Normal result (clarifyStep === null) ─────────────── */}
                {clarifyStep === null && (() => {
                  const intent = mergedIntent;
                  if (!intent) return null;
                  return (
                    <>
                      {/* Unknown intent */}
                      {intent.type === "unknown" && (
                        <div className="space-y-3">
                          <div className="rounded-2xl border border-border bg-muted/20 px-4 py-4">
                            <p className="text-sm font-medium text-foreground mb-1">Didn't understand that</p>
                            <p className="text-xs text-muted-foreground">"{transcript}"</p>
                            <div className="mt-3 space-y-1">
                              <p className="text-xs text-muted-foreground font-medium">Try saying:</p>
                              {VOICE_EXAMPLES.slice(0, 3).map((ex) => (
                                <p key={ex} className="text-xs text-muted-foreground">• "{ex}"</p>
                              ))}
                            </div>
                          </div>
                          <Button className="w-full" variant="outline" onClick={() => { reset(); startListening(); }}>
                            <Mic className="w-4 h-4 mr-2" /> Try again
                          </Button>
                        </div>
                      )}

                      {/* Add_expense — no split target */}
                      {intent.type === "add_expense" && !intent.friendId && !intent.groupId && (
                        <div className="space-y-3">
                          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-4 space-y-1">
                            <p className="text-sm font-medium text-foreground">Who to split with?</p>
                            <p className="text-xs text-muted-foreground">
                              I heard "{intent.description}" — {intent.amount ? formatVoiceAmount(intent.amount, voiceCtx.defaultCurrency) : "unknown amount"}.
                              Say a friend's name or group to split it.
                            </p>
                          </div>
                          <Button className="w-full" variant="outline" onClick={() => { reset(); startListening(); }}>
                            <Mic className="w-4 h-4 mr-2" /> Try again
                          </Button>
                        </div>
                      )}

                      {/* Balance query */}
                      {intent.type === "ask_balance" && (
                        <div className="space-y-3">
                          <div className="rounded-2xl border border-border bg-muted/20 px-4 py-4 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                              <BarChart2 className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-foreground">View your balances</p>
                              <p className="text-xs text-muted-foreground">Go to Dashboard to see who owes who</p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" className="flex-1" onClick={handleClose}>Cancel</Button>
                            <Button className="flex-1" onClick={handleConfirm}>
                              <Navigation className="w-4 h-4 mr-1.5" />
                              Go to Dashboard
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Expense confirmation card */}
                      {(intent.type === "split_friend" || intent.type === "split_group" || intent.groupId || intent.friendId) && intent.amount && (
                        <div className="space-y-3">
                          <div className="rounded-2xl border border-border bg-card overflow-hidden">
                            <div className="px-4 py-3 border-b border-border bg-primary/5 flex items-center gap-2">
                              <DollarSign className="w-4 h-4 text-primary" />
                              <span className="text-sm font-semibold text-foreground">New Expense</span>
                              {intent.unequalAmounts && (
                                <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/20">Custom split</span>
                              )}
                            </div>
                            <div className="px-4 py-3 space-y-2.5">
                              <Row label="Description" value={intent.description ?? "Expense"} />
                              <Row label="Amount" value={formatVoiceAmount(intent.amount, voiceCtx.defaultCurrency)} highlight />
                              <Row label="Paid by" value="You" />
                              {intent.friendName && <Row label="Split with" value={intent.unequalAmounts ? `${intent.friendName} (custom)` : `${intent.friendName} equally`} />}
                              {intent.groupName && <Row label="Split in" value={intent.unequalAmounts ? `${intent.groupName} (custom amounts)` : `${intent.groupName} (${(intent.splitAmongIds ?? []).length} members equally)`} />}
                              {intent.unequalAmounts && (
                                <div className="pt-1 space-y-1">
                                  {Object.entries(intent.unequalAmounts).map(([uid, amt]) => (
                                    <div key={uid} className="flex justify-between text-xs text-muted-foreground">
                                      <span>{resolveName(uid)}</span>
                                      <span>{formatVoiceAmount(amt, voiceCtx.defaultCurrency)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            {intent.confidence === "low" && !intent.unequalAmounts && (
                              <div className="px-4 py-2 border-t border-border bg-amber-500/5">
                                <p className="text-[11px] text-amber-600">Double-check the details before confirming.</p>
                              </div>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground text-center italic px-2">Heard: "{transcript}"</p>
                          <div className="flex gap-2">
                            <Button variant="outline" className="flex-1" onClick={handleClose} disabled={submitting}>Cancel</Button>
                            <Button className="flex-1" onClick={handleConfirm} disabled={submitting}>
                              {submitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Check className="w-4 h-4 mr-1.5" />}
                              {submitting ? "Adding…" : "Add Expense"}
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
            </>} {/* end isIOSSafariWeb ternary */}
          </div>
        </SheetContent>
      </Sheet>

      {/* Upgrade sheet for non-premium users */}
      <UpgradePromptSheet open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
    </>
  );
}

// ─── Small helper ─────────────────────────────────────────────────────────────

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={`text-sm text-right ${highlight ? "font-semibold text-foreground" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}
