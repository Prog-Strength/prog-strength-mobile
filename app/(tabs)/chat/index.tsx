// Chat screen. Mirrors prog-strength-web's /chat in shape, including
// markdown rendering — assistant turns route through
// react-native-markdown-display so `**bold**`, lists, code, and
// tables come out formatted instead of as literal asterisks. User
// turns stay plain Text (users don't intentionally write markdown
// when typing into a chat composer).
//
// Sessions persist on the API per the persistent-chat-sessions SOW:
// on mount we either resume a session referenced by ?session=<id> or
// mint a fresh one via POST /chat-sessions. After each completed
// stream the user+assistant pair is appended via POST .../messages.
// On the first turn of a fresh session, the agent's /title endpoint
// gets a background call, then PATCH /chat-sessions/{id} writes the
// returned title back so the history list shows a friendly label.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import Markdown from "react-native-markdown-display";
import { File, Paths } from "expo-file-system";
import { Ionicons } from "@expo/vector-icons";
import { clearToken, getToken } from "@/lib/auth";
import { config } from "@/lib/config";
import { streamChat } from "@/lib/stream";
import {
  appendChatTurn,
  createChatSession,
  getChatSession,
  patchChatSessionTitle,
  type ChatMessage as PersistedChatMessage,
} from "@/lib/api";
import { generateChatTitle } from "@/lib/agent";
import {
  ensureSpeechPermissions,
  isSpeechRecognitionAvailable,
  startSpeechSession,
  type SpeechSession,
} from "@/lib/speech";
import {
  createPlayer,
  isAudioPlaybackAvailable,
  type AudioPlayer,
} from "@/lib/voice-playback";

// Feature-detect both native modules once at module load. The chat
// surface hides the mic button + voice-mode toggle when the running
// dev-client doesn't have them linked, so the app still boots after
// installing an older .app by mistake. Same pattern the web client
// uses to gracefully degrade on Firefox.
const SPEECH_SUPPORTED = isSpeechRecognitionAvailable();
const AUDIO_PLAYBACK_SUPPORTED = isAudioPlaybackAvailable();

type ToolCall = {
  name: string;
  state: "running" | "ok" | "error";
};

type Message = {
  role: "user" | "assistant";
  content: string;
  // Tools the agent invoked while producing this turn. Order reflects
  // call order. Persisted on the message so historical turns still
  // show "agent called X" after streaming ends.
  tools?: ToolCall[];
  // Claude model that produced this turn (set when the agent emits
  // model_chosen). Surfaces "via Haiku" / "via Sonnet" labels.
  model?: string;
};

export default function ChatScreen() {
  const router = useRouter();
  // Expo Router exposes ?session=<id> via useLocalSearchParams. We
  // read it once per mount; the session-bootstrap effect picks up
  // changes via dep.
  const params = useLocalSearchParams<{ session?: string }>();
  const urlSessionId = typeof params.session === "string" ? params.session : null;

  // Active session id. Set immediately on mount: either from the
  // URL (resume) or a fresh client-minted UUID (new chat). For the
  // new-chat path the server-side row is created lazily inside
  // send() — eager creation would litter the user's history with
  // empty sessions every time they tap the chat tab without
  // actually sending a message.
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Whether the API has the chat_sessions row for this id. True
  // after a successful resume GET or after the lazy POST inside
  // send(). Drives whether send() needs to call createChatSession
  // before appending the first turn.
  const [sessionPersisted, setSessionPersisted] = useState(false);
  // Loading is only meaningful for the resume path — we have to
  // wait for the GET before we know what messages to show. The
  // composer is gated on `!loading` so a user can't send into a
  // session whose history hasn't loaded yet.
  const [loading, setLoading] = useState<boolean>(!!urlSessionId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);

  // Voice mode: when on, completed assistant turns play back as
  // audio via the agent's /speak endpoint. Off by default and
  // session-scoped (per the voice-chat SOW); resets on tab unmount.
  const [voiceMode, setVoiceMode] = useState(false);
  // True while the user is holding the mic button and the
  // recognizer is listening. Drives the red pulsing visual.
  const [listening, setListening] = useState(false);
  // Active recognition session. Ref (not state) because it's a
  // mutable native handle, not render state.
  const speechSessionRef = useRef<SpeechSession | null>(null);
  // Active TTS playback: the expo-audio AudioPlayer and the on-disk
  // mp3 path. Refs because the player is an imperative native handle;
  // we tear both down between turns and on unmount so stale audio
  // doesn't play over the next reply.
  const playbackPlayerRef = useRef<AudioPlayer | null>(null);
  const playbackUriRef = useRef<string | null>(null);
  // Pending audio-chunk file URIs queued from audio_chunk SSE events
  // but not yet played. drainAudioQueue pops the head, creates a
  // player, plays it, and chains onto the next on didJustFinish.
  // Cleared by stopPlayback on new turn / voice toggle off / unmount.
  const audioQueueRef = useRef<string[]>([]);
  // Captures Date.now() when send() fires so the first audio_chunk
  // that plays can compute end-to-end TTFA. Reset per turn.
  const turnStartMsRef = useRef<number>(0);
  // Guards the TTFA telemetry POST so we only report once per turn.
  const firstAudioReportedRef = useRef<boolean>(false);

  // Bootstrap the session on every mount. Two paths:
  //   - URL has ?session=<id>: GET to rehydrate (history + persisted
  //     flag flips). Aborted via `cancelled` if the user races
  //     forward to a New Chat before the GET resolves.
  //   - URL is bare: mint a UUID locally and set it; no API call.
  //     The row gets created inside send() on the first real turn.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      // Reset inside the async body so React's rules-of-hooks lint
      // against sync setState in effects stays satisfied — awaits
      // below force these updates onto a microtask tick.
      setMessages([]);
      setError(null);
      setSessionPersisted(false);
      setLoading(!!urlSessionId);

      if (!urlSessionId) {
        const id = Crypto.randomUUID();
        if (cancelled) return;
        setSessionId(id);
        return;
      }

      try {
        const token = await getToken();
        if (!token) {
          router.replace("/login");
          return;
        }
        const session = await getChatSession(token, urlSessionId);
        if (cancelled) return;
        setSessionId(session.id);
        setMessages(session.messages.map(persistedToUI));
        setSessionPersisted(true);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes("401")) {
          await clearToken();
          router.replace("/login");
          return;
        }
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [urlSessionId, router]);

  // Auto-scroll on every message-list change. FlatList renders newest
  // last; scrolling to end after each update keeps the freshest text
  // visible above the keyboard.
  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  // Tear down active playback. Idempotent — safe to call when
  // nothing is playing. Both the AudioPlayer and the on-disk mp3
  // file need explicit cleanup; without the delete the cache
  // directory would slowly fill up over a long session.
  const stopPlayback = useCallback(() => {
    const player = playbackPlayerRef.current;
    const uri = playbackUriRef.current;
    const queued = audioQueueRef.current;
    playbackPlayerRef.current = null;
    playbackUriRef.current = null;
    audioQueueRef.current = [];
    firstAudioReportedRef.current = false;
    if (player) {
      try {
        player.remove();
      } catch {
        // player may already be released if the natural-end
        // listener fired first
      }
    }
    if (uri) {
      try {
        new File(uri).delete();
      } catch {
        // best-effort cleanup; the OS reclaims cacheDirectory on
        // low-storage anyway
      }
    }
    // Delete the queued-but-not-yet-played chunk files so the
    // cache directory doesn't accumulate orphaned mp3s across
    // interrupted turns.
    for (const queuedUri of queued) {
      try {
        new File(queuedUri).delete();
      } catch {
        // best-effort
      }
    }
  }, []);

  // Pop the head of audioQueueRef, create a player, play it; on
  // didJustFinish chain onto the next chunk. Idempotent — early-
  // returns when something is already playing so back-to-back
  // audio_chunk events can both call drainAudioQueue safely. First
  // audio in a turn fires the TTFA telemetry POST exactly once
  // (guarded by firstAudioReportedRef).
  const drainAudioQueue = useCallback(async () => {
    if (playbackPlayerRef.current) return;
    const uri = audioQueueRef.current.shift();
    if (!uri) return;
    if (!AUDIO_PLAYBACK_SUPPORTED) {
      // expo-audio native module missing — drop the file and
      // continue to the next chunk silently.
      try {
        new File(uri).delete();
      } catch {
        // best-effort
      }
      void drainAudioQueue();
      return;
    }
    const player = createPlayer(uri);
    if (!player) {
      try {
        new File(uri).delete();
      } catch {
        // best-effort
      }
      void drainAudioQueue();
      return;
    }
    playbackPlayerRef.current = player;
    playbackUriRef.current = uri;

    // Fire TTFA telemetry on the first chunk that actually plays.
    if (!firstAudioReportedRef.current && turnStartMsRef.current > 0) {
      firstAudioReportedRef.current = true;
      const ttfaMs = Date.now() - turnStartMsRef.current;
      void (async () => {
        const t = await getToken();
        if (!t) return;
        try {
          await fetch(`${config.agentUrl}/telemetry/voice`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${t}`,
            },
            body: JSON.stringify({
              session_id: sessionId,
              time_to_first_audio_ms: ttfaMs,
            }),
          });
        } catch {
          // Swallow — telemetry failure is invisible to users.
        }
      })();
    }

    player.addListener("playbackStatusUpdate", (status) => {
      if (!status.isLoaded) return;
      if (status.didJustFinish) {
        try {
          player.remove();
        } catch {
          // already released
        }
        if (playbackUriRef.current === uri) {
          try {
            new File(uri).delete();
          } catch {
            // best-effort
          }
          playbackUriRef.current = null;
        }
        if (playbackPlayerRef.current === player) {
          playbackPlayerRef.current = null;
        }
        // Advance to the next queued chunk, if any.
        void drainAudioQueue();
      }
    });
    player.play();
  }, [sessionId]);

  // Push-to-talk: onPressIn starts a recognition session,
  // onPressOut stops it. The recognizer fills the composer's
  // `input` state with cumulative transcripts as the user speaks;
  // release commits the final transcript but doesn't send — the
  // user edits + hits Send manually. Same safety contract as web.
  const startListening = useCallback(async () => {
    if (listening) return;
    setError(null);
    // Don't listen over the agent's own voice — it'd just feed
    // back into the recognizer.
    stopPlayback();
    const granted = await ensureSpeechPermissions();
    if (!granted) {
      setError(
        "Microphone or speech recognition is blocked. Allow them in Settings.",
      );
      return;
    }
    try {
      const session = startSpeechSession({
        onTranscript: (transcript) => {
          setInput(transcript);
        },
        onEnd: () => {
          setListening(false);
          speechSessionRef.current = null;
        },
        onError: (code) => {
          if (code === "not-allowed" || code === "service-not-allowed") {
            setError(
              "Microphone or speech recognition is blocked. Allow them in Settings.",
            );
          }
          setListening(false);
          speechSessionRef.current = null;
        },
      });
      speechSessionRef.current = session;
      setListening(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voice input failed to start");
    }
  }, [listening, stopPlayback]);

  const stopListening = useCallback(() => {
    if (speechSessionRef.current) {
      speechSessionRef.current.stop();
      // onEnd flips `listening` to false and clears the ref.
    }
  }, []);

  const toggleVoiceMode = useCallback(() => {
    setVoiceMode((prev) => {
      const next = !prev;
      // Turning voice mode off mid-playback should silence the
      // active audio — surprising otherwise.
      if (!next) stopPlayback();
      return next;
    });
  }, [stopPlayback]);

  // Cleanup on unmount. Tabs in Expo Router stay mounted across
  // tab switches, but a hard navigation or app close still needs
  // to release the native player + delete the temp file.
  useEffect(() => {
    return () => {
      stopPlayback();
      speechSessionRef.current?.abort();
    };
  }, [stopPlayback]);

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming || loading || !sessionId) return;

    const token = await getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setError(null);

    // Lazy-create the session row server-side if we haven't yet —
    // this is the first turn of a fresh chat. Done BEFORE the
    // optimistic UI update so an early failure here doesn't leave
    // the user staring at their own message with no way to recover.
    if (!sessionPersisted) {
      try {
        await createChatSession(token, sessionId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes("401")) {
          await clearToken();
          router.replace("/login");
          return;
        }
        setError(msg);
        return;
      }
      setSessionPersisted(true);
    }

    // Optimistic update: append the user message and a placeholder
    // assistant we'll fill as deltas arrive. Doing both in one
    // setState avoids the flash where the user message renders alone.
    const userMsg: Message = { role: "user", content: trimmed };
    const placeholder: Message = { role: "assistant", content: "", tools: [] };
    const nextMessages = [...messages, userMsg];
    setMessages([...nextMessages, placeholder]);
    setInput("");
    setStreaming(true);

    // Cancel any audio queue / playback left over from a prior turn
    // and capture the turn-start timestamp so the first audio_chunk
    // that arrives can compute TTFA against it.
    stopPlayback();
    turnStartMsRef.current = Date.now();

    // Track whether this is the first turn of the session so we
    // know to fire title generation after the append. Pre-append
    // messages.length === 0 is the "first" signal.
    const isFirstTurn = messages.length === 0;
    let assistantText = "";
    let chosenModel: string | undefined;
    const toolsLog: ToolCall[] = [];

    try {
      for await (const ev of streamChat(token, {
        messages: nextMessages,
        session_id: sessionId,
        // IANA timezone the agent uses to compute the user's local
        // date and prepend it to the system prompt. Without this the
        // model can't reliably answer "did I work out yesterday?" —
        // it has no grounding for what "today" means. Hermes ships
        // with full Intl support so the resolvedOptions() call is
        // safe across iOS + Android. Server falls back to UTC if the
        // string is bogus, so older clients without this field
        // continue to work.
        client_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        // When true, the agent's voice_streamer wraps the SSE
        // stream with per-sentence audio_chunk events. The handler
        // below decodes each chunk's base64 mp3 to a temp file and
        // queues it for playback. See
        // prog-strength-docs/sows/streaming-tts.md.
        voice_mode: voiceMode,
      })) {
        if (ev.type === "text_delta") {
          assistantText += ev.text;
          setMessages((prev) =>
            replaceLast(prev, (last) => ({ ...last, content: assistantText })),
          );
        } else if (ev.type === "tool_use_start") {
          toolsLog.push({ name: ev.name, state: "running" });
          setMessages((prev) =>
            replaceLast(prev, (last) => ({
              ...last,
              tools: [...(last.tools ?? []), { name: ev.name, state: "running" }],
            })),
          );
        } else if (ev.type === "tool_result") {
          const finalState: "ok" | "error" = ev.is_error ? "error" : "ok";
          for (let i = toolsLog.length - 1; i >= 0; i--) {
            if (toolsLog[i].name === ev.name && toolsLog[i].state === "running") {
              toolsLog[i] = { ...toolsLog[i], state: finalState };
              break;
            }
          }
          setMessages((prev) =>
            replaceLast(prev, (last) => {
              const tools = (last.tools ?? []).slice();
              for (let i = tools.length - 1; i >= 0; i--) {
                if (tools[i].name === ev.name && tools[i].state === "running") {
                  tools[i] = { ...tools[i], state: finalState };
                  break;
                }
              }
              return { ...last, tools };
            }),
          );
        } else if (ev.type === "model_chosen") {
          chosenModel = ev.model;
          setMessages((prev) =>
            replaceLast(prev, (last) => ({ ...last, model: ev.model })),
          );
        } else if (ev.type === "audio_chunk") {
          // Decode the base64 mp3 to a temp file in the cache dir
          // and push the URI into the playback queue. expo-audio
          // can't play in-memory buffers — needs a URI — so each
          // chunk lands on disk briefly, gets played, then deleted
          // in the didJustFinish handler inside drainAudioQueue.
          try {
            const bytes = base64ToBytes(ev.mp3_base64);
            const file = new File(
              Paths.cache,
              `chat-chunk-${sessionId}-${ev.index}.mp3`,
            );
            file.write(bytes);
            audioQueueRef.current.push(file.uri);
            void drainAudioQueue();
          } catch (err) {
            // A single chunk failing to decode/write shouldn't kill
            // the rest of the turn — log and continue.
            console.warn("voice: audio_chunk write failed", err);
          }
        } else if (ev.type === "error") {
          setError(ev.message);
        }
        // "done" is informational — the stream ends naturally.
      }

      // Persist the turn server-side. Visible messages aren't rolled
      // back if this fails — the error surfaces inline so the user
      // can decide whether to retry; the local state already shows
      // what they saw.
      if (assistantText) {
        const toolsJSON = toolsLog.length > 0 ? JSON.stringify(toolsLog) : undefined;
        try {
          await appendChatTurn(token, sessionId, {
            user: { content: trimmed },
            assistant: {
              content: assistantText,
              model: chosenModel,
              tools_json: toolsJSON,
            },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(`failed to save turn: ${msg}`);
        }

        if (isFirstTurn) {
          // Fire-and-forget title generation. We deliberately do NOT
          // await this — the user can keep chatting; the title
          // shows up in the history list whenever the PATCH lands.
          void titleAndPatch(token, sessionId, trimmed, assistantText);
        }

        // Voice playback (when voiceMode is on) now rides on the
        // SSE stream itself via audio_chunk events handled inline
        // above — no post-stream /speak roundtrip. The streaming-tts
        // SOW switched us from one-mp3-per-turn to one-mp3-per-
        // sentence so first audio starts within ~1-2s of send
        // instead of ~5-12s.
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("401")) {
        await clearToken();
        router.replace("/login");
        return;
      }
      setError(msg);
    } finally {
      setStreaming(false);
    }
  }, [
    input,
    messages,
    router,
    sessionId,
    sessionPersisted,
    loading,
    streaming,
    voiceMode,
    stopPlayback,
    drainAudioQueue,
  ]);

  const startNewChat = () => {
    // Pushing /chat without ?session triggers the bootstrap effect's
    // new-session branch. router.push (not replace) so the user can
    // hit Back to return to the previous conversation.
    router.push("/chat");
  };

  const openHistory = () => {
    router.push("/chat/history");
  };

  return (
    <KeyboardAvoidingView
      // iOS: shift the whole layout up by the keyboard height. Android
      // handles it via windowSoftInputMode in the native manifest.
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-background"
    >
      <Stack.Screen
        options={{
          title: "Chat",
          headerRight: () => (
            <View className="flex-row items-center gap-2 pr-2">
              {AUDIO_PLAYBACK_SUPPORTED && (
                <Pressable
                  onPress={toggleVoiceMode}
                  accessibilityRole="button"
                  accessibilityState={{ selected: voiceMode }}
                  accessibilityLabel={
                    voiceMode
                      ? "Voice mode on, tap to turn off"
                      : "Voice mode off, tap to turn on"
                  }
                  hitSlop={6}
                  className={`rounded-full border px-2.5 py-1 active:opacity-80 ${
                    voiceMode
                      ? "border-accent bg-accent/15"
                      : "border-border bg-surface"
                  }`}
                >
                  <Ionicons
                    name={voiceMode ? "volume-high" : "volume-mute"}
                    size={14}
                    color={voiceMode ? "#3b82f6" : "#a1a1aa"}
                  />
                </Pressable>
              )}
              <Pressable
                onPress={startNewChat}
                accessibilityRole="button"
                hitSlop={6}
                className="rounded-full border border-border bg-surface px-2.5 py-1 active:opacity-80"
              >
                <Text className="text-[11px] font-medium text-foreground">
                  + New
                </Text>
              </Pressable>
              <Pressable
                onPress={openHistory}
                accessibilityRole="button"
                hitSlop={6}
                className="rounded-full border border-border bg-surface px-2.5 py-1 active:opacity-80"
              >
                <Text className="text-[11px] font-medium text-foreground">
                  History
                </Text>
              </Pressable>
            </View>
          ),
        }}
      />

      <FlatList
        ref={listRef}
        className="flex-1"
        contentContainerClassName="px-4 py-3 gap-3"
        data={messages}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item, index }) => (
          <MessageBubble
            message={item}
            isLast={index === messages.length - 1}
            streaming={streaming}
          />
        )}
        ListEmptyComponent={
          <View className="rounded-lg border border-border bg-surface px-4 py-6">
            <Text className="text-center text-sm font-medium text-foreground">
              {loading ? "Loading…" : "Chat with your strength coach"}
            </Text>
            {!loading && (
              <Text className="mt-1 text-center text-xs text-muted">
                Tell them what you trained today and they&apos;ll log it.
                Ask about your last back day, your bench progress, whatever.
              </Text>
            )}
          </View>
        }
      />

      {error && (
        <View className="mx-4 mb-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
          <Text className="text-xs text-danger">{error}</Text>
        </View>
      )}

      <View className="flex-row items-end gap-2 border-t border-border bg-background px-4 py-3">
        {SPEECH_SUPPORTED && (
          // Push-to-talk mic. Pressable's onPressIn/onPressOut is the
          // native equivalent of the web's mousedown/mouseup pair —
          // hold to talk, release to commit. Permissions are
          // requested inside startListening on first hold; the
          // inline error surfaces if they're denied. Hidden entirely
          // when expo-speech-recognition isn't in the build (older
          // dev-client without the native module).
          <Pressable
            onPressIn={startListening}
            onPressOut={stopListening}
            disabled={streaming || loading || !sessionId}
            accessibilityRole="button"
            accessibilityLabel={
              listening ? "Stop voice input" : "Hold to speak"
            }
            accessibilityState={{ selected: listening }}
            className={`h-11 w-11 items-center justify-center rounded-lg border active:opacity-80 disabled:opacity-40 ${
              listening
                ? "border-danger/60 bg-danger/10"
                : "border-border bg-surface"
            }`}
          >
            <Ionicons
              name="mic"
              size={18}
              color={listening ? "#ef4444" : "#a1a1aa"}
            />
          </Pressable>
        )}
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={
            loading
              ? "Loading…"
              : listening
                ? "Listening…"
                : "Message your coach…"
          }
          placeholderTextColor="#71717a"
          multiline
          editable={!streaming && !loading && !!sessionId}
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
          // Cap the input box growth so the send button stays reachable
          // even mid-paragraph. Beyond this it scrolls inside the input.
          style={{ maxHeight: 120 }}
        />
        <Pressable
          onPress={send}
          disabled={
            streaming || loading || !sessionId || input.trim().length === 0
          }
          accessibilityRole="button"
          className="rounded-lg bg-accent px-4 py-2 active:opacity-80 disabled:opacity-40"
        >
          {streaming ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="text-sm font-medium text-accent-fg">Send</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

// --- session helpers --------------------------------------------------

/**
 * Background title generation. Asks the agent's /title for a friendly
 * 3–6 word summary, then PATCHes the API. On any failure falls back
 * to a 60-char slice of the first user message so the session always
 * ends up with a non-empty title. All failures swallowed — title-
 * generation hiccups shouldn't bother the user.
 */
async function titleAndPatch(
  token: string,
  sessionId: string,
  userText: string,
  assistantText: string,
): Promise<void> {
  let title = fallbackTitle(userText);
  try {
    const generated = await generateChatTitle(token, [
      { role: "user", content: userText },
      { role: "assistant", content: assistantText },
    ]);
    if (generated) title = generated;
  } catch {
    // swallow — fallback already in `title`
  }
  try {
    await patchChatSessionTitle(token, sessionId, title);
  } catch {
    // swallow — session is usable without a title
  }
}

function fallbackTitle(userText: string): string {
  const trimmed = userText.trim();
  if (!trimmed) return "New Chat";
  return trimmed.slice(0, 60).trim() || "New Chat";
}
/**
 * Persisted-message → UI-message converter. The API stores message
 * content as a plain string + optional model + optional tools JSON.
 * The UI's Message shape carries those same fields with the tools
 * parsed back into the ToolCall array the bubble renders.
 */
function persistedToUI(m: PersistedChatMessage): Message {
  const ui: Message = {
    role: m.role,
    content: m.content,
  };
  if (m.model) ui.model = m.model;
  if (m.tools_json) {
    try {
      const parsed = JSON.parse(m.tools_json);
      if (Array.isArray(parsed)) {
        ui.tools = parsed as ToolCall[];
      }
    } catch {
      // Bad JSON in the column is a corruption signal; render the
      // message without tools rather than dropping the whole turn.
    }
  }
  return ui;
}

function MessageBubble({
  message,
  isLast,
  streaming,
}: {
  message: Message;
  isLast: boolean;
  streaming: boolean;
}) {
  const isUser = message.role === "user";
  // Show the typing dot when this is the still-empty assistant
  // placeholder. Avoids an empty bubble before the first delta lands.
  const showTyping =
    isLast && streaming && !isUser && message.content.length === 0;

  return (
    <View
      className={`max-w-[85%] rounded-2xl px-3 py-2 ${
        isUser
          ? "self-end bg-accent"
          : "self-start border border-border bg-surface"
      }`}
    >
      {showTyping ? (
        <Text className="text-sm italic text-muted">…</Text>
      ) : message.content.length === 0 ? null : isUser ? (
        // User messages: plain Text. Users don't intentionally write
        // markdown when typing into a chat composer; rendering it as
        // such would let stray asterisks/underscores reshape what
        // they wrote.
        <Text selectable className="text-sm text-accent-fg">
          {message.content}
        </Text>
      ) : (
        // Assistant messages route through react-native-markdown-
        // display so the agent's `**bold**`, lists, code blocks,
        // links, and tables actually render. Style overrides target
        // each element type — the library uses inline styles (not
        // NativeWind classNames), so the dark-theme colors are
        // duplicated from tailwind.config.js. Keep these in sync if
        // the theme ever changes.
        <Markdown style={MARKDOWN_STYLES}>{message.content}</Markdown>
      )}

      {message.tools && message.tools.length > 0 && (
        <View className="mt-2 gap-1">
          {message.tools.map((t, i) => (
            <Text
              key={i}
              className={`text-[10px] uppercase tracking-wider ${
                t.state === "error"
                  ? "text-danger"
                  : t.state === "ok"
                    ? "text-muted"
                    : "text-muted"
              }`}
            >
              {t.state === "running" ? "Running" : t.state === "ok" ? "Done" : "Failed"}
              {" · "}
              {t.name}
            </Text>
          ))}
        </View>
      )}

      {message.model && !isUser && (
        <Text className="mt-1 text-[10px] uppercase tracking-wider text-muted">
          via {modelLabel(message.model)}
        </Text>
      )}
    </View>
  );
}

// Per-element styles for react-native-markdown-display inside the
// assistant bubble. Hex values mirror tailwind.config.js — the
// library doesn't speak NativeWind, so the dark palette has to be
// duplicated here. Pulled out of the component so it's a stable
// reference (the library re-mounts on every render if a new style
// object is passed inline).
//
// Layout-wise: tight vertical rhythm because the chat bubble has
// its own padding; first/last child margin resets keep the bubble
// edges flush with the text. Bullets and numbered list markers
// stay muted so the content reads first.
const MARKDOWN_STYLES = {
  body: {
    color: "#fafafa",
    fontSize: 14,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 6,
  },
  strong: {
    fontWeight: "600" as const,
    color: "#fafafa",
  },
  em: {
    fontStyle: "italic" as const,
  },
  // Bullet + ordered lists. The library renders markers via
  // bullet_list_icon / ordered_list_icon; we mute them so they don't
  // out-shout the text.
  bullet_list: {
    marginTop: 4,
    marginBottom: 4,
  },
  ordered_list: {
    marginTop: 4,
    marginBottom: 4,
  },
  bullet_list_icon: {
    color: "#a1a1aa",
    marginRight: 6,
  },
  ordered_list_icon: {
    color: "#a1a1aa",
    marginRight: 6,
  },
  list_item: {
    marginVertical: 1,
  },
  // Headings. Claude uses them as section labels inside a single
  // turn; cap the sizes so they don't dominate the bubble.
  heading1: {
    fontSize: 16,
    fontWeight: "600" as const,
    marginTop: 8,
    marginBottom: 4,
  },
  heading2: {
    fontSize: 14,
    fontWeight: "600" as const,
    marginTop: 6,
    marginBottom: 4,
  },
  heading3: {
    fontSize: 14,
    fontWeight: "600" as const,
    marginTop: 4,
    marginBottom: 2,
  },
  // Inline code + fenced blocks. The surface-2 hex is one step
  // brighter than the bubble's surface so code blocks read as
  // distinct cards.
  code_inline: {
    backgroundColor: "#27272a",
    color: "#fafafa",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    fontSize: 12,
    fontFamily: "Menlo",
  },
  code_block: {
    backgroundColor: "#27272a",
    color: "#fafafa",
    padding: 10,
    borderRadius: 6,
    fontSize: 12,
    fontFamily: "Menlo",
    marginVertical: 6,
  },
  fence: {
    backgroundColor: "#27272a",
    color: "#fafafa",
    padding: 10,
    borderRadius: 6,
    fontSize: 12,
    fontFamily: "Menlo",
    marginVertical: 6,
  },
  link: {
    color: "#3b82f6",
    textDecorationLine: "underline" as const,
  },
  blockquote: {
    backgroundColor: "transparent",
    borderLeftWidth: 2,
    borderLeftColor: "#27272a",
    paddingLeft: 10,
    marginVertical: 6,
  },
  // GFM tables — Claude uses these often for set/rep summaries.
  // Horizontal scroll isn't built-in; long tables will wrap text
  // inside cells, which is acceptable at single-user beta scale.
  table: {
    borderWidth: 1,
    borderColor: "#27272a",
    borderRadius: 4,
    marginVertical: 6,
  },
  thead: {
    backgroundColor: "#27272a",
  },
  th: {
    padding: 6,
    fontWeight: "600" as const,
  },
  td: {
    padding: 6,
    borderTopWidth: 1,
    borderTopColor: "#27272a",
  },
  hr: {
    backgroundColor: "#27272a",
    height: 1,
    marginVertical: 8,
  },
};

function modelLabel(id: string): string {
  // Strip the leading "claude-" so the label fits on small screens —
  // "Haiku 4.5" reads better than the full SDK ID.
  if (id.includes("haiku")) return "Haiku";
  if (id.includes("sonnet")) return "Sonnet";
  if (id.includes("opus")) return "Opus";
  return id;
}

function replaceLast<T>(arr: T[], fn: (last: T) => T): T[] {
  if (arr.length === 0) return arr;
  const next = arr.slice(0, -1);
  next.push(fn(arr[arr.length - 1]));
  return next;
}

/**
 * Decode a base64-encoded mp3 payload (as carried on the audio_chunk
 * SSE event) into a Uint8Array suitable for expo-file-system's
 * File.write(). atob is available globally in Hermes/RN 0.83+; the
 * map-from-string pattern mirrors what the web client does so the
 * two stay byte-for-byte consistent.
 */
function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
