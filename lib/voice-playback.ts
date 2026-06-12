// expo-audio wrapper for the chat surface's TTS playback. Loads the
// native module via a defensive require() so the JS bundle keeps
// booting on a dev-client that pre-dates the expo-audio install. The
// chat page reads isAudioPlaybackAvailable() to decide whether the
// voice-mode toggle should be visible at all — matches the speech.ts
// pattern for the mic side of the surface.
//
// When the module isn't loaded, playback functions are no-ops that
// log a single warning. Voice playback was never going to work on
// the old dev-client anyway; this just prevents the static import
// from crashing the whole route.

import type { AudioPlayer as AudioPlayerType } from "expo-audio";

type AudioPlayerModule = {
  createAudioPlayer: (source?: string | { uri: string } | null) => AudioPlayerType;
};

let audioModule: AudioPlayerModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  audioModule = require("expo-audio") as AudioPlayerModule;
} catch {
  // Native module not in this build. The dev-client needs a fresh
  // EAS build to include the expo-audio pod.
}

// Re-export the AudioPlayer type so callers don't have to import it
// from expo-audio directly — that would trigger the same static-
// import resolution we're avoiding here.
export type AudioPlayer = AudioPlayerType;

export function isAudioPlaybackAvailable(): boolean {
  return audioModule !== null;
}

/**
 * Create an AudioPlayer for the given file:// URI. Returns null when
 * expo-audio isn't in the build — callers should check
 * isAudioPlaybackAvailable() before calling, or accept that they may
 * get back null and skip playback.
 */
export function createPlayer(uri: string): AudioPlayer | null {
  if (!audioModule) return null;
  return audioModule.createAudioPlayer(uri);
}
