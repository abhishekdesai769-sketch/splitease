/**
 * useVoiceCall — the talk-back voice call engine (OpenAI Realtime over WebRTC),
 * shared by the full-screen VoiceCall (AI Mode) and the dashboard quick-add pill.
 * It owns the connection, the Realtime event handling, Jev-checked previews and
 * the server commit; callers only render.
 *
 * Flow:
 *   1. POST /api/voice/session → ephemeral ek_ token (real key stays server-side)
 *   2. getUserMedia(audio) → mic; RTCPeerConnection; data channel "oai-events"
 *   3. SDP offer → https://api.openai.com/v1/realtime/calls → answer
 *   4. Model listens, talks back, asks clarifying questions by voice.
 *   5. When it has enough, it calls propose_split → server preview (Jev-checked).
 *   6. commit() → POST /api/voice/commit (server resolves names→IDs and creates
 *      the expense through the SAME trusted path the manual form uses).
 *
 * The model never writes to the DB — it only proposes; the user taps to save.
 */

import { useEffect, useRef, useState, useCallback, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { isIosNative } from "@/lib/iap";

const IOS_QS = isIosNative ? "?platform=ios" : "";

export type CallState = "connecting" | "live" | "error" | "capped" | "reconnecting";

const IDLE_MS = 40000;        // hang up after this much dead air
const MAX_CALL_MS = 300000;   // hard 5-min cap (cost guard)

export interface ProposalArgs {
  amount: number;
  description?: string;
  currency?: string;
  paidByName?: string;
  splitAmongNames?: string[];
  groupName?: string;
  splitType?: "equal" | "custom" | "unequal" | "full_to_one";
  shares?: Array<{ name: string; amount: number }>;
  date?: string;
}

export interface Turn { id: string; role: "user" | "assistant" | "system"; text: string; }

export interface ResolvedPerson { id: string; name: string; isYou: boolean; share: number; }
export interface PreviewCard {
  amount: number; currency: string; description: string; date: string;
  groupId: string | null; groupName: string | null; splitLabel: string;
  perPerson: number; people: ResolvedPerson[]; youGetBack: number;
  verdict?: "high" | "check"; confidence?: number; weakField?: string | null;
}

export const WEAK_LABEL: Record<string, string> = {
  amount: "the amount", people: "who's involved", split: "how it's divided", date: "the date",
};

export function money(v: number, currency: string): string {
  const sym = !currency || currency === "CAD" || currency === "USD" ? "$" : currency + " ";
  return `${sym}${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function useVoiceCall({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [state, setState] = useState<CallState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [proposal, setProposal] = useState<ProposalArgs | null>(null);
  const [preview, setPreview] = useState<PreviewCard | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [editing, setEditing] = useState(false);   // tap-to-edit the confirm card
  const [edit, setEdit] = useState<{ description: string; amount: string; date: string }>({ description: "", amount: "", date: "" });
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
  // Ordering: anchor each user turn to the moment speech STARTS (always before
  // the reply), so the transcript never shows the answer above the question.
  const pendingUserRef = useRef<string | null>(null);
  const seqRef = useRef(0);
  const transcriptRef = useRef("");   // rolling user speech, for Jev cross-check
  // Stable per-call id so every logged turn (preview) + the save (commit) can be
  // grouped into one conversation in voice_interactions.
  const callIdRef = useRef<string>("");
  // Receipt/PDF vision: the Realtime model can't ingest images, so we upload the
  // file, transcribe it server-side (Claude Haiku), and inject the text into the call.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);

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
      const r = await apiRequest("POST", `/api/voice/preview${IOS_QS}`, { ...args, transcript: transcriptRef.current, callId: callIdRef.current });
      const card = await r.json() as PreviewCard;
      setPreview(card);
      setEditing(false);
      // Close the loop: if Jev's independent second-opinion flagged low confidence,
      // don't let the model announce "it's ready" — feed the finding BACK so it asks
      // the user to confirm the weak field out loud, then re-proposes. Jev drives the
      // conversation instead of just painting an amber badge the user has to catch.
      if (card.verdict === "check" && card.weakField) {
        // Tier the follow-up by Jev's confidence. A VERY low score (<0.10) means
        // it's probably wrong (e.g. a misheard name resolved to the wrong real
        // friend) — so read the value back and get an explicit yes before it's
        // ever "ready", instead of a soft nudge.
        const veryLow = typeof card.confidence === "number" && card.confidence < 0.1;
        const readBack = card.weakField === "people"
          ? `read back the exact names on the split (${card.people.map((p) => p.name).join(", ")}) and ask if those are the right people`
          : `confirm the exact ${card.weakField}`;
        answerTool(callId, {
          shown: true,
          needs_confirmation: true,
          weak_field: card.weakField,
          confidence: card.confidence,
          instruction: veryLow
            ? `STOP — do NOT say the split is ready. There's a strong chance ${WEAK_LABEL[card.weakField] || "a detail"} is wrong. ${readBack.charAt(0).toUpperCase() + readBack.slice(1)}. Only proceed once the user explicitly confirms; if they correct it, call propose_split again with the fix.`
            : `Do NOT say the split is ready yet. Ask ONE short, specific question to double-check ${WEAK_LABEL[card.weakField] || "that detail"} (${readBack}). If the user corrects it, call propose_split again with the fix; only once they confirm it's right, tell them it's ready to tap Confirm.`,
        });
      } else {
        answerTool(callId, { shown: true, instruction: "Say one short line telling them the split is ready and to tap Confirm." });
      }
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
      await apiRequest("POST", `/api/voice/commit${IOS_QS}`, { ...args, callId: callIdRef.current });
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

  // ── Receipt / PDF vision during a call ─────────────────────────────────────
  // The Realtime voice model can't see images, so we upload the file, transcribe
  // it server-side (Claude Haiku, same pipeline as text mode), then inject the
  // verbatim text into the live conversation as a user message so the model can
  // read it out / split off it. Bytes never persist.
  const onPickReceipt = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // allow re-picking the same file
    if (files.length === 0) return;
    setUploadingReceipt(true);
    addSystemTurn(`📎 Reading ${files.length > 1 ? `${files.length} receipts` : "receipt"}…`);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("attachments", f);
      const resp = await fetch(`/api/voice/attachment${IOS_QS}`, { method: "POST", body: fd, credentials: "include" });
      if (!resp.ok) {
        let msg = "Couldn't read that — try a clearer photo.";
        try { const p = await resp.json(); msg = p?.message || msg; } catch { /* keep */ }
        addSystemTurn(`⚠️ ${msg}`);
        return;
      }
      const { text } = await resp.json() as { text: string };
      addSystemTurn("📎 Receipt added — ask me to split it.");
      const dc = dcRef.current;
      if (dc && dc.readyState === "open") {
        // Feed the transcription in as user context, then let the model react.
        dc.send(JSON.stringify({
          type: "conversation.item.create",
          item: { type: "message", role: "user", content: [{ type: "input_text", text: `Here's a receipt I want to split (transcribed from a photo/PDF I attached):\n\n${text}` }] },
        }));
        dc.send(JSON.stringify({ type: "response.create", response: { instructions: "The user just attached a receipt (the text above). In one short line, tell them you've read it, say the total you see, and ask who they're splitting it with. Do NOT propose a split until they tell you the people." } }));
      }
      resetIdle();
    } catch {
      addSystemTurn("⚠️ Couldn't read that receipt — try again.");
    } finally {
      setUploadingReceipt(false);
    }
  }, [addSystemTurn, resetIdle]);

  // Tap-to-edit the confirm card (amount / title / date) without re-speaking.
  const beginEdit = useCallback(() => {
    if (!preview) return;
    setEdit({ description: preview.description, amount: String(preview.amount), date: preview.date.slice(0, 10) });
    setEditing(true);
  }, [preview]);

  const saveEdit = useCallback(() => {
    if (!proposal) { setEditing(false); return; }
    const amt = parseFloat(edit.amount);
    const merged: ProposalArgs = {
      ...proposal,
      description: edit.description.trim() || proposal.description,
      amount: Number.isFinite(amt) && amt > 0 ? amt : proposal.amount,
      date: /^\d{4}-\d{2}-\d{2}$/.test(edit.date) ? edit.date : proposal.date,
    };
    setProposal(merged);
    setEditing(false);
    loadPreview(merged); // no callId → recompute the card, don't make the model talk
  }, [proposal, edit, loadPreview]);

  // ── Handle Realtime events over the data channel ──────────────────────────
  const handleEvent = useCallback((msg: any) => {
    switch (msg.type) {
      // ---- barge-in + ORDERING anchor: the moment the user starts talking we
      // create their (empty) turn. This always precedes the reply, so the
      // transcript can never show the answer above the question. The words fill
      // into THIS turn when transcription lands. ----
      case "input_audio_buffer.speech_started":
        setSpeaking(false);
        setUserSpeaking(true);
        resetIdle();
        {
          const tid = `u-${Date.now()}-${seqRef.current++}`;
          pendingUserRef.current = tid;
          setTurns((prev) => [...prev, { id: tid, role: "user", text: "" }]);
        }
        break;
      case "input_audio_buffer.speech_stopped":
        setUserSpeaking(false);
        resetIdle();
        break;
      // ---- user speech transcription → fill the pending user turn ----
      case "conversation.item.input_audio_transcription.delta":
        if (pendingUserRef.current) upsertTurn(pendingUserRef.current, "user", msg.delta || "", "append");
        else if (msg.item_id) upsertTurn(msg.item_id, "user", msg.delta || "", "append");
        break;
      case "conversation.item.input_audio_transcription.completed":
        setUserSpeaking(false);
        if (typeof msg.transcript === "string") {
          const target = pendingUserRef.current || msg.item_id;
          if (target) upsertTurn(target, "user", msg.transcript, "set");
          transcriptRef.current = (transcriptRef.current + " " + msg.transcript).slice(-2000);
        }
        pendingUserRef.current = null;
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
    // New id for this call — groups all its logged turns together.
    try { callIdRef.current = crypto.randomUUID(); } catch { callIdRef.current = `call-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
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


  return {
    state, error, turns, proposal, setProposal, preview, setPreview, previewing, committing,
    editing, setEditing, edit, setEdit, ending, speaking, userSpeaking, uploadingReceipt,
    audioRef, bottomRef, meterRef, fileInputRef,
    hangUp, commit, beginEdit, saveEdit, onPickReceipt,
  };
}
