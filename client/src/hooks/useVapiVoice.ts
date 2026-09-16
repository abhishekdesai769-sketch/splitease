/**
 * useVapiVoice — client half of AI Mode "Speak".
 *
 * Vapi runs the mic + STT + TTS + turn-taking in the browser; our backend
 * (/api/ai/voice-tool) is the brain via runAiTurn. This hook just drives the
 * Vapi call lifecycle and surfaces status + a live transcript for the UI.
 *
 * Auth: we fetch a short-lived token from /api/ai/voice/token and hand it to
 * Vapi as a variable (spliiitToken); it rides on every tool call so the
 * webhook knows which user is speaking. The token endpoint also returns the
 * public key + assistant id, so no Vapi ids are hard-coded in the client.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Vapi from "@vapi-ai/web";
import { apiRequest } from "@/lib/queryClient";

export type VoiceStatus = "idle" | "connecting" | "active" | "ending" | "error";
export interface TranscriptLine { role: "user" | "assistant"; text: string; }

export function useVapiVoice(opts?: { onExpenseCreated?: () => void; iosQs?: string }) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const vapiRef = useRef<any>(null);

  const teardown = useCallback(() => {
    try { vapiRef.current?.stop?.(); } catch {}
    try { vapiRef.current?.removeAllListeners?.(); } catch {}
    vapiRef.current = null;
  }, []);

  // Always stop the call if the component unmounts (leaving the page, toggle
  // back to chat) — never leave a hot mic / billable session running.
  useEffect(() => () => teardown(), [teardown]);

  const start = useCallback(async () => {
    if (status === "connecting" || status === "active") return;
    setError(null);
    setTranscript([]);
    setStatus("connecting");
    try {
      const r = await apiRequest("GET", `/api/ai/voice/token${opts?.iosQs || ""}`);
      if (!r.ok) throw new Error(r.status === 503 ? "Voice isn't set up yet." : "Couldn't start voice.");
      const { token, publicKey, assistantId } = await r.json();
      if (!publicKey || !assistantId) throw new Error("Voice isn't set up yet.");

      const vapi = new Vapi(publicKey);
      vapiRef.current = vapi;

      vapi.on("call-start", () => setStatus("active"));
      vapi.on("call-end", () => {
        setStatus("idle");
        // A split may have been created during the call — let the page refetch
        // balances/expenses. Cheap and idempotent.
        opts?.onExpenseCreated?.();
      });
      vapi.on("error", (e: any) => {
        console.error("[vapi] error", e);
        setError(typeof e?.message === "string" ? e.message : "Voice error — try again.");
        setStatus("error");
      });
      vapi.on("message", (m: any) => {
        // Final transcript lines only (skip noisy partials).
        if (m?.type === "transcript" && m?.transcriptType === "final" && m?.transcript) {
          const role: TranscriptLine["role"] = m.role === "assistant" ? "assistant" : "user";
          setTranscript((prev) => [...prev, { role, text: String(m.transcript) }]);
        }
      });

      // spliiitToken → assistantOverrides.variableValues → back on every tool call.
      await vapi.start(assistantId, { variableValues: { spliiitToken: token } } as any);
    } catch (e: any) {
      console.error("[vapi] start failed", e);
      setError(e?.message || "Couldn't start voice.");
      setStatus("error");
      teardown();
    }
  }, [status, teardown, opts]);

  const stop = useCallback(() => {
    setStatus("ending");
    try { vapiRef.current?.stop?.(); } catch {}
  }, []);

  return { status, transcript, error, start, stop };
}
