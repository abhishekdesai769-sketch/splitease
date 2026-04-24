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

import { useState, useCallback } from "react";
import {
  Mic, MicOff, X, Check, Loader2, Crown, AlertCircle,
  DollarSign, Users, Navigation, BarChart2, ChevronRight,
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

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleMicPress = useCallback(() => {
    if (!user?.isPremium) {
      setUpgradeOpen(true);
      return;
    }
    setSheetOpen(true);
    if (isIOSSafariWeb) return; // Show "use the app" card — no iOS browser supports Web Speech API
    setShowExamples(false);
    startListening();
  }, [user?.isPremium, startListening]);

  const handleMicRelease = useCallback(() => {
    stopListening();
  }, [stopListening]);

  const handleClose = useCallback(() => {
    reset();
    setSheetOpen(false);
    setShowExamples(false);
    setSubmitting(false);
  }, [reset]);

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
    if (!parsedIntent || submitting) return;

    if (parsedIntent.type === "ask_balance") {
      handleClose();
      setLocation("/");
      toast({ title: "Here are your balances" });
      return;
    }

    if (parsedIntent.type === "add_expense" && !parsedIntent.friendId && !parsedIntent.groupId) {
      // Generic expense — no split target → guide user
      toast({
        title: "Who to split with?",
        description: "Say the name of a friend or group, or add it manually.",
        variant: "destructive",
      });
      return;
    }

    if (!parsedIntent.amount || !parsedIntent.description) {
      toast({ title: "Missing info", description: "Couldn't get the full expense details.", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("description", parsedIntent.description);
      fd.append("amount", parsedIntent.amount.toString());
      fd.append("paidById", parsedIntent.paidById!);
      fd.append("splitAmongIds", JSON.stringify(parsedIntent.splitAmongIds ?? []));
      fd.append("date", new Date().toISOString());

      if (parsedIntent.type === "split_group" && parsedIntent.groupId) {
        fd.append("groupId", parsedIntent.groupId);
        await fetch("/api/expenses", { method: "POST", body: fd, credentials: "include" });
        await queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
        await queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      } else {
        await fetch("/api/friends/expenses", { method: "POST", body: fd, credentials: "include" });
        await queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
        await queryClient.invalidateQueries({ queryKey: ["/api/friends"] });
      }

      track("voice_action_confirmed", {
        intent: parsedIntent.type,
        amount: parsedIntent.amount,
      });

      handleClose();
      toast({ title: "Expense added ✓", description: `${parsedIntent.description} — ${formatVoiceAmount(parsedIntent.amount, voiceCtx.defaultCurrency)}` });
      if (recordExpenseAndCheck()) setTimeout(() => triggerReview("expense_6"), 2000);
    } catch {
      toast({ title: "Failed to add expense", description: "Try again or add it manually.", variant: "destructive" });
      track("voice_error", { reason: "api_failure" });
    } finally {
      setSubmitting(false);
    }
  }, [parsedIntent, submitting, handleClose, setLocation, toast, voiceCtx.defaultCurrency]);

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
        onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); handleMicPress(); }}
        onPointerUp={handleMicRelease}
        onPointerLeave={handleMicRelease}
        onPointerCancel={handleMicRelease}
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
            {/* Close button */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                  <Mic className="w-3.5 h-3.5 text-primary" />
                </div>
                <span className="text-sm font-semibold text-foreground">Voice Mode</span>
              </div>
              <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors p-1">
                <X className="w-4 h-4" />
              </button>
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
                        <p className="text-xs text-muted-foreground">Release when done</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-muted-foreground">Hold the mic to speak</p>
                        <p className="text-xs text-muted-foreground">Release when you're done</p>
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
                  onPointerDown={(e) => { e.preventDefault(); reset(); startListening(); }}
                  onPointerUp={handleMicRelease}
                >
                  <Mic className="w-4 h-4 mr-2" />
                  Try again
                </Button>
              </div>
            )}

            {/* ── RESULT STATE ─────────────────────────────────────────── */}
            {voiceState === "result" && parsedIntent && (
              <div className="space-y-3">
                {/* Unknown intent */}
                {parsedIntent.type === "unknown" && (
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
                    <Button className="w-full" variant="outline" onPointerDown={(e) => { e.preventDefault(); reset(); startListening(); }} onPointerUp={handleMicRelease}>
                      <Mic className="w-4 h-4 mr-2" /> Try again
                    </Button>
                  </div>
                )}

                {/* Add_expense — no split target */}
                {parsedIntent.type === "add_expense" && !parsedIntent.friendId && !parsedIntent.groupId && (
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-4 space-y-1">
                      <p className="text-sm font-medium text-foreground">Who to split with?</p>
                      <p className="text-xs text-muted-foreground">
                        I heard "{parsedIntent.description}" — {parsedIntent.amount ? formatVoiceAmount(parsedIntent.amount, voiceCtx.defaultCurrency) : "unknown amount"}.
                        Say a friend's name or group to split it.
                      </p>
                    </div>
                    <Button className="w-full" variant="outline" onPointerDown={(e) => { e.preventDefault(); reset(); startListening(); }} onPointerUp={handleMicRelease}>
                      <Mic className="w-4 h-4 mr-2" /> Try again
                    </Button>
                  </div>
                )}

                {/* Balance query */}
                {parsedIntent.type === "ask_balance" && (
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
                {(parsedIntent.type === "split_friend" || parsedIntent.type === "split_group") && parsedIntent.amount && (
                  <div className="space-y-3">
                    {/* Card */}
                    <div className="rounded-2xl border border-border bg-card overflow-hidden">
                      {/* Header */}
                      <div className="px-4 py-3 border-b border-border bg-primary/5 flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-primary" />
                        <span className="text-sm font-semibold text-foreground">New Expense</span>
                      </div>
                      {/* Fields */}
                      <div className="px-4 py-3 space-y-2.5">
                        <Row label="Description" value={parsedIntent.description ?? "Expense"} />
                        <Row label="Amount" value={formatVoiceAmount(parsedIntent.amount, voiceCtx.defaultCurrency)} highlight />
                        <Row label="Paid by" value="You" />
                        {parsedIntent.type === "split_friend" && (
                          <Row label="Split with" value={`${parsedIntent.friendName} equally`} />
                        )}
                        {parsedIntent.type === "split_group" && (
                          <Row
                            label="Split in"
                            value={`${parsedIntent.groupName} (${parsedIntent.splitAmongIds?.length ?? 0} members)`}
                          />
                        )}
                      </div>
                      {/* Low confidence warning */}
                      {parsedIntent.confidence === "low" && (
                        <div className="px-4 py-2 border-t border-border bg-amber-500/5">
                          <p className="text-[11px] text-amber-600">
                            Double-check the details before confirming.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Transcript line */}
                    <p className="text-[11px] text-muted-foreground text-center italic px-2">
                      Heard: "{transcript}"
                    </p>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={handleClose} disabled={submitting}>
                        Cancel
                      </Button>
                      <Button className="flex-1" onClick={handleConfirm} disabled={submitting}>
                        {submitting ? (
                          <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4 mr-1.5" />
                        )}
                        {submitting ? "Adding…" : "Add Expense"}
                      </Button>
                    </div>
                  </div>
                )}
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
