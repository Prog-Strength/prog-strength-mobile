// Thin wrapper around expo-speech-recognition for the chat
// composer's push-to-talk mic button. Same shape as the web's
// lib/speech.ts: callers register onTranscript/onEnd/onError and
// get back a session handle with stop()/abort().
//
// Why a wrapper at all? expo-speech-recognition exposes the result
// via global useSpeechRecognitionEvent hooks, but the chat surface
// already manages a lot of state — sticking with the explicit
// callback contract makes the call site simpler and matches the
// web sibling exactly so future readers can reason about both
// platforms with the same mental model.
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";

export type SpeechSession = {
  /** Stop listening and finalize whatever has been heard so far. */
  stop: () => void;
  /** Abort listening immediately; no final result is emitted. */
  abort: () => void;
};

export type SpeechSessionCallbacks = {
  /**
   * Called every time the recognizer has new text — both interim
   * and final results. The transcript is the cumulative text since
   * session start; the chat page swaps it into the composer's
   * `input` state on every callback so the user sees their words
   * typed live.
   */
  onTranscript: (transcript: string, isFinal: boolean) => void;
  /**
   * Called once when the recognizer stops (either via stop(),
   * abort(), or naturally on silence / end-of-utterance). Useful
   * to flip a UI flag out of "listening" state.
   */
  onEnd: () => void;
  /**
   * Called on any recognizer error. expo-speech-recognition emits
   * platform-mapped strings (e.g. "not-allowed", "no-speech",
   * "audio-capture"). The chat page surfaces "not-allowed" since
   * that's the only one the user can act on.
   */
  onError: (error: string) => void;
};

/**
 * Always returns true on iOS + Android — the lib's native module
 * is always available when the dev-client / production binary has
 * it linked. Lives behind a function for parity with the web
 * sibling (where the SpeechRecognition global is browser-gated).
 *
 * If the lib is ever unavailable (e.g. running in Expo Go on a
 * stale dev-client that wasn't rebuilt after install), the
 * underlying ExpoSpeechRecognitionModule access will throw on
 * start() — the chat page handles that gracefully.
 */
export function isSpeechRecognitionAvailable(): boolean {
  return true;
}

/**
 * Request mic + speech-recognition permissions if we don't have
 * them yet. Returns true when both are granted. Safe to call
 * multiple times — the OS handles deduplication.
 */
export async function ensureSpeechPermissions(): Promise<boolean> {
  const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  return !!result.granted;
}

/**
 * Start a single utterance recognition session and return controls
 * to stop or abort it. Mirrors the web's startSpeechSession exactly
 * so the chat page's handlers don't need to branch on platform.
 *
 * Callers MUST call ensureSpeechPermissions() before calling this
 * the first time — the native module will throw on a denied
 * permission and onError receives the platform error code, which
 * the chat page surfaces as the inline "allow mic in settings"
 * hint.
 */
export function startSpeechSession(
  callbacks: SpeechSessionCallbacks,
): SpeechSession {
  // The module's event listeners are global per-process — we attach
  // ours, then remove them when the session ends so subsequent
  // sessions don't double-fire callbacks.
  const removeResult = ExpoSpeechRecognitionModule.addListener(
    "result",
    (event) => {
      // event.results is an array of { transcript, confidence };
      // join into a single cumulative string. event.isFinal flips
      // true on the last result of the utterance.
      const transcript = event.results
        .map((r) => r.transcript)
        .join("");
      callbacks.onTranscript(transcript, event.isFinal);
    },
  );
  const removeEnd = ExpoSpeechRecognitionModule.addListener("end", () => {
    cleanup();
    callbacks.onEnd();
  });
  const removeError = ExpoSpeechRecognitionModule.addListener(
    "error",
    (event) => {
      cleanup();
      callbacks.onError(String(event.error));
    },
  );

  let cleanedUp = false;
  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    removeResult.remove();
    removeEnd.remove();
    removeError.remove();
  }

  ExpoSpeechRecognitionModule.start({
    lang: "en-US",
    interimResults: true,
    // continuous=false: single utterance, ends when the user stops
    // talking or releases the button. Push-to-talk is the v1 UX
    // per the voice-chat SOW.
    continuous: false,
  });

  return {
    stop: () => ExpoSpeechRecognitionModule.stop(),
    abort: () => ExpoSpeechRecognitionModule.abort(),
  };
}
