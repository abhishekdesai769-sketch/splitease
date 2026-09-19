/**
 * VoiceCall — talk-back voice mode (OpenAI Realtime over WebRTC).
 *
 * Flow:
 *   1. POST /api/voice/session → ephemeral ek_ token (real key stays server-side)
 *   2. getUserMedia(audio) → mic; RTCPeerConnection; data channel "oai-events"
 *   3. SDP offer → https://api.openai.com/v1/realtime/calls → answer
 *   4. The model listens, TALKS BACK, and asks clarifying questions by voice.
 *   5. When it has enough, it calls propose_split → we render a Confirm card.
 *   6. On Confirm → POST /api/voice/commit (server resolves names→IDs and
 *      creates the expense through the SAME trusted path the manual form uses).
 *
 * The model never writes to the DB — it only proposes. The user always taps
 * Confirm before anything is saved, exactly like text AI Mode.
 *
 * NOTE (needs on-device testing): mic capture in the iOS Capacitor WKWebView
 * requires NSMicrophoneUsageDescription in Info.plist and iOS media-capture
 * permission. This component is verified to compile + follows the Realtime
 * WebRTC contract; the actual audio round-trip must be confirmed on a device.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { isIosNative } from "@/lib/iap";
import { X, Loader2, Check, Phone } from "lucide-react";

const IOS_QS = isIosNative ? "?platform=ios" : "";

type CallState = "connecting" | "live" | "proposal" | "committing" | "done" | "error";

interface ProposalArgs {
  amount: number;
  description?: string;
  currency?: string;
  paidByName?: string;
  splitAmongNames?: string[];
  groupName?: string;
  splitType?: "equal" | "unequal" | "full_to_one";
}

export default function VoiceCall({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [state, setState] = useState<CallState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ProposalArgs | null>(null);
  const [caption, setCaption] = useState("");      // live transcript of what Spliiit is saying
  const [speaking, setSpeaking] = useState(false); // model is talking → animate

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const cleanup = useCallback(() => {
    try { dcRef.current?.close(); } catch {}
    try { pcRef.current?.close(); } catch {}
    try { micRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    dcRef.current = null; pcRef.current = null; micRef.current = null;
  }, []);

  const hangUp = useCallback(() => { cleanup(); onClose(); }, [cleanup, onClose]);

  // ── Commit a proposal via the server (reuses trusted createExpense) ────────
  const commit = useCallback(async (args: ProposalArgs) => {
    setState("committing");
    try {
      await apiRequest("POST", `/api/voice/commit${IOS_QS}`, args);
      qc.invalidateQueries({ queryKey: ["/api/expenses"] });
      qc.invalidateQueries({ queryKey: ["/api/friends/expenses"] });
      qc.invalidateQueries({ queryKey: ["/api/friends"] });
      qc.invalidateQueries({ queryKey: ["/api/groups"] });
      setState("done");
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
      setError(clean);
      setState("error");
    }
  }, [qc]);

  // ── Handle Realtime events over the data channel ──────────────────────────
  const handleEvent = useCallback((msg: any) => {
    switch (msg.type) {
      case "response.created":
        setCaption("");
        break;
      // Assistant speech transcript (event name varies across API versions).
      case "response.audio_transcript.delta":
      case "response.output_audio_transcript.delta":
        setSpeaking(true);
        setCaption((c) => c + (msg.delta || ""));
        break;
      case "response.audio_transcript.done":
      case "response.output_audio_transcript.done":
        setSpeaking(false);
        break;
      case "response.function_call_arguments.done": {
        try {
          const args = JSON.parse(msg.arguments || "{}") as ProposalArgs;
          setProposal(args);
          setState("proposal");
          // Ack the tool call so the model can say its "tap Confirm" line.
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
  }, []);

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

  // ── UI ────────────────────────────────────────────────────────────────────
  const cur = (v: number) => `${(proposal?.currency && proposal.currency !== "CAD" ? proposal.currency + " " : "$")}${v.toFixed(2)}`;
  const names = proposal?.splitAmongNames?.length ? proposal.splitAmongNames : ["You"];
  const people = names.join(", ");
  const amountStr = proposal ? cur(Number(proposal.amount)) : "";
  const perPerson = proposal ? cur(Number(proposal.amount) / Math.max(names.length, 1)) : "";
  const initials = (n: string) => n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-background/95 backdrop-blur-sm px-6 py-10">
      <audio ref={audioRef} autoPlay className="hidden" />

      {/* top bar */}
      <div className="w-full flex justify-end">
        <button onClick={hangUp} aria-label="End voice" className="h-11 w-11 rounded-full bg-muted border border-border flex items-center justify-center">
          <X className="w-5 h-5 text-foreground" />
        </button>
      </div>

      {/* center: status + orb */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center">
        <div
          className={`h-28 w-28 rounded-full flex items-center justify-center transition-transform ${speaking ? "scale-110" : "scale-100"}`}
          style={{ background: "var(--accent-foreground, #B56A4A)", boxShadow: speaking ? "0 0 0 14px rgba(181,106,74,0.14)" : "0 0 0 6px rgba(181,106,74,0.10)" }}
        >
          <Phone className="w-10 h-10 text-white" />
        </div>

        {state === "connecting" && (
          <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Connecting…</p>
        )}
        {state === "live" && (
          <div className="min-h-[3rem] max-w-xs">
            <p className="text-sm font-medium text-accent-foreground mb-1">{speaking ? "Spliiit is talking…" : "Listening…"}</p>
            <p className="text-foreground text-lg leading-snug">{caption || "Tell me the bill — like you'd tell a friend."}</p>
          </div>
        )}
        {state === "committing" && (
          <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Saving the split…</p>
        )}
        {state === "done" && (
          <div className="flex flex-col items-center gap-3">
            <div className="h-14 w-14 rounded-full bg-accent-foreground flex items-center justify-center"><Check className="w-7 h-7 text-white" /></div>
            <p className="text-foreground text-lg font-medium">Split saved ✅</p>
            <p className="text-muted-foreground text-sm">{amountStr} · {people}</p>
          </div>
        )}
        {state === "error" && (
          <p className="text-foreground max-w-xs">{error}</p>
        )}
      </div>

      {/* bottom: proposal confirm card OR controls */}
      <div className="w-full max-w-sm">
        {state === "proposal" && proposal && (
          <div className="rounded-[28px] border border-border bg-card p-6 shadow-[0_24px_60px_-24px_rgba(40,26,16,0.45)]">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground mb-2">Here's your split</p>
            <div className="flex items-end justify-between gap-3">
              <span className="text-foreground leading-none" style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: "3rem" }}>{amountStr}</span>
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
                onClick={() => { setProposal(null); setState("live"); }}
                className="flex-1 h-12 rounded-full border border-border bg-card text-foreground font-medium"
              >Not quite</button>
              <button
                onClick={() => proposal && commit(proposal)}
                className="flex-1 h-12 rounded-full bg-accent-foreground text-white font-medium"
              >Confirm split</button>
            </div>
          </div>
        )}

        {(state === "done" || state === "error") && (
          <button onClick={hangUp} className="w-full h-12 rounded-full bg-accent-foreground text-white font-medium">Done</button>
        )}

        {(state === "live" || state === "connecting" || state === "committing") && (
          <button onClick={hangUp} className="w-full h-12 rounded-full border border-border bg-muted text-foreground font-medium">End</button>
        )}
      </div>
    </div>
  );
}
