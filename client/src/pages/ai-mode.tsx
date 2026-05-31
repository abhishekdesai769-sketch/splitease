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
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, ArrowLeft, Send, Loader2, Crown, Check, X, MessageSquare } from "lucide-react";

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
    mutationFn: async (text: string) => {
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
      // 2) Post the message
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

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleSend = () => {
    const text = input.trim();
    if (!text || sendMutation.isPending) return;
    // Optimistic: add user message immediately
    setMessages((prev) => [
      ...prev,
      { id: `pending-${Date.now()}`, role: "user", content: text, pending: true },
    ]);
    setInput("");
    sendMutation.mutate(text);
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
              Describe any split in plain English, send a receipt photo, or just talk to Spliiit. The AI turns it into a structured expense in seconds — you confirm with one tap.
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
      {/* Hide Layout's floating mic on AI Mode — it covers the input bar.
          Voice input arrives natively here in Phase 4. */}
      <style>{`[data-testid="voice-mic-button"] { display: none !important; }`}</style>

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
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='Describe a split… e.g. "Sushi $45 with Krish, I paid"'
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
              disabled={sendMutation.isPending || !input.trim()}
              className="shrink-0 h-[68px] w-12"
              data-testid="ai-mode-send"
            >
              {sendMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground/70 mt-1.5 text-center">
            AI proposes — you confirm. Nothing is created until you tap Create.
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
    <div className="text-center py-12 px-4 space-y-4">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mx-auto">
        <MessageSquare className="w-7 h-7 text-primary" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-base font-semibold">What's the split?</h2>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
          Just describe it in plain English. I'll figure out the rest and show you a proposal to confirm.
        </p>
      </div>
      <div className="space-y-2 max-w-sm mx-auto pt-2">
        <ExampleLine text='"Split groceries $45 with Krish"' />
        <ExampleLine text='"Dinner with my Halifax group, $200, I paid"' />
        <ExampleLine text='"Krish bought me coffee for $5"' />
      </div>
    </div>
  );
}

function ExampleLine({ text }: { text: string }) {
  return (
    <div className="text-xs text-muted-foreground/70 italic px-3 py-2 rounded-lg bg-muted/30 border border-border">
      {text}
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
