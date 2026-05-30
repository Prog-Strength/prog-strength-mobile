// Chat screen. Mirrors prog-strength-web's /chat in shape but skips
// markdown rendering for v1 — agent responses are shown as plain text.
// Adding rich rendering later means swapping <Text>{content}</Text>
// for a Markdown component (react-native-markdown-display is the
// usual pick); the streaming + state machinery stays identical.
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
import { clearToken, getToken } from "@/lib/auth";
import { streamChat } from "@/lib/stream";
import {
  appendChatTurn,
  createChatSession,
  getChatSession,
  patchChatSessionTitle,
  type ChatMessage as PersistedChatMessage,
} from "@/lib/api";
import { generateChatTitle } from "@/lib/agent";

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

  // Active session id. Set once per mount in the bootstrap effect,
  // either from the URL (resume) or freshly minted (new session).
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Flips true once the server-side session row exists. Composer is
  // gated on it so a turn append can never 404.
  const [sessionReady, setSessionReady] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);

  // Mint or resume the session each mount + on URL change. The cancel
  // flag protects against a stale fetch landing after a rapid
  // back-to-back "+ New chat".
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      // Resets live inside the async body (not synchronously in the
      // effect) so React's rules-of-hooks lint rule against sync
      // setState in effects stays satisfied — awaits below force
      // these updates onto a microtask tick.
      setSessionReady(false);
      setMessages([]);
      setError(null);
      try {
        const token = await getToken();
        if (!token) {
          router.replace("/login");
          return;
        }
        if (urlSessionId) {
          const session = await getChatSession(token, urlSessionId);
          if (cancelled) return;
          setSessionId(session.id);
          setMessages(session.messages.map(persistedToUI));
          setSessionReady(true);
        } else {
          const id = Crypto.randomUUID();
          await createChatSession(token, id);
          if (cancelled) return;
          setSessionId(id);
          setSessionReady(true);
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes("401")) {
          await clearToken();
          router.replace("/login");
          return;
        }
        setError(msg);
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

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming || !sessionReady || !sessionId) return;

    const token = await getToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setError(null);

    // Optimistic update: append the user message and a placeholder
    // assistant we'll fill as deltas arrive. Doing both in one
    // setState avoids the flash where the user message renders alone.
    const userMsg: Message = { role: "user", content: trimmed };
    const placeholder: Message = { role: "assistant", content: "", tools: [] };
    const nextMessages = [...messages, userMsg];
    setMessages([...nextMessages, placeholder]);
    setInput("");
    setStreaming(true);

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
  }, [input, messages, router, sessionId, sessionReady, streaming]);

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
              {sessionReady
                ? "Chat with your strength coach"
                : "Starting session…"}
            </Text>
            {sessionReady && (
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
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={sessionReady ? "Message your coach…" : "Starting session…"}
          placeholderTextColor="#71717a"
          multiline
          editable={!streaming && sessionReady}
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
          // Cap the input box growth so the send button stays reachable
          // even mid-paragraph. Beyond this it scrolls inside the input.
          style={{ maxHeight: 120 }}
        />
        <Pressable
          onPress={send}
          disabled={streaming || !sessionReady || input.trim().length === 0}
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
      ) : message.content.length > 0 ? (
        <Text
          selectable
          className={`text-sm ${isUser ? "text-accent-fg" : "text-foreground"}`}
        >
          {message.content}
        </Text>
      ) : null}

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
