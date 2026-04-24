/**
 * useVoiceMode — cross-platform voice hook
 *
 * On iOS native (Capacitor): uses @capacitor-community/speech-recognition
 *   → AVFoundation / SFSpeechRecognizer, works in the App Store binary
 *
 * On web / Android: uses the Web Speech API (webkitSpeechRecognition)
 *   → Chrome on desktop + Android (TWA/PWA). Limited on iOS Safari.
 *
 * Architecture:
 *   User holds mic button → startListening() → transcribes on-device →
 *   User releases → stopListening() → parseVoiceIntent() runs locally →
 *   parsedIntent state set → UI shows confirmation
 *
 * Cost: $0. All processing is on-device.
 */

import { useState, useRef, useCallback } from "react";
import { parseVoiceIntent, type ParsedVoiceIntent, type VoiceContext } from "@/lib/voiceParser";
import { track } from "@/lib/analytics";
import { isIosNative } from "@/lib/iap";
import { SpeechRecognition as NativeSpeech } from "@capacitor-community/speech-recognition";

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

// Web Speech API — resolved once (avoids repeated window lookups)
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

  const recognitionRef = useRef<any>(null);    // Web Speech API instance
  const nativeListenerRef = useRef<any>(null); // Capacitor listener handle
  const finalTranscriptRef = useRef("");        // accumulates transcript across events
  const sessionStartRef = useRef<number>(0);

  // Both native iOS and Web Speech API are "supported" — each has its own path
  const isSupported = isIosNative || !!SpeechRecognitionAPI;

  // ── Shared: process final transcript into a parsed intent ─────────────────

  const processTranscript = useCallback((raw: string) => {
    setInterimTranscript("");
    if (!raw) {
      setErrorMessage("Didn't catch that — hold and try again.");
      setVoiceState("error");
      track("voice_error", { reason: "no_speech" });
      return;
    }
    setTranscript(raw);
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
  }, [ctx]);

  // ── Reset everything back to idle ─────────────────────────────────────────

  const reset = useCallback(() => {
    // Clean up native listener
    if (nativeListenerRef.current) {
      try { nativeListenerRef.current.remove(); } catch {}
      nativeListenerRef.current = null;
    }
    // Stop native recognition (fire-and-forget, may already be stopped)
    if (isIosNative) {
      NativeSpeech.stop().catch(() => {});
    }
    // Clean up web recognition
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
    // Clean up any previous session
    if (nativeListenerRef.current) {
      try { nativeListenerRef.current.remove(); } catch {}
      nativeListenerRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }

    finalTranscriptRef.current = "";
    sessionStartRef.current = Date.now();
    setTranscript("");
    setInterimTranscript("");
    setParsedIntent(null);
    setErrorMessage(null);

    if (isIosNative) {
      // ── NATIVE iOS PATH (AVFoundation / SFSpeechRecognizer) ──────────────
      (async () => {
        try {
          // 1. Check hardware availability
          const { available } = await NativeSpeech.available();
          if (!available) {
            setErrorMessage("Speech recognition isn't available on this device.");
            setVoiceState("error");
            return;
          }

          // 2. Request mic + speech recognition permission (OS dialog on first use)
          const perms = await NativeSpeech.requestPermissions();
          if (perms.speechRecognition !== "granted" || perms.microphone !== "granted") {
            setErrorMessage("Microphone denied — go to Settings → Spliiit → Microphone.");
            setVoiceState("error");
            return;
          }

          // 3. Subscribe to partial results — the last one IS the final transcript
          nativeListenerRef.current = await NativeSpeech.addListener(
            "partialResults",
            (data: { matches: string[] }) => {
              const text = data.matches?.[0] ?? "";
              finalTranscriptRef.current = text; // always keep the latest
              setInterimTranscript(text);
            }
          );

          // 4. Start recognition with our custom UI (no system popup)
          setVoiceState("listening");
          track("voice_session_started");

          await NativeSpeech.start({
            language: "en-US",
            maxResults: 1,
            partialResults: true,
            popup: false,
          });
        } catch {
          setErrorMessage("Couldn't start Voice Mode. Try again.");
          setVoiceState("error");
        }
      })();

    } else {
      // ── WEB SPEECH API PATH (Chrome / Chromium) ──────────────────────────
      if (!SpeechRecognitionAPI) {
        setErrorMessage("Voice Mode needs Chrome or a Chromium-based browser.");
        setVoiceState("error");
        return;
      }

      try {
        const recognition = new SpeechRecognitionAPI();
        recognition.lang = "en-US";
        recognition.continuous = false;    // one utterance per press
        recognition.interimResults = true; // show live transcript
        recognition.maxAlternatives = 1;

        recognitionRef.current = recognition;

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
          processTranscript(finalTranscriptRef.current.trim());
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
    }
  }, [ctx, processTranscript]);

  // ── Stop listening (called on pointer up / leave) ─────────────────────────

  const stopListening = useCallback(() => {
    if (isIosNative) {
      // ── NATIVE iOS STOP ──────────────────────────────────────────────────
      (async () => {
        try {
          await NativeSpeech.stop();
          // Clean up the partial results listener
          if (nativeListenerRef.current) {
            try { nativeListenerRef.current.remove(); } catch {}
            nativeListenerRef.current = null;
          }
          // Last partialResults event = final transcript
          processTranscript(finalTranscriptRef.current.trim());
        } catch {
          setErrorMessage("Something went wrong. Try again.");
          setVoiceState("error");
        }
      })();

    } else {
      // ── WEB SPEECH API STOP ──────────────────────────────────────────────
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        // recognition.onend fires → processTranscript() is called there
      }
    }
  }, [processTranscript]);

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
