/**
 * AI Mode — conversational expense entry.
 *
 * v1 scope: text-only, single-conversation per visit, single-turn UX:
 *   1. User types a description ("split groceries $45 with Krish")
 *   2. We POST to /api/ai/conversations/:id/message → Claude responds
 *   3. If Claude returns a proposal: show a confirmation card
 *   4. User taps "Create" → POST /api/ai/conversations/:id/confirm
 *   5. Expense(s) created via existing endpoints, balances update normally
 *
 * Premium-gated. Non-Premium users see an upgrade teaser. TWA users get
 * the same teaser (Google Play policy parity with other premium features).
 *
 * Future phases (NOT in v1):
 *   - Voice input (Phase 4)
 *   - Image input (Phase 5)
 *   - Multi-turn refinements / sidebar of past conversations (Phase 3)
 *   - Free-tier quota (Phase 6)
 */

import { useState, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiRequest, apiFormRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, ArrowLeft, Send, Loader2, Crown, Check, X, Paperclip, FileText, Image as ImageIcon, Mic, Keyboard, MicOff } from "lucide-react";
import { useVoiceMode } from "@/hooks/useVoiceMode";

const MAX_ATTACHMENTS = 5;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;        // 10 MB per file — matches server
const ACCEPTED_TYPES = "image/*,application/pdf";

// ── Types ────────────────────────────────────────────────────────────────

interface ExpenseProposal {
  description: string;
  amount: number;
  paidByUserId: string;
  splitAmongUserIds: string[];
  splitAmounts?: Record<string, number>;
  groupId?: string | null;
  currency?: string;
}

interface ChatMessage {
  id: string;                          // local id; server id once persisted
  role: "user" | "assistant";
  content: string;
  proposal?: ExpenseProposal | null;
  multiProposal?: ExpenseProposal[] | null;
  pending?: boolean;                   // optimistic, hasn't reached server yet
  confirmedAt?: string | null;
  serverMessageId?: string;            // the DB id for confirm calls
}

// ── Component ────────────────────────────────────────────────────────────

export default function AiMode() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { id: routeConvId } = useParams<{ id?: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [conversationId, setConversationId] = useState<string | null>(routeConvId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  // Attachments selected for the NEXT send. Cleared on send + on error.
  // These are File objects held in browser memory only — never persisted
  // client-side, never written to disk server-side, only forwarded to the
  // AI for parsing then discarded.
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Lookup tables (id → name) so we can render proposal cards readably
  // without hitting another endpoint per render.
  const [nameLookup, setNameLookup] = useState<Record<string, string>>({});
  const [groupNameLookup, setGroupNameLookup] = useState<Record<string, string>>({});

  // Premium gate. We render the page regardless so the gate UI is visible,
  // but anything that calls the backend is short-circuited.
  const isPremium = !!user?.isPremium;

  // ── Boot: prepare name lookups once (used for rendering proposals) ────
  useEffect(() => {
    if (!user) return;
    // Quick fetch — keys we need: friends + groups
    Promise.all([
      apiRequest("GET", "/api/friends").then((r) => r.json()).catch(() => []),
      apiRequest("GET", "/api/groups").then((r) => r.json()).catch(() => []),
      apiRequest("GET", "/api/members/all").then((r) => r.json()).catch(() => []),
    ]).then(([friends, groups, allMembers]) => {
      const names: Record<string, string> = { [user.id]: user.name + " (you)" };
      for (const m of allMembers ?? []) names[m.id] = m.name;
      for (const f of friends ?? []) names[f.id] = f.name;
      setNameLookup(names);
      const gnames: Record<string, string> = {};
      for (const g of groups ?? []) gnames[g.id] = g.name;
      setGroupNameLookup(gnames);
    });
  }, [user]);

  // ── Boot: if route has /:id, load that conversation
  useEffect(() => {
    if (!conversationId || !isPremium) return;
    apiRequest("GET", `/api/ai/conversations/${conversationId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.messages) {
          setMessages(
            data.messages.map((m: any) => ({
              id: m.id,
              serverMessageId: m.id,
              role: m.role,
              content: m.content ?? "",
              proposal: m.proposal ? safeParseProposal(m.proposal) : null,
              multiProposal: m.proposal ? safeParseMulti(m.proposal) : null,
              confirmedAt: m.confirmedAt ?? null,
            }))
          );
        }
      })
      .catch(() => { /* let user start fresh */ });
  }, [conversationId, isPremium]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  // ── Send message mutation ─────────────────────────────────────────────
  const sendMutation = useMutation({
    mutationFn: async ({ text, files }: { text: string; files: File[] }) => {
      // 1) Ensure we have a conversation
      let convId = conversationId;
      if (!convId) {
        const r = await apiRequest("POST", "/api/ai/conversations", {});
        const d = await r.json();
        convId = d.id;
        setConversationId(convId);
        // Reflect in URL so refresh keeps the conversation
        window.history.replaceState({}, "", `#/ai/${convId}`);
      }
      // 2) Post the message. Attachments → FormData; text-only → JSON.
      if (files.length > 0) {
        const fd = new FormData();
        if (text) fd.append("text", text);
        for (const f of files) fd.append("attachments", f);
        const r = await apiFormRequest("POST", `/api/ai/conversations/${convId}/message`, fd);
        return r.json();
      }
      const r = await apiRequest("POST", `/api/ai/conversations/${convId}/message`, { text });
      return r.json();
    },
    onSuccess: (data) => {
      // Replace the pending optimistic user-message + append assistant
      setMessages((prev) => {
        const next = prev.filter((m) => !m.pending);
        // User msg from server (in case backend mutated content)
        if (data.userMessage) {
          next.push({
            id: data.userMessage.id,
            serverMessageId: data.userMessage.id,
            role: "user",
            content: data.userMessage.content ?? "",
          });
        }
        if (data.assistantMessage) {
          const am = data.assistantMessage;
          next.push({
            id: am.id,
            serverMessageId: am.id,
            role: "assistant",
            content: am.content ?? "",
            proposal: data.proposal ?? null,
            multiProposal: data.multiProposal ?? null,
            confirmedAt: am.confirmedAt ?? null,
          });
        }
        return next;
      });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).message || msg; } catch { /* */ }
      // Drop the pending user message and show the error
      setMessages((prev) => prev.filter((m) => !m.pending));
      toast({ title: "AI couldn't respond", description: msg, variant: "destructive" });
    },
  });

  // ── Confirm proposal mutation ─────────────────────────────────────────
  const confirmMutation = useMutation({
    mutationFn: async (messageId: string) => {
      if (!conversationId) throw new Error("No conversation");
      const r = await apiRequest("POST", `/api/ai/conversations/${conversationId}/confirm`, { messageId });
      return r.json();
    },
    onSuccess: (data, messageId) => {
      // Mark the message confirmed locally
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, confirmedAt: new Date().toISOString() } : m))
      );
      // Invalidate the expense queries so dashboard + lists refresh
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/friends/expenses"] });
      const count = data?.created?.length ?? 1;
      toast({
        title: `${count} expense${count !== 1 ? "s" : ""} created`,
        description: data?.failed?.length ? `${data.failed.length} couldn't be created — try the manual form for those.` : undefined,
      });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error || msg; } catch { /* */ }
      toast({ title: "Couldn't create expense", description: msg, variant: "destructive" });
    },
  });

  // ── Voice transcription ──────────────────────────────────────────────
  // We reuse the existing useVoiceMode hook (handles iOS-native Capacitor
  // path + Web Speech API path), but we IGNORE its built-in intent parser
  // — AI Mode doesn't need it. We just want the raw transcript dropped
  // into the textarea so the user can review/edit before sending. From
  // there the normal AI Mode flow takes over: Claude parses, proposes,
  // user confirms. That's the whole point of "voice in AI Mode" — it's
  // dictation, not a separate command system.
  const voiceCtx = {
    currentUserId: user?.id ?? "",
    friends: [],
    groups: [],
    defaultCurrency: user?.defaultCurrency ?? "CAD",
  };
  const {
    voiceState,
    transcript: voiceTranscript,
    interimTranscript,
    errorMessage: voiceError,
    isSupported: voiceSupported,
    startListening,
    stopListening,
    reset: resetVoice,
  } = useVoiceMode(voiceCtx);

  // When a final transcript arrives, append it to whatever the user has
  // already typed (so they can mix voice + keyboard) and reset the hook
  // back to idle so the next tap is a fresh session.
  useEffect(() => {
    if (voiceState === "result" && voiceTranscript) {
      setInput((prev) => (prev ? `${prev.trim()} ${voiceTranscript}` : voiceTranscript));
      resetVoice();
    }
    if (voiceState === "error" && voiceError) {
      toast({
        title: "Voice didn't catch that",
        description: voiceError,
        variant: "destructive",
      });
      resetVoice();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState, voiceTranscript, voiceError]);

  const handleMicTap = () => {
    if (voiceState === "listening") {
      stopListening();
    } else if (voiceSupported) {
      startListening();
    } else {
      toast({
        title: "Voice needs the iOS app",
        description: "iOS Safari blocks microphone access. Install the Spliiit app from the App Store to use voice.",
        variant: "destructive",
      });
    }
  };

  const isListening = voiceState === "listening";
  const isVoiceProcessing = voiceState === "processing";

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleSend = () => {
    const text = input.trim();
    const files = attachments;
    if ((!text && files.length === 0) || sendMutation.isPending) return;
    // Optimistic: add user message immediately. If attachments exist but
    // no text, show a placeholder so the bubble doesn't render blank.
    const optimisticContent = text || `📎 ${files.length} attachment${files.length !== 1 ? "s" : ""}`;
    setMessages((prev) => [
      ...prev,
      { id: `pending-${Date.now()}`, role: "user", content: optimisticContent, pending: true },
    ]);
    setInput("");
    setAttachments([]);
    sendMutation.mutate({ text, files });
  };

  // File picker handler — validates count + size before adding to state.
  const handleFilesPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length === 0) return;
    // Reset the file input so re-picking the same file works
    if (fileInputRef.current) fileInputRef.current.value = "";

    const rejected: string[] = [];
    const accepted: File[] = [];
    for (const f of picked) {
      if (f.size > MAX_FILE_SIZE_BYTES) {
        rejected.push(`${f.name} is over 10 MB`);
        continue;
      }
      const okType = f.type === "application/pdf" || f.type.startsWith("image/");
      if (!okType) {
        rejected.push(`${f.name} isn't a PDF or image`);
        continue;
      }
      accepted.push(f);
    }
    if (rejected.length > 0) {
      toast({ title: "Some files were skipped", description: rejected.join(" · "), variant: "destructive" });
    }
    setAttachments((prev) => {
      const next = [...prev, ...accepted];
      if (next.length > MAX_ATTACHMENTS) {
        toast({ title: `Max ${MAX_ATTACHMENTS} attachments`, description: "Removed extras over the limit.", variant: "destructive" });
        return next.slice(0, MAX_ATTACHMENTS);
      }
      return next;
    });
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const renderName = (id: string) => nameLookup[id] || id.slice(0, 6);
  const renderGroupName = (id?: string | null) => (id ? groupNameLookup[id] || "Group" : null);

  // ── Render: Premium gate ──────────────────────────────────────────────
  if (!isPremium) {
    return (
      <div className="space-y-5">
        <PageHeader onBack={() => setLocation("/")} />
        <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-6 text-center space-y-4">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/15">
            <Sparkles className="w-7 h-7 text-primary" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold">AI Mode is a Premium feature</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Talk to Spliiit, type a one-liner, or drop a <span className="font-medium text-foreground">PDF receipt</span> from Uber Eats, DoorDash, Amazon. The AI parses every item and proposes the split — you confirm with one tap.
            </p>
            <p className="text-xs text-muted-foreground/80 max-w-md mx-auto pt-1">
              The only splitter that reads PDFs. Other apps can't.
            </p>
          </div>
          <Button
            size="lg"
            className="mt-2"
            onClick={() => setLocation("/upgrade")}
            data-testid="ai-mode-upgrade-cta"
          >
            <Crown className="w-4 h-4 mr-2" />
            Upgrade to Premium
          </Button>
        </div>
      </div>
    );
  }

  // ── Render: live AI Mode ──────────────────────────────────────────────
  // Layout strategy:
  //   - PageHeader + messages render in normal Layout flow (scrollable page)
  //   - Input bar is position: fixed, anchored ABOVE the bottom nav so it's
  //     always visible no matter where the user scrolled to.
  //   - Messages container has paddingBottom to make room for the fixed bar.
  //
  // The previous attempt used calc(100vh - 8rem) which underestimated the
  // chrome (safe-area-inset-top + header + main py + nav + safe-area-inset-
  // bottom add up to >> 8rem on iPhones). The input bar fell below the
  // viewport and required scrolling to find. position:fixed sidesteps the
  // whole flex-height math problem.
  return (
    <>
      <div className="flex flex-col">
        <PageHeader onBack={() => setLocation("/")} />

        {/* Messages — padded at bottom to clear the fixed input bar
            (~150px including the bar's height + bottom nav + safe area). */}
        <div
          ref={scrollRef}
          className="space-y-3"
          style={{ paddingBottom: "calc(170px + env(safe-area-inset-bottom))" }}
        >
          {messages.length === 0 && <EmptyState />}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              renderName={renderName}
              renderGroupName={renderGroupName}
              onConfirm={() => m.serverMessageId && confirmMutation.mutate(m.serverMessageId)}
              confirmPending={confirmMutation.isPending}
            />
          ))}
          {sendMutation.isPending && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Thinking…
            </div>
          )}
        </div>
      </div>

      {/* Fixed input bar — sits above the bottom nav. The bar's bottom
          offset = nav height (4rem) + nav's safe-area inset, so it lifts
          above the home-indicator zone consistently. */}
      <div
        className="fixed left-0 right-0 z-30 border-t border-border bg-background/95 backdrop-blur-md px-4 pt-3 pb-2"
        style={{ bottom: "calc(4rem + env(safe-area-inset-bottom))" }}
      >
        <div className="max-w-3xl mx-auto">
          {/* Hidden file input — triggered by the paperclip button below */}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            multiple
            className="hidden"
            onChange={handleFilesPicked}
            data-testid="ai-mode-file-input"
          />

          {/* Attachment chips — visible above the input when files queued */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2.5">
              {attachments.map((f, i) => (
                <AttachmentChip key={`${f.name}-${i}`} file={f} onRemove={() => removeAttachment(i)} />
              ))}
            </div>
          )}

          {/* Live voice transcript — shown above the input when listening,
              so the user sees what's being captured in real time. */}
          {(isListening || isVoiceProcessing) && (
            <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 animate-pulse">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              <p className="text-xs text-foreground flex-1 truncate">
                {isVoiceProcessing
                  ? "Got it — processing…"
                  : interimTranscript || "Listening… speak now"}
              </p>
            </div>
          )}

          <div className="flex items-end gap-2">
            {/* Left stack: Paperclip (attach) + Mic (voice) */}
            <div className="flex flex-col gap-1 shrink-0">
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={sendMutation.isPending || attachments.length >= MAX_ATTACHMENTS}
                className="h-[32px] w-11"
                title="Attach PDF, screenshot, or photo"
                data-testid="ai-mode-attach"
                aria-label="Attach file"
              >
                <Paperclip className="w-4 h-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant={isListening ? "default" : "outline"}
                onClick={handleMicTap}
                disabled={sendMutation.isPending || isVoiceProcessing}
                className={`h-[32px] w-11 ${
                  isListening
                    ? "bg-red-500 hover:bg-red-600 text-white border-red-500"
                    : ""
                }`}
                title={
                  isListening
                    ? "Tap to stop"
                    : voiceSupported
                    ? "Talk to AI"
                    : "Voice needs the iOS app"
                }
                data-testid="ai-mode-voice"
                aria-label={isListening ? "Stop listening" : "Start voice input"}
              >
                {isVoiceProcessing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isListening ? (
                  <Mic className="w-4 h-4" />
                ) : voiceSupported ? (
                  <Mic className="w-4 h-4" />
                ) : (
                  <MicOff className="w-4 h-4 opacity-50" />
                )}
              </Button>
            </div>

            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                isListening
                  ? "Listening — keep going…"
                  : attachments.length > 0
                  ? "Add context (optional)… e.g. 'split equally with Krish'"
                  : "Type, talk, or attach a receipt PDF / screenshot"
              }
              rows={2}
              className="resize-none text-sm"
              disabled={sendMutation.isPending}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              data-testid="ai-mode-input"
            />
            <Button
              type="button"
              size="icon"
              onClick={handleSend}
              disabled={sendMutation.isPending || (!input.trim() && attachments.length === 0)}
              className="shrink-0 h-[68px] w-12"
              data-testid="ai-mode-send"
            >
              {sendMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground/70 mt-1.5 text-center">
            🎙️ Talk · 📎 Attach · ⌨️ Type — AI proposes, you confirm. Receipts parsed then discarded, never stored.
          </p>
        </div>
      </div>
    </>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

function PageHeader({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 pb-2">
      <Button size="icon" variant="ghost" onClick={onBack} aria-label="Back">
        <ArrowLeft className="w-5 h-5" />
      </Button>
      <div className="flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-semibold">AI Mode</h1>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-8 px-4 space-y-5">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mx-auto">
        <Sparkles className="w-7 h-7 text-primary" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-base font-semibold">What's the split?</h2>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
          Talk to me, drop a receipt, or just type. I'll do the rest.
        </p>
      </div>

      {/* THE differentiator — pain point → "wow no other app does that". */}
      <div className="mx-auto max-w-sm rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-3.5 text-left">
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold leading-tight">
              The receipts other apps can't read.
            </p>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
              Uber Eats. DoorDash. Amazon. Your subscriptions. They all email <span className="font-medium text-foreground">PDFs</span> now — not paper. Other splitting apps can only scan photos, so those receipts have nowhere to go.
            </p>
            <p className="text-[11px] mt-1.5 leading-relaxed">
              <span className="font-semibold text-primary">Drop yours here.</span> <span className="text-muted-foreground">I'll read every item, every tax, every tip — and split it the way you would.</span>
            </p>
          </div>
        </div>
      </div>

      {/* Three input modes, called out as examples */}
      <div className="space-y-2 max-w-sm mx-auto pt-1">
        <ModeExample icon="mic" text='"Split groceries $45 with Krish"' />
        <ModeExample icon="type" text='"Dinner with my Halifax group, $200, I paid"' />
        <ModeExample icon="paperclip" text="Drop a PDF or screenshot — I'll do the rest" />
      </div>
    </div>
  );
}

// File chip shown above the input bar when attachments are queued
function AttachmentChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const isPdf = file.type === "application/pdf";
  const sizeKb = Math.round(file.size / 1024);
  const sizeLabel = sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;
  return (
    <div className="flex items-center gap-2 max-w-[200px] rounded-lg border border-border bg-card pl-2 pr-1 py-1">
      <div className={`w-6 h-6 rounded shrink-0 flex items-center justify-center ${isPdf ? "bg-red-500/15 text-red-600" : "bg-primary/15 text-primary"}`}>
        {isPdf ? <FileText className="w-3.5 h-3.5" /> : <ImageIcon className="w-3.5 h-3.5" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{file.name}</p>
        <p className="text-[10px] text-muted-foreground">{sizeLabel}</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Remove attachment"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function ModeExample({ icon, text }: { icon: "mic" | "type" | "paperclip"; text: string }) {
  const Icon = icon === "mic" ? Mic : icon === "paperclip" ? Paperclip : Keyboard;
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/30 border border-border text-left">
      <div className="w-6 h-6 rounded-md bg-background border border-border flex items-center justify-center shrink-0">
        <Icon className="w-3 h-3 text-primary" />
      </div>
      <span className="text-xs text-muted-foreground italic flex-1">{text}</span>
    </div>
  );
}

function MessageBubble({
  message, renderName, renderGroupName, onConfirm, confirmPending,
}: {
  message: ChatMessage;
  renderName: (id: string) => string;
  renderGroupName: (id?: string | null) => string | null;
  onConfirm: () => void;
  confirmPending: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-3.5 py-2 text-sm">
          {message.content}
        </div>
      </div>
    );
  }

  // Assistant
  return (
    <div className="flex flex-col items-start gap-2 max-w-[90%]">
      {message.content && (
        <div className="rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2 text-sm">
          {message.content}
        </div>
      )}
      {/* Single proposal card */}
      {message.proposal && (
        <ProposalCard
          proposal={message.proposal}
          renderName={renderName}
          renderGroupName={renderGroupName}
          confirmed={!!message.confirmedAt}
          onConfirm={onConfirm}
          confirmPending={confirmPending}
        />
      )}
      {/* Multi-proposal cards */}
      {message.multiProposal && message.multiProposal.length > 0 && (
        <div className="w-full space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono px-1">
            {message.multiProposal.length} expenses proposed
          </p>
          {message.multiProposal.map((p, i) => (
            <ProposalCard
              key={i}
              proposal={p}
              renderName={renderName}
              renderGroupName={renderGroupName}
              confirmed={!!message.confirmedAt}
              onConfirm={i === 0 ? onConfirm : undefined}   // single Create All button
              confirmPending={confirmPending}
              hideButton={i !== 0}
              isMulti
              multiCount={message.multiProposal!.length}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProposalCard({
  proposal, renderName, renderGroupName, confirmed, onConfirm, confirmPending, hideButton, isMulti, multiCount,
}: {
  proposal: ExpenseProposal;
  renderName: (id: string) => string;
  renderGroupName: (id?: string | null) => string | null;
  confirmed: boolean;
  onConfirm?: () => void;
  confirmPending: boolean;
  hideButton?: boolean;
  isMulti?: boolean;
  multiCount?: number;
}) {
  const currency = proposal.currency || "CAD";
  const symbol = currency === "USD" || currency === "CAD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  const groupName = renderGroupName(proposal.groupId);

  return (
    <div className={`rounded-xl border border-primary/30 bg-card p-3.5 w-full ${confirmed ? "opacity-70" : ""}`}>
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{proposal.description || "Expense"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Paid by {renderName(proposal.paidByUserId)}
            {groupName && <> · in {groupName}</>}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-base font-semibold font-mono">
            {symbol}{proposal.amount.toFixed(2)}
          </p>
          {currency !== "CAD" && currency !== "USD" && (
            <p className="text-[10px] text-muted-foreground">{currency}</p>
          )}
        </div>
      </div>
      <div className="mt-2 pt-2 border-t border-border">
        <p className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">Split among</p>
        <p className="text-xs text-foreground mt-0.5">
          {proposal.splitAmongUserIds.map(renderName).join(", ")}
          {proposal.splitAmounts && " · unequal"}
        </p>
      </div>
      {!hideButton && (
        <div className="mt-3 flex gap-2">
          {confirmed ? (
            <div className="flex-1 flex items-center justify-center gap-1.5 text-xs text-primary font-medium">
              <Check className="w-3.5 h-3.5" />
              Created
            </div>
          ) : (
            <Button
              size="sm"
              className="flex-1"
              onClick={onConfirm}
              disabled={confirmPending || !onConfirm}
              data-testid="ai-mode-confirm"
            >
              {confirmPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (
                <>
                  <Check className="w-3.5 h-3.5 mr-1" />
                  {isMulti && multiCount ? `Create all ${multiCount}` : "Create expense"}
                </>
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function safeParseProposal(s: string | null): ExpenseProposal | null {
  if (!s) return null;
  try {
    const p = JSON.parse(s);
    if (p && !Array.isArray(p) && !p.multi && typeof p.amount === "number") return p as ExpenseProposal;
    return null;
  } catch { return null; }
}

function safeParseMulti(s: string | null): ExpenseProposal[] | null {
  if (!s) return null;
  try {
    const p = JSON.parse(s);
    if (p && p.multi && Array.isArray(p.multi)) return p.multi as ExpenseProposal[];
    return null;
  } catch { return null; }
}
