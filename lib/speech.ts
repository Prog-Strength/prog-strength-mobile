// Thin wrapper around expo-speech-recognition for the chat
// composer's push-to-talk mic button. Same shape as the web's
// lib/speech.ts: callers register onTranscript/onEnd/onError and
// get back a session handle with stop()/abort().
//
// The native module is loaded via a defensive require() inside a
// try/catch — if the running dev-client wasn't built with
// expo-speech-recognition in the binary, isSpeechRecognitionAvailable()
// reports false and the chat page hides the mic button. Without this
// guard, the static `import { ExpoSpeechRecognitionModule }` would
// crash the JS bundle the moment chat/index.tsx evaluated. Matches
// the web sibling's graceful-degrade pattern for Firefox.

// Type-only import so TypeScript still knows the module's shape, but
// the runtime require below decides whether the module is actually
// present. `import type` gets erased at compile time and never touches
// the native bridge.
import type { ExpoSpeechRecognitionModule as ExpoSpeechRecognitionModuleType } from "expo-speech-recognition";

let speechModule: typeof ExpoSpeechRecognitionModuleType | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  speechModule = require("expo-speech-recognition").ExpoSpeechRecognitionModule;
} catch {
  // Native module not in this build. Most common reason: the
  // dev-client `.app` was built before expo-speech-recognition was
  // installed, so the pod isn't linked. The user needs a fresh EAS
  // build; meanwhile the app keeps booting.
}

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
 * True when the native expo-speech-recognition module is linked
 * into the running binary. False on a dev-client that pre-dates
 * the install — the chat page reads this to decide whether to
 * show the mic button at all.
 */
export function isSpeechRecognitionAvailable(): boolean {
  return speechModule !== null;
}

/**
 * Request mic + speech-recognition permissions if we don't have
 * them yet. Returns true when both are granted. Returns false
 * (without prompting) if the native module isn't in the build.
 */
export async function ensureSpeechPermissions(): Promise<boolean> {
  if (!speechModule) return false;
  const result = await speechModule.requestPermissionsAsync();
  return !!result.granted;
}

/**
 * Start a single utterance recognition session and return controls
 * to stop or abort it. Throws when the native module isn't loaded —
 * callers should feature-detect via isSpeechRecognitionAvailable()
 * before invoking.
 */
export function startSpeechSession(
  callbacks: SpeechSessionCallbacks,
): SpeechSession {
  if (!speechModule) {
    throw new Error(
      "expo-speech-recognition native module is not in this build",
    );
  }
  const module = speechModule;
  const removeResult = module.addListener("result", (event) => {
    const transcript = event.results.map((r) => r.transcript).join("");
    callbacks.onTranscript(transcript, event.isFinal);
  });
  const removeEnd = module.addListener("end", () => {
    cleanup();
    callbacks.onEnd();
  });
  const removeError = module.addListener("error", (event) => {
    cleanup();
    callbacks.onError(String(event.error));
  });

  let cleanedUp = false;
  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    removeResult.remove();
    removeEnd.remove();
    removeError.remove();
  }

  module.start({
    lang: "en-US",
    interimResults: true,
    // continuous=false: single utterance, ends when the user stops
    // talking or releases the button. Push-to-talk is the v1 UX
    // per the voice-chat SOW.
    continuous: false,
  });

  return {
    stop: () => module.stop(),
    abort: () => module.abort(),
  };
}
