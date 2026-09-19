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
import { X, Loader2, Check, Users } from "lucide-react";

const IOS_QS = isIosNative ? "?platform=ios" : "";

type CallState = "connecting" | "live" | "error" | "capped" | "reconnecting";

const IDLE_MS = 40000;        // hang up after this much dead air
const MAX_CALL_MS = 300000;   // hard 5-min cap (cost guard)

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

interface ResolvedPerson { id: string; name: string; isYou: boolean; share: number; }
interface PreviewCard {
  amount: number; currency: string; description: string; date: string;
  groupId: string | null; groupName: string | null; splitLabel: string;
  perPerson: number; people: ResolvedPerson[]; youGetBack: number;
}

// Same warm avatar palette + hash the rest of the app uses (dashboard/friends).
const WARM_AVATARS = ["#7A3E32", "#8C5A3C", "#9A4A2A", "#A6674A", "#8A6A32", "#B04A34", "#6B4A3A", "#B5794A"];
function warmAvatar(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return WARM_AVATARS[h % WARM_AVATARS.length];
}
function initials(n: string): string {
  return n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
function money(v: number, currency: string): string {
  const sym = !currency || currency === "CAD" || currency === "USD" ? "$" : currency + " ";
  return `${sym}${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function shortDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); }
  catch { return "Today"; }
}

export default function VoiceCall({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [state, setState] = useState<CallState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [proposal, setProposal] = useState<ProposalArgs | null>(null);
  const [preview, setPreview] = useState<PreviewCard | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [ending, setEnding] = useState(false);     // model called end_call → wrapping up
  const [speaking, setSpeaking] = useState(false); // model is talking → animate
  const [userSpeaking, setUserSpeaking] = useState(false); // you're talking → live bubble

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  // Live mic-level metering (drives the "it hears me" bars without re-renders).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const meterRef = useRef<HTMLSpanElement | null>(null);
  // Lifecycle guards + timers.
  const closedRef = useRef(false);
  const idleTimerRef = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const reconnectsRef = useRef(0);
  const greetedRef = useRef(false);

  const teardownMedia = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    try { audioCtxRef.current?.close(); } catch {}
    audioCtxRef.current = null;
    try { dcRef.current?.close(); } catch {}
    try { pcRef.current?.getSenders().forEach((s) => s.track?.stop()); } catch {}
    try { pcRef.current?.close(); } catch {}
    try { micRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    dcRef.current = null; pcRef.current = null; micRef.current = null;
  }, []);

  const cleanup = useCallback(() => {
    closedRef.current = true;
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    teardownMedia();
  }, [teardownMedia]);

  const hangUp = useCallback(() => { cleanup(); onClose(); }, [cleanup, onClose]);

  // Reset the dead-air timer on any speech activity; fire → graceful hangup.
  const resetIdle = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      if (!closedRef.current) { addSystemTurn("Ended — the call went quiet."); hangUp(); }
    }, IDLE_MS);
  // addSystemTurn/hangUp are stable enough; declared below, so guard via refs.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Reply to the model's tool call so its spoken line matches what actually
  // happened (don't let it say "tap Confirm" when resolution failed).
  const answerTool = useCallback((callId: string | undefined, output: any) => {
    const dc = dcRef.current;
    if (!callId || !dc || dc.readyState !== "open") return;
    dc.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) } }));
    dc.send(JSON.stringify({ type: "response.create" }));
  }, []);

  // Ask the server to resolve the proposal into a real, computed breakdown for
  // the confirm card. If a name can't be matched, tell the model to ask.
  const loadPreview = useCallback(async (args: ProposalArgs, callId?: string) => {
    setPreviewing(true);
    setPreview(null);
    try {
      const r = await apiRequest("POST", `/api/voice/preview${IOS_QS}`, args);
      const card = await r.json();
      setPreview(card as PreviewCard);
      answerTool(callId, { shown: true, instruction: "Say one short line telling them the split is ready and to tap Confirm." });
    } catch (e: any) {
      let clean = "I couldn't work that split out — mind saying it again?";
      const raw = String(e?.message || "");
      const m = raw.match(/^\s*(\d{3}):\s*([\s\S]*)$/);
      if (m) { try { const p = JSON.parse(m[2]); clean = p?.message || clean; } catch { /* keep */ } }
      addSystemTurn(`⚠️ ${clean}`);
      setProposal(null);
      answerTool(callId, { error: clean, instruction: "Do NOT say it's ready. Ask the user this exact clarifying question in one short line." });
    } finally {
      setPreviewing(false);
    }
  }, [addSystemTurn, answerTool]);

  // ── Commit a proposal via the server (reuses trusted createExpense) ────────
  const commit = useCallback(async (args: ProposalArgs) => {
    setCommitting(true);
    try {
      await apiRequest("POST", `/api/voice/commit${IOS_QS}`, args);
      qc.invalidateQueries({ queryKey: ["/api/expenses"] });
      qc.invalidateQueries({ queryKey: ["/api/friends/expenses"] });
      qc.invalidateQueries({ queryKey: ["/api/friends"] });
      qc.invalidateQueries({ queryKey: ["/api/groups"] });
      addSystemTurn(`✅ Saved · ${money(Number(args.amount), args.currency || "CAD")}${args.description ? " · " + args.description : ""}`);
      setProposal(null);
      setPreview(null);
      // Nudge the model to confirm it's saved and ask if there's anything else
      // (it will call end_call to hang up when the user is done).
      const dc = dcRef.current;
      if (dc && dc.readyState === "open") {
        dc.send(JSON.stringify({ type: "response.create", response: { instructions: "The split was just saved. In one short, friendly line tell them it's saved, then ask if there's anything else." } }));
      }
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
      // ---- barge-in: user started talking → stop the "AI is talking" state so
      // it visibly yields immediately (server VAD cancels its audio). ----
      case "input_audio_buffer.speech_started":
        setSpeaking(false);
        setUserSpeaking(true);
        resetIdle();
        break;
      case "input_audio_buffer.speech_stopped":
        setUserSpeaking(false);
        resetIdle();
        break;
      // ---- establish chat order as items are created ----
      // The user's audio item is committed (and this fires) BEFORE the model's
      // reply streams, so seeding an ordered placeholder here keeps your words
      // above the answer even though the transcription text arrives later.
      case "conversation.item.created": {
        const it = msg.item;
        if (it?.id && (it.role === "user" || it.role === "assistant")) {
          setTurns((prev) => prev.some((t) => t.id === it.id) ? prev : [...prev, { id: it.id, role: it.role, text: "" }]);
        }
        break;
      }
      // ---- user speech (input transcription) ----
      case "conversation.item.input_audio_transcription.delta":
        if (msg.item_id) upsertTurn(msg.item_id, "user", msg.delta || "", "append");
        break;
      case "conversation.item.input_audio_transcription.completed":
        setUserSpeaking(false);
        if (msg.item_id && typeof msg.transcript === "string") upsertTurn(msg.item_id, "user", msg.transcript, "set");
        break;
      // ---- assistant speech (output transcript; event name varies by version) ----
      case "response.audio_transcript.delta":
      case "response.output_audio_transcript.delta":
        setSpeaking(true);
        resetIdle();
        if (msg.item_id) upsertTurn(msg.item_id, "assistant", msg.delta || "", "append");
        break;
      case "response.audio_transcript.done":
      case "response.output_audio_transcript.done":
        setSpeaking(false);
        if (msg.item_id && typeof msg.transcript === "string") upsertTurn(msg.item_id, "assistant", msg.transcript, "set");
        break;
      // ---- tool calls ----
      case "response.function_call_arguments.done": {
        if (msg.name === "end_call") {
          setEnding(true);
          // Let the spoken goodbye finish before hanging up.
          window.setTimeout(() => hangUp(), 4000);
          break;
        }
        try {
          const args = JSON.parse(msg.arguments || "{}") as ProposalArgs;
          setProposal(args);
          loadPreview(args, msg.call_id); // preview → then answers the tool call
        } catch { /* ignore malformed tool args */ }
        break;
      }
    }
  }, [upsertTurn, loadPreview, hangUp, resetIdle]);

  // Live mic-level meter: drives the footer bars via a CSS var, no re-renders.
  const attachMeter = useCallback((stream: MediaStream) => {
    try {
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
      if (!Ctx) return;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.min(1, Math.sqrt(sum / buf.length) * 3.2); // 0..1, boosted
        meterRef.current?.style.setProperty("--mic", rms.toFixed(3));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch { /* metering is best-effort */ }
  }, []);

  // ── Connect (reusable so we can reconnect on drop) ─────────────────────────
  const startCall = useCallback(async () => {
    try {
      const sr = await apiRequest("POST", `/api/voice/session${IOS_QS}`, {});
      const sess = await sr.json().catch(() => ({}));
      if (closedRef.current) return;

      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micRef.current = mic;
      if (closedRef.current) { mic.getTracks().forEach((t) => t.stop()); return; }
      attachMeter(mic);

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pc.ontrack = (e) => { if (audioRef.current) audioRef.current.srcObject = e.streams[0]; };
      pc.addTrack(mic.getAudioTracks()[0], mic);

      // Reconnect on an unexpected drop (ICE fail / network blip). Up to 2 tries.
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (closedRef.current) return;
        if (st === "failed" || st === "disconnected") {
          if (reconnectsRef.current < 2) {
            reconnectsRef.current += 1;
            setState("reconnecting");
            teardownMedia();
            window.setTimeout(() => { if (!closedRef.current) startCall(); }, 800);
          } else {
            setError("Lost the connection. Tap to try again."); setState("error");
          }
        }
      };

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onopen = () => {
        if (closedRef.current) return;
        reconnectsRef.current = 0;
        setState("live");
        resetIdle();
        // Greet first (only on the initial connect, not on a reconnect).
        if (!greetedRef.current) {
          greetedRef.current = true;
          dc.send(JSON.stringify({ type: "response.create", response: { instructions: "Open with one short, warm line greeting the user and asking what they'd like to split. E.g. \"Hey! What are we splitting today?\"" } }));
        }
      };
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
      if (closedRef.current) return;
      const raw = String(e?.message || "");
      const capMatch = raw.match(/^\s*429:\s*([\s\S]*)$/);
      if (capMatch) {
        let msg = "Voice is taking a quick breather — you can still split by chatting.";
        try { const p = JSON.parse(capMatch[1]); msg = p?.message || msg; } catch { /* keep */ }
        setError(msg); setState("capped");
        return;
      }
      const m = e?.name === "NotAllowedError"
        ? "Microphone access is off. Enable it in Settings to talk to Spliiit."
        : (raw || "Something went wrong starting voice.");
      setError(m); setState("error");
    }
  }, [attachMeter, handleEvent, resetIdle, teardownMedia]);

  // Run once for the lifetime of the call (don't restart if the parent
  // re-renders and passes a new onClose).
  useEffect(() => {
    closedRef.current = false;
    startCall();
    maxTimerRef.current = window.setTimeout(() => {
      if (!closedRef.current) { addSystemTurn("Ended — calls cap at 5 minutes."); hangUp(); }
    }, MAX_CALL_MS);
    return () => { cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll the transcript to the newest turn / card.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, preview, previewing, committing, userSpeaking]);

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

        {state === "reconnecting" && (
          <div className="h-full flex items-center justify-center">
            <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Reconnecting…</p>
          </div>
        )}

        {state === "error" && (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-6">
            <p className="text-foreground">{error}</p>
            <button onClick={hangUp} className="h-11 px-6 rounded-full bg-accent-foreground text-white font-medium">Done</button>
          </div>
        )}

        {state === "capped" && (
          <div className="h-full flex flex-col items-center justify-center gap-5 text-center px-8">
            <div className="h-16 w-16 rounded-full bg-accent flex items-center justify-center">
              <span className="flex items-center gap-[3px]" aria-hidden="true">
                {[7, 12, 9].map((h, i) => (
                  <span key={i} style={{ width: 3, height: h, borderRadius: 9999, background: "hsl(var(--accent-foreground))", opacity: 0.5 }} />
                ))}
              </span>
            </div>
            <p className="text-foreground text-[15px] leading-snug max-w-xs">{error}</p>
            <button onClick={hangUp} className="h-12 px-7 rounded-full bg-accent-foreground text-white font-medium">Split by chatting</button>
          </div>
        )}

        {state === "live" && turns.length === 0 && !proposal && !preview && !previewing && (
          <div className="h-full flex items-center justify-center text-center px-8">
            <p className="text-muted-foreground text-lg">Tell me the bill — like you'd tell a friend. 🎙️</p>
          </div>
        )}

        {turns.map((t) => {
          if (!t.text.trim()) return null; // ordered placeholder not yet filled
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

        {/* live "you're speaking" bubble (words fill in when transcription lands) */}
        {userSpeaking && (
          <div className="flex justify-end">
            <div className="rounded-2xl rounded-br-md bg-accent-foreground/90 text-white px-4 py-3 flex items-center gap-1" aria-label="listening">
              <style>{`@keyframes vcDot{0%,60%,100%{opacity:.3}30%{opacity:1}}`}</style>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ width: 6, height: 6, borderRadius: 9999, background: "currentColor", animation: `vcDot 1.1s ease-in-out ${i * 0.18}s infinite` }} />
              ))}
            </div>
          </div>
        )}

        {/* working out the split */}
        {previewing && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-card border border-border px-4 py-2.5 text-[15px] text-muted-foreground flex items-center gap-2 rounded-bl-md">
              <Loader2 className="w-4 h-4 animate-spin" /> Working out the split…
            </div>
          </div>
        )}

        {/* inline confirm card — server-computed, on-brand */}
        {preview && (
          <div className="flex justify-start">
            <div className="w-[92%] max-w-sm rounded-[24px] border border-border bg-card p-5">
              <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground mb-2">Confirm split</p>

              <div className="flex items-end justify-between gap-3">
                <span className="font-mono tabular-nums text-foreground leading-none" style={{ fontSize: "2.5rem" }}>{money(preview.amount, preview.currency)}</span>
                {preview.groupName && (
                  <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-xs text-accent-foreground">
                    <Users className="w-3.5 h-3.5" />{preview.groupName}
                  </span>
                )}
              </div>
              <p className="font-serif text-2xl text-foreground mt-1 capitalize leading-tight">{preview.description}</p>
              <p className="text-xs text-muted-foreground mt-1">{shortDate(preview.date)} · you paid · {preview.splitLabel}</p>

              <div className="mt-4 rounded-2xl bg-muted/50 divide-y divide-border/70">
                {preview.people.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-3.5 py-2.5">
                    <span className="h-8 w-8 rounded-full text-white text-[11px] font-medium flex items-center justify-center shrink-0" style={{ backgroundColor: warmAvatar(p.id) }}>{initials(p.name)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] text-foreground truncate">{p.name}{p.isYou && <span className="text-muted-foreground text-xs"> you</span>}</p>
                      <p className="text-xs text-muted-foreground">{p.isYou ? `paid ${money(preview.amount, preview.currency)}` : "their share"}</p>
                    </div>
                    <span className="font-mono tabular-nums text-[13.5px] text-foreground shrink-0">{money(p.share, preview.currency)}</span>
                  </div>
                ))}
              </div>

              {preview.youGetBack > 0 && (
                <div className="mt-3 rounded-xl bg-accent/60 px-3.5 py-2.5 text-[13.5px] text-foreground">
                  You get back <span className="font-mono tabular-nums font-medium text-accent-foreground">{money(preview.youGetBack, preview.currency)}</span>
                </div>
              )}

              <div className="flex gap-3 mt-4">
                <button
                  disabled={committing}
                  onClick={() => { setPreview(null); setProposal(null); }}
                  className="flex-1 h-12 rounded-full border border-border bg-card text-foreground font-medium disabled:opacity-50"
                >Not quite</button>
                <button
                  disabled={committing}
                  onClick={() => proposal && commit(proposal)}
                  className="flex-[1.35] h-12 rounded-full bg-accent-foreground text-white font-medium flex items-center justify-center gap-1.5 disabled:opacity-70"
                >{committing ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Check className="w-[18px] h-[18px]" />Confirm split</>}</button>
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
            <span ref={meterRef} className="flex items-center justify-center gap-[3px] h-6 w-8" aria-hidden="true" style={{ ["--mic" as any]: 0 }}>
              <style>{`@keyframes vcBar{0%{transform:scaleY(.35)}100%{transform:scaleY(1)}}`}</style>
              {[8, 14, 20, 12, 7].map((h, i) => (
                <span key={i} style={{
                  width: 3, height: h, borderRadius: 9999,
                  background: "hsl(var(--accent-foreground))", transformOrigin: "center",
                  // Speaking → the model's animated equalizer. Listening → react
                  // to YOUR mic level so it feels alive while you talk.
                  animation: speaking ? `vcBar ${0.45 + (i % 5) * 0.1}s ease-in-out ${i * 0.05}s infinite alternate` : "none",
                  transform: speaking ? undefined : "scaleY(calc(0.22 + var(--mic, 0) * 1.6))",
                  transition: speaking ? undefined : "transform 90ms linear",
                  opacity: speaking ? 1 : 0.85,
                }} />
              ))}
            </span>
            <span className="text-sm text-muted-foreground truncate">{ending ? "Wrapping up…" : speaking ? "Spliiit is talking…" : "Listening…"}</span>
          </div>
          <button onClick={hangUp} className="h-11 px-6 rounded-full border border-border bg-muted text-foreground font-medium shrink-0">End</button>
        </div>
      )}
    </div>
  );
}
