/**
 * speech.ts — Text-to-speech helper (Web Speech API)
 *
 * Works in Chrome, Edge, Chrome on Android — the same browsers
 * that support SpeechRecognition for Voice Mode input.
 *
 * iOS Safari web users already see the "get the app" screen and
 * never reach voice clarification, so they're unaffected.
 */

export const isTTSSupported =
  typeof window !== "undefined" && "speechSynthesis" in window;

/**
 * Speak `text` and return a Promise that resolves when the utterance ends.
 * If TTS is unsupported, resolves immediately so callers can proceed.
 *
 * @param text  The string to speak.
 * @param opts  Optional rate (default 1) and pitch (default 1).
 */
export function speak(
  text: string,
  opts: { rate?: number; pitch?: number } = {}
): Promise<void> {
  return new Promise((resolve) => {
    if (!isTTSSupported) {
      resolve();
      return;
    }

    // Cancel any in-progress speech before starting a new utterance
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = opts.rate ?? 1;
    utterance.pitch = opts.pitch ?? 1;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve(); // always resolve so mic can still start

    window.speechSynthesis.speak(utterance);
  });
}

/** Stop any currently playing speech immediately. */
export function stopSpeaking(): void {
  if (isTTSSupported) {
    window.speechSynthesis.cancel();
  }
}
