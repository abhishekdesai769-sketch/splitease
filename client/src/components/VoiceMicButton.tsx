/**
 * VoiceMicButton — floating mic button + step-by-step voice wizard
 *
 * The wizard guides the user question-by-question:
 *   ask_target → ask_description → ask_amount → ask_split_type
 *   → ask_members (groups only) → unequal_amounts (if unequal) → null (confirmation card)
 *
 * TTS (Web Speech API speechSynthesis) speaks each question aloud.
 * STT (Web Speech API SpeechRecognition via useVoiceMode) captures the answer.
 * The mic auto-starts after each question finishes speaking — fully hands-free.
 *
 * Premium-gated: non-premium users see the upgrade sheet on tap.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Mic, MicOff, Check, Loader2, Crown, AlertCircle,
  DollarSign, Users, UsersRound, Square,
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useVoiceMode } from "@/hooks/useVoiceMode";
import {
  formatVoiceAmount,
  matchVoiceTarget,
  parseVoiceAmountOnly,
  parseVoiceDescription,
  parseVoiceSplitType,
  parseVoiceMembers,
} from "@/lib/voiceParser";
import type { SafeUser, Group } from "@shared/schema";
import { UpgradePromptSheet } from "./UpgradePromptSheet";
import { track } from "@/lib/analytics";
import { recordExpenseAndCheck, triggerReview } from "@/lib/reviewPrompt";
import { isIosNative } from "@/lib/iap";
import { isInTWA } from "@/lib/platform";
import { speak, stopSpeaking } from "@/lib/speech";

// iOS browsers block microphone access in web views — only the native Capacitor app can use it.
const isIOSSafariWeb = !isIosNative && /iPhone|iPad|iPod/i.test(
  typeof navigator !== "undefined" ? navigator.userAgent : ""
);

// ─── Waveform animation ────────────────────────────────────────────────────────

const BAR_HEIGHTS = [40, 60, 80, 55, 70, 45, 85, 50, 65, 75, 42, 68];

function VoiceWaveform({ active }: { active: boolean }) {
  return (
    <>
      <style>{`
        @keyframes voiceBarAnim {
          0%   { transform: scaleY(0.15); }
          100% { transform: scaleY(1); }
        }
      `}</style>
      <div className="flex items-center justify-center gap-[3px] h-10">
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

// ─── Wizard types ──────────────────────────────────────────────────────────────

type WizardStep =
  | "ask_target"       // "Who do you want to split with?"
  | "ask_description"  // "What was this for?"
  | "ask_amount"       // "How much did you pay?"
  | "ask_split_type"   // "Equally or unequally?"
  | "ask_members"      // "Who in the group?" (groups only)
  | "unequal_amounts"  // Text form for custom per-person amounts
  | null;              // Show confirmation card

interface WizardData {
  groupId?: string;
  groupName?: string;
  friendId?: string;
  friendName?: string;
  splitAmongIds?: string[];
  description?: string;
  amount?: number;
  splitType?: "equal" | "unequal";
  unequalAmounts?: Record<string, number>;
}

// ─── Main component ────────────────────────────────────────────────────────────

export function VoiceMicButton() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Wizard state
  const [wizardStep, setWizardStep] = useState<WizardStep>(null);
  const [data, setData] = useState<WizardData>({});
  const [unequalStrs, setUnequalStrs] = useState<Record<string, string>>({});
  const [tapMemberIds, setTapMemberIds] = useState<string[]>([]); // tap fallback for ask_members

  // Remote data
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
    voiceState, transcript, interimTranscript,
    errorMessage, isSupported, startListening, stopListening, reset,
  } = useVoiceMode(voiceCtx);

  const resolveName = useCallback((uid: string): string => {
    if (uid === user?.id) return user?.name ?? "You";
    return friends.find((f) => f.id === uid)?.name ?? "Member";
  }, [user, friends]);

  // ── Stable refs (for use inside effects without stale closures) ───────────
  const dataRef = useRef<WizardData>({});
  useEffect(() => { dataRef.current = data; }, [data]);

  const transcriptRef = useRef("");
  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);

  const startListeningRef = useRef(startListening);
  useEffect(() => { startListeningRef.current = startListening; }, [startListening]);

  const groupsRef = useRef(groups);
  useEffect(() => { groupsRef.current = groups; }, [groups]);

  const friendsRef = useRef(friends);
  useEffect(() => { friendsRef.current = friends; }, [friends]);

  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  // ── Speak the step question, then auto-start listening ────────────────────
  useEffect(() => {
    if (!wizardStep || wizardStep === "unequal_amounts") return;
    let cancelled = false;

    const buildQuestion = (): string => {
      const d = dataRef.current;
      switch (wizardStep) {
        case "ask_target":
          return "Who do you want to split this with?";
        case "ask_description":
          return `Got it — ${d.groupName ?? d.friendName}. What was this for?`;
        case "ask_amount":
          return "How much did you pay?";
        case "ask_split_type":
          return "Should I split it equally or unequally?";
        case "ask_members": {
          const g = groupsRef.current.find(gr => gr.id === d.groupId);
          const count = g?.memberIds.length ?? 0;
          return `Who should I split it between? The group has ${count} member${count !== 1 ? "s" : ""}.`;
        }
        default: return "";
      }
    };

    speak(buildQuestion()).then(() => {
      if (!cancelled) startListeningRef.current();
    });
    return () => { cancelled = true; stopSpeaking(); };
  }, [wizardStep]);

  // ── Process voice result per wizard step ──────────────────────────────────
  useEffect(() => {
    if (voiceState !== "result") return;
    const t = transcriptRef.current;

    switch (wizardStep) {

      case "ask_target": {
        const gList = groupsRef.current.map(g => ({ id: g.id, name: g.name, memberIds: g.memberIds }));
        const fList = friendsRef.current.map(f => ({ id: f.id, name: f.name }));
        const match = matchVoiceTarget(t, gList, fList);
        if (!match) {
          speak("I couldn't find that in your list. Try saying the group or friend name.")
            .then(startListeningRef.current);
          return;
        }
        setData(prev => ({ ...prev, ...match }));
        reset();
        setWizardStep("ask_description");
        break;
      }

      case "ask_description": {
        const desc = parseVoiceDescription(t);
        setData(prev => ({ ...prev, description: desc }));
        reset();
        setWizardStep("ask_amount");
        break;
      }

      case "ask_amount": {
        const amt = parseVoiceAmountOnly(t);
        if (!amt) {
          speak("I didn't catch that. How much did you pay?")
            .then(startListeningRef.current);
          return;
        }
        setData(prev => ({ ...prev, amount: amt }));
        reset();
        setWizardStep("ask_split_type");
        break;
      }

      case "ask_split_type": {
        const splitType = parseVoiceSplitType(t);
        if (!splitType) {
          speak("Say equally or unequally.").then(startListeningRef.current);
          return;
        }
        const d = dataRef.current;
        const currentUserId = userRef.current?.id ?? "";
        setData(prev => ({ ...prev, splitType }));
        reset();
        if (d.groupId) {
          // Group split — need to ask who's included
          const g = groupsRef.current.find(gr => gr.id === d.groupId);
          if (g) setTapMemberIds(g.memberIds); // default: all checked
          setWizardStep("ask_members");
        } else {
          // Friend split — two people only
          const splitAmongIds = [currentUserId, d.friendId!].filter(Boolean) as string[];
          setData(prev => ({ ...prev, splitAmongIds }));
          if (splitType === "unequal") {
            const initStrs: Record<string, string> = {};
            splitAmongIds.forEach(id => { initStrs[id] = ""; });
            setUnequalStrs(initStrs);
            setWizardStep("unequal_amounts");
          } else {
            setWizardStep(null); // → confirmation card
          }
        }
        break;
      }

      case "ask_members": {
        const d = dataRef.current;
        const g = groupsRef.current.find(gr => gr.id === d.groupId);
        if (!g) { reset(); setWizardStep(null); return; }
        const membersWithNames = g.memberIds.map(id => ({
          id,
          name: id === (userRef.current?.id ?? "")
            ? (userRef.current?.name ?? "You")
            : (friendsRef.current.find(f => f.id === id)?.name ?? "Member"),
        }));
        const selectedIds = parseVoiceMembers(t, membersWithNames);
        if (!selectedIds || selectedIds.length === 0) {
          speak("I didn't catch that. Who should I split it between?")
            .then(startListeningRef.current);
          return;
        }
        setData(prev => ({ ...prev, splitAmongIds: selectedIds }));
        reset();
        if (d.splitType === "unequal") {
          const initStrs: Record<string, string> = {};
          selectedIds.forEach(id => { initStrs[id] = ""; });
          setUnequalStrs(initStrs);
          setWizardStep("unequal_amounts");
        } else {
          setWizardStep(null); // → confirmation card
        }
        break;
      }
    }
  }, [voiceState, wizardStep]);

  // ── Tap-select handlers for ask_members fallback ──────────────────────────
  const handleToggleMember = useCallback((uid: string) => {
    setTapMemberIds(prev =>
      prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]
    );
  }, []);

  const handleConfirmMembers = useCallback(() => {
    if (tapMemberIds.length === 0) return;
    const d = dataRef.current;
    setData(prev => ({ ...prev, splitAmongIds: tapMemberIds }));
    if (d.splitType === "unequal") {
      const initStrs: Record<string, string> = {};
      tapMemberIds.forEach(id => { initStrs[id] = ""; });
      setUnequalStrs(initStrs);
      setWizardStep("unequal_amounts");
    } else {
      setWizardStep(null);
    }
  }, [tapMemberIds]);

  // ── Unequal amounts text-form confirm ─────────────────────────────────────
  const handleUnequalConfirm = useCallback(() => {
    const amounts: Record<string, number> = {};
    for (const [id, val] of Object.entries(unequalStrs)) {
      const n = parseFloat(val);
      if (n > 0) amounts[id] = n;
    }
    setData(prev => ({ ...prev, unequalAmounts: amounts }));
    setWizardStep(null);
  }, [unequalStrs]);

  // ── Close & reset ─────────────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    stopSpeaking();
    reset();
    setSheetOpen(false);
    setWizardStep(null);
    setData({});
    setUnequalStrs({});
    setTapMemberIds([]);
    setSubmitting(false);
  }, [reset]);

  // ── Mic button tap → open sheet + start wizard ────────────────────────────
  const handleMicTap = useCallback(() => {
    if (!user?.isPremium) { setUpgradeOpen(true); return; }
    if (voiceState === "listening") { stopListening(); return; }
    if (sheetOpen) return;
    setSheetOpen(true);
    if (isIOSSafariWeb) return;
    // Reset any previous session and kick off the wizard
    reset();
    setData({});
    setUnequalStrs({});
    setTapMemberIds([]);
    setWizardStep("ask_target"); // speak+listen effect takes over from here
  }, [user?.isPremium, voiceState, stopListening, sheetOpen, reset]);

  // ── Submit the expense ────────────────────────────────────────────────────
  const handleConfirm = useCallback(async () => {
    const d = dataRef.current;
    if (!d.amount || (!d.groupId && !d.friendId) || submitting) return;

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("description", d.description ?? "Expense");
      fd.append("amount", String(d.amount));
      fd.append("paidById", userRef.current?.id ?? "");
      fd.append("date", new Date().toISOString());

      if (d.unequalAmounts && Object.keys(d.unequalAmounts).length > 0) {
        fd.append("splitAmongIds", JSON.stringify(Object.keys(d.unequalAmounts)));
        fd.append("splitAmounts", JSON.stringify(d.unequalAmounts));
      } else {
        fd.append("splitAmongIds", JSON.stringify(d.splitAmongIds ?? []));
      }

      if (d.groupId) {
        fd.append("groupId", d.groupId);
        await fetch("/api/expenses", { method: "POST", body: fd, credentials: "include" });
        await queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
        await queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      } else {
        await fetch("/api/friends/expenses", { method: "POST", body: fd, credentials: "include" });
        await queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
        await queryClient.invalidateQueries({ queryKey: ["/api/friends"] });
      }

      track("voice_action_confirmed", { wizardSplit: d.splitType, hasGroup: !!d.groupId });
      handleClose();
      toast({
        title: "Expense added ✓",
        description: `${d.description ?? "Expense"} — ${formatVoiceAmount(d.amount, voiceCtx.defaultCurrency)}`,
      });
      if (recordExpenseAndCheck()) setTimeout(() => triggerReview("expense_6"), 2000);
    } catch {
      toast({ title: "Failed to add expense", description: "Try again or add it manually.", variant: "destructive" });
      track("voice_error", { reason: "api_failure" });
    } finally {
      setSubmitting(false);
    }
  }, [submitting, handleClose, toast, voiceCtx.defaultCurrency]);

  if (!user) return null;

  // In the Android TWA, hide the voice mic entirely for non-premium users
  // (Google Play policy: no premium teaser UI). Premium users — including
  // those who paid via web Stripe — still see the button and use voice.
  if (isInTWA && !user.isPremium) return null;

  const isPremium = !!user.isPremium;
  const isListening = voiceState === "listening";
  const isProcessing = voiceState === "processing";

  // ── Shared UI fragments ───────────────────────────────────────────────────

  const ListenCard = ({ hint, subhint }: { hint: string; subhint?: string }) => (
    <div className="rounded-2xl border border-border bg-muted/20 px-4 py-5 space-y-3">
      <VoiceWaveform active={isListening} />
      <div className="text-center space-y-1">
        {isListening ? (
          <>
            <p className="text-sm font-medium text-primary">Listening…</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
            {interimTranscript && (
              <p className="text-xs text-muted-foreground italic mt-1">{interimTranscript}…</p>
            )}
          </>
        ) : isProcessing ? (
          <p className="text-sm text-muted-foreground">Got it…</p>
        ) : (
          <>
            <p className="text-sm font-medium text-muted-foreground">{hint}</p>
            {subhint && <p className="text-xs text-muted-foreground">{subhint}</p>}
          </>
        )}
      </div>
    </div>
  );

  const StopBtn = () => isListening ? (
    <div className="flex justify-center">
      <button
        onClick={stopListening}
        className="w-14 h-14 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg hover:bg-red-600 active:scale-95 transition-all"
        aria-label="Stop listening"
      >
        <Square className="w-5 h-5 fill-current" />
      </button>
    </div>
  ) : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Floating mic button ── */}
      <button
        className={`fixed right-4 z-40 flex items-center justify-center rounded-full shadow-lg transition-all duration-200 select-none
          ${isPremium
            ? "w-14 h-14 bg-primary text-primary-foreground hover:scale-105 active:scale-95"
            : "w-14 h-14 bg-muted border border-border text-muted-foreground hover:bg-muted/80"
          }`}
        style={{ bottom: "76px" }}
        onClick={handleMicTap}
        aria-label="Voice mode"
        data-testid="voice-mic-button"
      >
        {isPremium ? (
          <Mic className="w-6 h-6" />
        ) : (
          <>
            <MicOff className="w-5 h-5" />
            <Crown className="absolute -top-1 -right-1 w-4 h-4 text-amber-400" />
          </>
        )}
      </button>

      {/* ── Voice wizard sheet ── */}
      <Sheet open={sheetOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl pb-safe select-none"
          style={{ maxHeight: "80vh", touchAction: "none" }}
        >
          <div className="pt-1 pb-6 px-1 space-y-4">

            {/* Header */}
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                <Mic className="w-3.5 h-3.5 text-primary" />
              </div>
              <span className="text-sm font-semibold text-foreground">Voice Mode</span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/20 tracking-wide">
                BETA
              </span>
            </div>

            {/* iOS web blocker */}
            {isIOSSafariWeb ? (
              <div className="space-y-4 py-2">
                <div className="rounded-2xl border border-border bg-muted/20 px-4 py-5 flex flex-col items-center gap-3 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <Mic className="w-6 h-6 text-primary" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">Voice Mode needs the app 🎤</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      iOS doesn't allow microphone access in web browsers — it's an Apple restriction.
                      Get the free <span className="font-medium text-foreground">Spliiit app from the App Store</span> to use Voice Mode.
                    </p>
                  </div>
                </div>
                <Button className="w-full" variant="outline" onClick={handleClose}>Got it</Button>
              </div>

            ) : (
              <>
                {/* ── Context strip — shows collected data as chips ── */}
                {(data.groupName || data.friendName || data.description || data.amount) && (
                  <div className="flex flex-wrap gap-1.5">
                    {(data.groupName || data.friendName) && (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">
                        {data.groupName
                          ? <UsersRound className="w-3 h-3" />
                          : <Users className="w-3 h-3" />}
                        {data.groupName ?? data.friendName}
                      </span>
                    )}
                    {data.description && (
                      <span className="text-xs px-2 py-1 rounded-full bg-muted/60 text-muted-foreground">
                        {data.description}
                      </span>
                    )}
                    {data.amount && (
                      <span className="text-xs px-2 py-1 rounded-full bg-green-500/15 text-green-600 font-semibold">
                        {formatVoiceAmount(data.amount, voiceCtx.defaultCurrency)}
                      </span>
                    )}
                    {data.splitType && (
                      <span className="text-xs px-2 py-1 rounded-full bg-muted/60 text-muted-foreground">
                        {data.splitType === "equal" ? "Equal split" : "Custom split"}
                      </span>
                    )}
                  </div>
                )}

                {/* ── Error state (shown over any step) ── */}
                {voiceState === "error" && (
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-4 py-4 flex gap-3">
                      <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-foreground">{errorMessage ?? "Microphone error"}</p>
                        {!isSupported && (
                          <p className="text-xs text-muted-foreground mt-1">Voice Mode works best in Chrome or Edge.</p>
                        )}
                      </div>
                    </div>
                    <Button className="w-full" variant="outline" onClick={() => startListeningRef.current()}>
                      <Mic className="w-4 h-4 mr-2" /> Try again
                    </Button>
                  </div>
                )}

                {/* ── STEP: ask_target ── */}
                {wizardStep === "ask_target" && voiceState !== "error" && (
                  <div className="space-y-3">
                    <ListenCard
                      hint={isListening ? "Say a group or friend name" : "Who do you want to split this with?"}
                      subhint={!isListening && !isProcessing ? "e.g. \"Roommates\" or \"Sarah\"" : undefined}
                    />
                    <StopBtn />
                    {/* Tap fallback: groups + friends list */}
                    {!isListening && !isProcessing && (voiceCtx.groups.length + voiceCtx.friends.length > 0) && (
                      <div className="space-y-1.5">
                        <p className="text-[11px] text-muted-foreground text-center">or tap to select:</p>
                        {voiceCtx.groups.map(g => (
                          <button key={g.id}
                            onClick={() => {
                              setData(prev => ({ ...prev, groupId: g.id, groupName: g.name, splitAmongIds: g.memberIds }));
                              stopSpeaking(); reset(); setWizardStep("ask_description");
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl border border-border bg-muted/10 hover:bg-muted/30 transition-colors text-left">
                            <UsersRound className="w-4 h-4 text-muted-foreground shrink-0" />
                            <span className="text-sm text-foreground">{g.name}</span>
                            <span className="text-xs text-muted-foreground ml-auto">{g.memberIds.length} members</span>
                          </button>
                        ))}
                        {voiceCtx.friends.map(f => (
                          <button key={f.id}
                            onClick={() => {
                              setData(prev => ({ ...prev, friendId: f.id, friendName: f.name }));
                              stopSpeaking(); reset(); setWizardStep("ask_description");
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl border border-border bg-muted/10 hover:bg-muted/30 transition-colors text-left">
                            <Users className="w-4 h-4 text-muted-foreground shrink-0" />
                            <span className="text-sm text-foreground">{f.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <Button variant="outline" className="w-full" onClick={handleClose}>Cancel</Button>
                  </div>
                )}

                {/* ── STEP: ask_description ── */}
                {wizardStep === "ask_description" && voiceState !== "error" && (
                  <div className="space-y-3">
                    <ListenCard
                      hint={isListening ? "Say what this expense is for" : "What was this for?"}
                      subhint={!isListening && !isProcessing ? "e.g. \"dinner\", \"groceries\", \"Uber\"" : undefined}
                    />
                    <StopBtn />
                    <Button variant="outline" className="w-full" onClick={handleClose}>Cancel</Button>
                  </div>
                )}

                {/* ── STEP: ask_amount ── */}
                {wizardStep === "ask_amount" && voiceState !== "error" && (
                  <div className="space-y-3">
                    <ListenCard
                      hint={isListening ? "Say the amount" : "How much did you pay?"}
                      subhint={!isListening && !isProcessing ? "e.g. \"45 dollars\" or \"$120\"" : undefined}
                    />
                    <StopBtn />
                    <Button variant="outline" className="w-full" onClick={handleClose}>Cancel</Button>
                  </div>
                )}

                {/* ── STEP: ask_split_type ── */}
                {wizardStep === "ask_split_type" && voiceState !== "error" && (
                  <div className="space-y-3">
                    <ListenCard
                      hint={isListening ? "Say equally or unequally" : "Split equally or unequally?"}
                      subhint={!isListening && !isProcessing ? "\"Equally\" for same share · \"Unequally\" for custom amounts" : undefined}
                    />
                    <StopBtn />
                    {/* Tap fallback: two buttons */}
                    {!isListening && !isProcessing && (
                      <div className="flex gap-2">
                        <Button variant="outline" className="flex-1" onClick={() => {
                          const d = dataRef.current;
                          setData(prev => ({ ...prev, splitType: "equal" }));
                          stopSpeaking(); reset();
                          if (d.groupId) {
                            const g = groups.find(gr => gr.id === d.groupId);
                            if (g) setTapMemberIds(g.memberIds);
                            setWizardStep("ask_members");
                          } else {
                            const ids = [user?.id ?? "", d.friendId!].filter(Boolean) as string[];
                            setData(prev => ({ ...prev, splitAmongIds: ids }));
                            setWizardStep(null);
                          }
                        }}>Equally</Button>
                        <Button variant="outline" className="flex-1" onClick={() => {
                          const d = dataRef.current;
                          setData(prev => ({ ...prev, splitType: "unequal" }));
                          stopSpeaking(); reset();
                          if (d.groupId) {
                            const g = groups.find(gr => gr.id === d.groupId);
                            if (g) setTapMemberIds(g.memberIds);
                            setWizardStep("ask_members");
                          } else {
                            const ids = [user?.id ?? "", d.friendId!].filter(Boolean) as string[];
                            const initStrs: Record<string, string> = {};
                            ids.forEach(id => { initStrs[id] = ""; });
                            setData(prev => ({ ...prev, splitAmongIds: ids }));
                            setUnequalStrs(initStrs);
                            setWizardStep("unequal_amounts");
                          }
                        }}>Unequally</Button>
                      </div>
                    )}
                    <Button variant="outline" className="w-full" onClick={handleClose}>Cancel</Button>
                  </div>
                )}

                {/* ── STEP: ask_members ── */}
                {wizardStep === "ask_members" && voiceState !== "error" && (() => {
                  const currentGroup = voiceCtx.groups.find(g => g.id === data.groupId);
                  const membersWithNames = (currentGroup?.memberIds ?? []).map(id => ({
                    id, name: resolveName(id),
                  }));
                  return (
                    <div className="space-y-3">
                      <ListenCard
                        hint={isListening ? "Say \"everyone\" or list names" : "Who should I split it between?"}
                        subhint={!isListening && !isProcessing
                          ? "\"Everyone\" · \"Everyone except Sarah\" · or specific names"
                          : undefined}
                      />
                      <StopBtn />
                      {/* Tap fallback: toggleable member list */}
                      {!isListening && !isProcessing && membersWithNames.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-[11px] text-muted-foreground text-center">or tap to select:</p>
                          {membersWithNames.map(m => (
                            <button key={m.id} onClick={() => handleToggleMember(m.id)}
                              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl border border-border bg-muted/10 hover:bg-muted/30 transition-colors text-left">
                              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                                tapMemberIds.includes(m.id) ? "bg-primary border-primary" : "border-muted-foreground/30"
                              }`}>
                                {tapMemberIds.includes(m.id) && <Check className="w-3 h-3 text-primary-foreground" />}
                              </div>
                              <span className="text-sm text-foreground">{m.name}</span>
                            </button>
                          ))}
                          <Button
                            className="w-full mt-1"
                            onClick={handleConfirmMembers}
                            disabled={tapMemberIds.length === 0}
                          >
                            <Check className="w-4 h-4 mr-1.5" />
                            Split between {tapMemberIds.length} {tapMemberIds.length === 1 ? "person" : "people"}
                          </Button>
                        </div>
                      )}
                      <Button variant="outline" className="w-full" onClick={handleClose}>Cancel</Button>
                    </div>
                  );
                })()}

                {/* ── STEP: unequal_amounts — text form ── */}
                {wizardStep === "unequal_amounts" && (() => {
                  const members = data.splitAmongIds ?? [];
                  const totalEntered = members.reduce(
                    (s, id) => s + (parseFloat(unequalStrs[id] ?? "") || 0), 0
                  );
                  const totalMatch = data.amount
                    ? Math.abs(totalEntered - data.amount) < 0.02
                    : false;
                  return (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 space-y-0.5">
                        <p className="text-xs text-muted-foreground">Custom split</p>
                        <p className="text-sm font-semibold text-foreground">
                          {data.description ?? "Expense"} — {formatVoiceAmount(data.amount ?? 0, voiceCtx.defaultCurrency)}
                        </p>
                        {data.groupName && <p className="text-xs text-muted-foreground">in {data.groupName}</p>}
                        {data.friendName && <p className="text-xs text-muted-foreground">with {data.friendName}</p>}
                      </div>
                      <p className="text-sm font-semibold text-foreground">Enter each person's share:</p>
                      <div className="space-y-2">
                        {members.map(uid => (
                          <div key={uid} className="flex items-center gap-3">
                            <span className="text-sm text-foreground flex-1 truncate">{resolveName(uid)}</span>
                            <input
                              type="number" inputMode="decimal" placeholder="0.00"
                              value={unequalStrs[uid] ?? ""}
                              onChange={e => setUnequalStrs(prev => ({ ...prev, [uid]: e.target.value }))}
                              className="w-24 h-9 rounded-lg border border-border bg-background px-3 text-sm text-right text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between items-center text-xs px-1">
                        <span className="text-muted-foreground">Total assigned</span>
                        <span className={totalMatch ? "text-green-500 font-semibold" : "text-amber-500 font-semibold"}>
                          {formatVoiceAmount(totalEntered, voiceCtx.defaultCurrency)} / {formatVoiceAmount(data.amount ?? 0, voiceCtx.defaultCurrency)}
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

                {/* ── CONFIRMATION CARD (wizardStep === null, data complete) ── */}
                {wizardStep === null && data.amount && (data.groupId || data.friendId) && (
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-border bg-card overflow-hidden">
                      <div className="px-4 py-3 border-b border-border bg-primary/5 flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-primary" />
                        <span className="text-sm font-semibold text-foreground">New Expense</span>
                        {data.splitType === "unequal" && (
                          <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/20">Custom split</span>
                        )}
                      </div>
                      <div className="px-4 py-3 space-y-2.5">
                        <Row label="Description" value={data.description ?? "Expense"} />
                        <Row label="Amount" value={formatVoiceAmount(data.amount, voiceCtx.defaultCurrency)} highlight />
                        <Row label="Paid by" value="You" />
                        {data.friendName && (
                          <Row
                            label="Split with"
                            value={data.splitType === "unequal"
                              ? `${data.friendName} (custom)`
                              : `${data.friendName} equally`}
                          />
                        )}
                        {data.groupName && (
                          <Row
                            label="Split in"
                            value={data.splitType === "unequal"
                              ? `${data.groupName} (custom amounts)`
                              : `${data.groupName} — ${(data.splitAmongIds ?? []).length} member${(data.splitAmongIds ?? []).length !== 1 ? "s" : ""} equally`}
                          />
                        )}
                        {data.unequalAmounts && (
                          <div className="pt-1 space-y-1">
                            {Object.entries(data.unequalAmounts).map(([uid, amt]) => (
                              <div key={uid} className="flex justify-between text-xs text-muted-foreground">
                                <span>{resolveName(uid)}</span>
                                <span>{formatVoiceAmount(amt, voiceCtx.defaultCurrency)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={handleClose} disabled={submitting}>
                        Cancel
                      </Button>
                      <Button className="flex-1" onClick={handleConfirm} disabled={submitting}>
                        {submitting
                          ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                          : <Check className="w-4 h-4 mr-1.5" />}
                        {submitting ? "Adding…" : "Add Expense"}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground text-center leading-relaxed px-3">
                      🧪 <span className="font-medium">Early Access</span> — Voice Mode is still being trained and improved. As a premium member, you get it first!
                    </p>
                  </div>
                )}

                {/* ── Initial idle state (sheet open but wizard not started yet) ── */}
                {wizardStep === null && !data.amount && (
                  <div className="text-center py-8 space-y-2">
                    <p className="text-sm text-muted-foreground">Voice Mode will guide you step by step</p>
                    <p className="text-[11px] text-muted-foreground">Tap the mic button to start</p>
                  </div>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Upgrade sheet for non-premium users */}
      <UpgradePromptSheet open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
    </>
  );
}

// ─── Small helper ──────────────────────────────────────────────────────────────

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
