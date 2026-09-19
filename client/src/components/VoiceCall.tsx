/**
 * VoiceCall — talk-back voice mode (OpenAI Realtime over WebRTC).
 *
 * Grok-style: it's a live voice CALL, but it keeps a scrolling chat transcript
 * of both sides (you + Spliiit) the whole time. You can keep talking and log
 * multiple splits without leaving the call.
 *
 * Flow:
 *   1. POST /api/voice/session → ephemeral ek_ token (real key stays server-side)
 *   2. getUserMedia(audio) → mic; RTCPeerConnection; data channel "oai-events"
 *   3. SDP offer → https://api.openai.com/v1/realtime/calls → answer
 *   4. Model listens, TALKS BACK, asks clarifying questions by voice. Both
 *      sides' speech is transcribed and shown as chat bubbles.
 *   5. When it has enough, it calls propose_split → inline Confirm card.
 *   6. On Confirm → POST /api/voice/commit (server resolves names→IDs and
 *      creates the expense through the SAME trusted path the manual form uses),
 *      then a "saved" bubble appears and the call continues.
 *
 * The model never writes to the DB — it only proposes; the user taps Confirm.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { isIosNative } from "@/lib/iap";
import { X, Loader2 } from "lucide-react";

const IOS_QS = isIosNative ? "?platform=ios" : "";

type CallState = "connecting" | "live" | "error";

interface ProposalArgs {
  amount: number;
  description?: string;
  currency?: string;
  paidByName?: string;
  splitAmongNames?: string[];
  groupName?: string;
  splitType?: "equal" | "unequal" | "full_to_one";
}

interface Turn { id: string; role: "user" | "assistant" | "system"; text: string; }

export default function VoiceCall({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [state, setState] = useState<CallState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [proposal, setProposal] = useState<ProposalArgs | null>(null);
  const [committing, setCommitting] = useState(false);
  const [speaking, setSpeaking] = useState(false); // model is talking → animate

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const cleanup = useCallback(() => {
    try { dcRef.current?.close(); } catch {}
    try { pcRef.current?.close(); } catch {}
    try { micRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    dcRef.current = null; pcRef.current = null; micRef.current = null;
  }, []);

  const hangUp = useCallback(() => { cleanup(); onClose(); }, [cleanup, onClose]);

  // Append or update a chat turn keyed by id (item_id for real speech turns).
  const upsertTurn = useCallback((id: string, role: Turn["role"], value: string, mode: "append" | "set") => {
    setTurns((prev) => {
      const i = prev.findIndex((t) => t.id === id);
      if (i === -1) return [...prev, { id, role, text: value }];
      const next = prev.slice();
      next[i] = { ...next[i], text: mode === "append" ? next[i].text + value : value };
      return next;
    });
  }, []);

  const addSystemTurn = useCallback((text: string) => {
    setTurns((prev) => [...prev, { id: `sys-${Date.now()}-${Math.random()}`, role: "system", text }]);
  }, []);

  // ── Commit a proposal via the server (reuses trusted createExpense) ────────
  const commit = useCallback(async (args: ProposalArgs) => {
    setCommitting(true);
    try {
      await apiRequest("POST", `/api/voice/commit${IOS_QS}`, args);
      qc.invalidateQueries({ queryKey: ["/api/expenses"] });
      qc.invalidateQueries({ queryKey: ["/api/friends/expenses"] });
      qc.invalidateQueries({ queryKey: ["/api/friends"] });
      qc.invalidateQueries({ queryKey: ["/api/groups"] });
      const cur = args.currency && args.currency !== "CAD" ? args.currency + " " : "$";
      addSystemTurn(`✅ Saved · ${cur}${Number(args.amount).toFixed(2)}${args.description ? " · " + args.description : ""}`);
      setProposal(null);
    } catch (e: any) {
      // apiRequest throws `${status}: ${rawBody}` on any non-2xx. Dig the real
      // server message out of that instead of a generic "connection" error.
      let clean = "Couldn't save that split — try again.";
      const raw = String(e?.message || "");
      const m = raw.match(/^\s*(\d{3}):\s*([\s\S]*)$/);
      if (m) {
        try { const p = JSON.parse(m[2]); clean = p?.message || p?.error || clean; }
        catch { if (m[2]) clean = m[2]; }
      } else if (raw) { clean = raw; }
      addSystemTurn(`⚠️ ${clean}`);
    } finally {
      setCommitting(false);
    }
  }, [qc, addSystemTurn]);

  // ── Handle Realtime events over the data channel ──────────────────────────
  const handleEvent = useCallback((msg: any) => {
    switch (msg.type) {
      // ---- user speech (input transcription) ----
      case "conversation.item.input_audio_transcription.delta":
        if (msg.item_id) upsertTurn(msg.item_id, "user", msg.delta || "", "append");
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (msg.item_id && typeof msg.transcript === "string") upsertTurn(msg.item_id, "user", msg.transcript, "set");
        break;
      // ---- assistant speech (output transcript; event name varies by version) ----
      case "response.audio_transcript.delta":
      case "response.output_audio_transcript.delta":
        setSpeaking(true);
        if (msg.item_id) upsertTurn(msg.item_id, "assistant", msg.delta || "", "append");
        break;
      case "response.audio_transcript.done":
      case "response.output_audio_transcript.done":
        setSpeaking(false);
        if (msg.item_id && typeof msg.transcript === "string") upsertTurn(msg.item_id, "assistant", msg.transcript, "set");
        break;
      // ---- tool call: propose a split ----
      case "response.function_call_arguments.done": {
        try {
          const args = JSON.parse(msg.arguments || "{}") as ProposalArgs;
          setProposal(args);
          const dc = dcRef.current;
          if (dc && dc.readyState === "open") {
            dc.send(JSON.stringify({
              type: "conversation.item.create",
              item: { type: "function_call_output", call_id: msg.call_id, output: JSON.stringify({ shown: true }) },
            }));
            dc.send(JSON.stringify({ type: "response.create" }));
          }
        } catch { /* ignore malformed tool args */ }
        break;
      }
    }
  }, [upsertTurn]);

  // ── Connect ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sr = await apiRequest("POST", `/api/voice/session${IOS_QS}`, {});
        const sess = await sr.json().catch(() => ({}));
        if (!sr.ok) throw new Error(sess?.message || "Voice isn't available right now.");
        if (cancelled) return;

        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        micRef.current = mic;
        if (cancelled) { mic.getTracks().forEach((t) => t.stop()); return; }

        const pc = new RTCPeerConnection();
        pcRef.current = pc;
        pc.ontrack = (e) => { if (audioRef.current) audioRef.current.srcObject = e.streams[0]; };
        pc.addTrack(mic.getAudioTracks()[0], mic);

        const dc = pc.createDataChannel("oai-events");
        dcRef.current = dc;
        dc.onopen = () => { if (!cancelled) setState("live"); };
        dc.onmessage = (ev) => { try { handleEvent(JSON.parse(ev.data)); } catch {} };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const resp = await fetch(
          `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(sess.model)}`,
          { method: "POST", body: offer.sdp || "", headers: { Authorization: `Bearer ${sess.clientSecret}`, "Content-Type": "application/sdp" } },
        );
        if (!resp.ok) throw new Error("Couldn't connect the call — try again.");
        await pc.setRemoteDescription({ type: "answer", sdp: await resp.text() });
      } catch (e: any) {
        if (!cancelled) {
          const m = e?.name === "NotAllowedError"
            ? "Microphone access is off. Enable it in Settings to talk to Spliiit."
            : (e?.message || "Something went wrong starting voice.");
          setError(m); setState("error");
        }
      }
    })();
    return () => { cancelled = true; cleanup(); };
  }, [cleanup, handleEvent]);

  // Auto-scroll the transcript to the newest turn / card.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, proposal, committing]);

  // ── Derived (proposal card) ────────────────────────────────────────────────
  const cur = (v: number) => `${(proposal?.currency && proposal.currency !== "CAD" ? proposal.currency + " " : "$")}${v.toFixed(2)}`;
  const names = proposal?.splitAmongNames?.length ? proposal.splitAmongNames : ["You"];
  const amountStr = proposal ? cur(Number(proposal.amount)) : "";
  const perPerson = proposal ? cur(Number(proposal.amount) / Math.max(names.length, 1)) : "";
  const initials = (n: string) => n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <audio ref={audioRef} autoPlay className="hidden" />

      {/* header */}
      <div className="flex items-center justify-between px-5 pt-[calc(env(safe-area-inset-top)+14px)] pb-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-accent-foreground opacity-60 animate-ping" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent-foreground" />
          </span>
          <span className="text-sm font-medium text-foreground">Voice · Spliiit</span>
        </div>
        <button onClick={hangUp} aria-label="End voice" className="h-9 w-9 rounded-full bg-muted border border-border flex items-center justify-center">
          <X className="w-4.5 h-4.5 text-foreground" />
        </button>
      </div>

      {/* chat transcript */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {state === "connecting" && (
          <div className="h-full flex items-center justify-center">
            <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Connecting…</p>
          </div>
        )}

        {state === "error" && (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-6">
            <p className="text-foreground">{error}</p>
            <button onClick={hangUp} className="h-11 px-6 rounded-full bg-accent-foreground text-white font-medium">Done</button>
          </div>
        )}

        {state === "live" && turns.length === 0 && !proposal && (
          <div className="h-full flex items-center justify-center text-center px-8">
            <p className="text-muted-foreground text-lg">Tell me the bill — like you'd tell a friend. 🎙️</p>
          </div>
        )}

        {turns.map((t) => {
          if (t.role === "system") {
            return (
              <div key={t.id} className="flex justify-center">
                <span className="rounded-full bg-muted px-3 py-1.5 text-xs text-foreground/80">{t.text}</span>
              </div>
            );
          }
          const mine = t.role === "user";
          return (
            <div key={t.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-[15px] leading-snug ${
                  mine
                    ? "bg-accent-foreground text-white rounded-br-md"
                    : "bg-card border border-border text-foreground rounded-bl-md"
                }`}
              >
                {t.text || "…"}
              </div>
            </div>
          );
        })}

        {/* inline proposal card */}
        {proposal && (
          <div className="flex justify-start">
            <div className="w-[88%] max-w-sm rounded-[24px] border border-border bg-card p-5 shadow-[0_18px_44px_-24px_rgba(40,26,16,0.45)]">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-2">Here's your split</p>
              <div className="flex items-end justify-between gap-3">
                <span className="text-foreground leading-none" style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: "2.75rem" }}>{amountStr}</span>
                {proposal.groupName && (
                  <span className="mb-1 rounded-full bg-muted px-3 py-1 text-xs text-foreground/70">{proposal.groupName}</span>
                )}
              </div>
              <p className="text-foreground/70 mt-1 mb-4 capitalize">{proposal.description || "Split"}</p>

              <div className="rounded-2xl bg-muted/60 p-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">You paid</span>
                  <span className="font-medium text-foreground">{amountStr}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Split {names.length} {names.length === 1 ? "way" : "ways"}</span>
                  <span className="font-medium text-foreground">{perPerson} each</span>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {names.map((n, i) => (
                    <span key={`${n}-${i}`} className="inline-flex items-center gap-1.5 rounded-full bg-card border border-border pl-1 pr-2.5 py-1 text-xs text-foreground">
                      <span className="h-5 w-5 rounded-full bg-accent-foreground text-white text-[10px] font-semibold flex items-center justify-center">{initials(n)}</span>
                      {n}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 mt-5">
                <button
                  disabled={committing}
                  onClick={() => setProposal(null)}
                  className="flex-1 h-12 rounded-full border border-border bg-card text-foreground font-medium disabled:opacity-50"
                >Not quite</button>
                <button
                  disabled={committing}
                  onClick={() => proposal && commit(proposal)}
                  className="flex-1 h-12 rounded-full bg-accent-foreground text-white font-medium flex items-center justify-center disabled:opacity-70"
                >{committing ? <Loader2 className="w-5 h-5 animate-spin" /> : "Confirm split"}</button>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* footer status + end */}
      {state === "live" && (
        <div className="px-5 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3 border-t border-border/60 flex items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="flex items-center justify-center gap-[3px] h-6 w-8" aria-hidden="true">
              <style>{`@keyframes vcBar{0%{transform:scaleY(.35)}100%{transform:scaleY(1)}}`}</style>
              {[8, 14, 20, 12, 7].map((h, i) => (
                <span key={i} style={{
                  width: 3, height: h, borderRadius: 9999,
                  background: "var(--accent-foreground, #B56A4A)", transformOrigin: "center",
                  animation: speaking ? `vcBar ${0.45 + (i % 5) * 0.1}s ease-in-out ${i * 0.05}s infinite alternate` : "none",
                  opacity: speaking ? 1 : 0.4,
                }} />
              ))}
            </span>
            <span className="text-sm text-muted-foreground truncate">{speaking ? "Spliiit is talking…" : "Listening…"}</span>
          </div>
          <button onClick={hangUp} className="h-11 px-6 rounded-full border border-border bg-muted text-foreground font-medium shrink-0">End</button>
        </div>
      )}
    </div>
  );
}
