// Chat screen. Mirrors prog-strength-web's /chat in shape but skips
// markdown rendering for v1 — agent responses are shown as plain text.
// Adding rich rendering later means swapping <Text>{content}</Text>
// for a Markdown component (react-native-markdown-display is the
// usual pick); the streaming + state machinery stays identical.
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
import { useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import { clearToken, getToken } from "@/lib/auth";
import { streamChat } from "@/lib/stream";

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Session ID groups every turn from this mount into one
  // conversation in the agent's telemetry. Generated once via the
  // useState lazy initializer; resets on app cold-start, which is
  // the "new conversation" boundary for now.
  const [sessionId] = useState(() => Crypto.randomUUID());
  const listRef = useRef<FlatList<Message>>(null);

  // Auto-scroll on every message-list change. FlatList renders newest
  // last; scrolling to end after each update keeps the freshest text
  // visible above the keyboard.
  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;

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

    try {
      let assistantText = "";
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
          setMessages((prev) =>
            replaceLast(prev, (last) => ({
              ...last,
              tools: [...(last.tools ?? []), { name: ev.name, state: "running" }],
            })),
          );
        } else if (ev.type === "tool_result") {
          setMessages((prev) =>
            replaceLast(prev, (last) => {
              const tools = (last.tools ?? []).slice();
              // Mark the last running tool with this name as ok/error.
              for (let i = tools.length - 1; i >= 0; i--) {
                if (tools[i].name === ev.name && tools[i].state === "running") {
                  tools[i] = { ...tools[i], state: ev.is_error ? "error" : "ok" };
                  break;
                }
              }
              return { ...last, tools };
            }),
          );
        } else if (ev.type === "model_chosen") {
          setMessages((prev) =>
            replaceLast(prev, (last) => ({ ...last, model: ev.model })),
          );
        } else if (ev.type === "error") {
          setError(ev.message);
        }
        // "done" is informational — the stream ends naturally.
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
  }, [input, messages, router, sessionId, streaming]);

  return (
    <KeyboardAvoidingView
      // iOS: shift the whole layout up by the keyboard height. Android
      // handles it via windowSoftInputMode in the native manifest.
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-background"
    >
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
              Chat with your strength coach
            </Text>
            <Text className="mt-1 text-center text-xs text-muted">
              Tell them what you trained today and they&apos;ll log it.
              Ask about your last back day, your bench progress, whatever.
            </Text>
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
          placeholder="Message your coach…"
          placeholderTextColor="#71717a"
          multiline
          editable={!streaming}
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"
          // Cap the input box growth so the send button stays reachable
          // even mid-paragraph. Beyond this it scrolls inside the input.
          style={{ maxHeight: 120 }}
        />
        <Pressable
          onPress={send}
          disabled={streaming || input.trim().length === 0}
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
