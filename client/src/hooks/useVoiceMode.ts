/**
 * useVoiceMode — Web Speech API hook for push-to-talk voice mode
 *
 * Architecture:
 *   User holds mic button → startListening() → Web Speech API transcribes on-device →
 *   User releases → stopListening() → recognition.onend fires →
 *   parseVoiceIntent() runs locally → parsedIntent state set → UI shows confirmation
 *
 * Cost: $0. All processing is on-device (no AI API calls in MVP).
 * Supported: Chrome on desktop + Android (TWA/PWA). Limited on iOS Safari.
 */

import { useState, useRef, useCallback } from "react";
import { parseVoiceIntent, type ParsedVoiceIntent, type VoiceContext } from "@/lib/voiceParser";
import { track } from "@/lib/analytics";

export type VoiceState = "idle" | "listening" | "processing" | "result" | "error";

export interface UseVoiceModeResult {
  voiceState: VoiceState;
  transcript: string;         // final confirmed transcript
  interimTranscript: string;  // live partial transcript (shown while listening)
  parsedIntent: ParsedVoiceIntent | null;
  errorMessage: string | null;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
  reset: () => void;
}

// Resolve SpeechRecognition constructor once (avoids repeated window lookups)
const SpeechRecognitionAPI =
  typeof window !== "undefined"
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

export function useVoiceMode(ctx: VoiceContext): UseVoiceModeResult {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [parsedIntent, setParsedIntent] = useState<ParsedVoiceIntent | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const finalTranscriptRef = useRef(""); // accumulates final segments across result events
  const sessionStartRef = useRef<number>(0);

  const isSupported = !!SpeechRecognitionAPI;

  // ── Reset everything back to idle ─────────────────────────────────────────

  const reset = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
    finalTranscriptRef.current = "";
    setVoiceState("idle");
    setTranscript("");
    setInterimTranscript("");
    setParsedIntent(null);
    setErrorMessage(null);
  }, []);

  // ── Start listening (called on pointer down) ──────────────────────────────

  const startListening = useCallback(() => {
    if (!SpeechRecognitionAPI) {
      setErrorMessage("Voice Mode needs Chrome or a Chromium-based browser.");
      setVoiceState("error");
      return;
    }

    // Clean up any previous session
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }

    try {
      const recognition = new SpeechRecognitionAPI();
      recognition.lang = "en-US";
      recognition.continuous = false;    // one utterance per press
      recognition.interimResults = true; // show live transcript
      recognition.maxAlternatives = 1;

      recognitionRef.current = recognition;
      finalTranscriptRef.current = "";
      sessionStartRef.current = Date.now();
      setTranscript("");
      setInterimTranscript("");
      setParsedIntent(null);
      setErrorMessage(null);

      recognition.onstart = () => {
        setVoiceState("listening");
        track("voice_session_started");
      };

      recognition.onresult = (event: any) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const r = event.results[i];
          if (r.isFinal) {
            finalTranscriptRef.current += r[0].transcript;
            setTranscript(finalTranscriptRef.current);
          } else {
            interim += r[0].transcript;
          }
        }
        setInterimTranscript(interim);
      };

      recognition.onend = () => {
        const raw = finalTranscriptRef.current.trim();
        setInterimTranscript("");

        if (!raw) {
          setErrorMessage("Didn't catch that — hold and try again.");
          setVoiceState("error");
          track("voice_error", { reason: "no_speech" });
          return;
        }

        setVoiceState("processing");

        // Small delay so the "processing" state is visible (feels intentional)
        setTimeout(() => {
          const parsed = parseVoiceIntent(raw, ctx);
          setParsedIntent(parsed);
          setVoiceState("result");
          track("voice_intent_detected", {
            intent: parsed.type,
            confidence: parsed.confidence,
            duration_ms: Date.now() - sessionStartRef.current,
          });
        }, 350);
      };

      recognition.onerror = (event: any) => {
        const reason = event.error ?? "unknown";
        let msg = "Something went wrong. Try again.";
        if (reason === "no-speech")    msg = "Didn't catch anything — hold and try again.";
        if (reason === "not-allowed")  msg = "Microphone access denied. Check your browser settings.";
        if (reason === "network")      msg = "Network error. Try again when online.";
        if (reason === "aborted")      return; // user cancelled — not an error
        setErrorMessage(msg);
        setVoiceState("error");
        track("voice_error", { reason });
      };

      recognition.start();
    } catch {
      setErrorMessage("Couldn't start Voice Mode. Try again.");
      setVoiceState("error");
    }
  }, [ctx]);

  // ── Stop listening (called on pointer up / leave) ─────────────────────────

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      // onend will fire and process the transcript
    }
  }, []);

  return {
    voiceState,
    transcript,
    interimTranscript,
    parsedIntent,
    errorMessage,
    isSupported,
    startListening,
    stopListening,
    reset,
  };
}
