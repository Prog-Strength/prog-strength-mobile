// Chat history screen. Sister surface to the chat index: same data
// domain (persistent chat sessions on the API), presented as a
// scannable list rather than a single active conversation. Tapping
// a row navigates to /chat?session=<id> which the index resumes
// from. ✕ button on each row deletes (soft-delete server-side) with
// a confirm.
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { clearToken, getToken } from "@/lib/auth";
import {
  deleteChatSession,
  listChatSessions,
  type ChatSessionListItem,
} from "@/lib/api";

export default function ChatHistoryScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<ChatSessionListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setError(null);
    Promise.resolve(getToken())
      .then(async (t) => {
        if (!t) {
          router.replace("/login");
          return;
        }
        const list = await listChatSessions(t);
        setSessions(list);
      })
      .catch((err: Error) => {
        if (err.message.toLowerCase().includes("401")) {
          clearToken();
          router.replace("/login");
          return;
        }
        setError(err.message);
      });
  }, [router]);

  // Refetch every time the screen focuses — covers the case where a
  // newly minted session in the chat index gains its title via the
  // background PATCH while the user is sitting on the history list.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const handleDelete = (session: ChatSessionListItem) => {
    const label = session.title.trim() || "this chat";
    Alert.alert(
      "Delete chat?",
      `"${label}" will be removed from your history.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const token = await getToken();
            if (!token) {
              router.replace("/login");
              return;
            }
            // Optimistic remove. Snapshot the previous list so a
            // failed delete can restore the row without refetching
            // and losing the user's scroll position.
            const previous = sessions ?? [];
            setSessions(previous.filter((s) => s.id !== session.id));
            try {
              await deleteChatSession(token, session.id);
            } catch (e) {
              setSessions(previous);
              setError(e instanceof Error ? e.message : "Delete failed");
            }
          },
        },
      ],
    );
  };

  if (sessions === null && !error) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#fafafa" />
      </View>
    );
  }

  return (
    <FlatList
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-3 gap-2"
      data={sessions ?? []}
      keyExtractor={(s) => s.id}
      ListHeaderComponent={
        error ? (
          <View className="mb-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
            <Text className="text-xs text-danger">{error}</Text>
          </View>
        ) : null
      }
      ListEmptyComponent={
        !error ? (
          <View className="rounded-lg border border-border bg-surface px-4 py-6">
            <Text className="text-center text-sm font-medium text-foreground">
              No past chats yet
            </Text>
            <Text className="mt-1 text-center text-xs text-muted">
              Start a conversation and it&apos;ll appear here.
            </Text>
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <SessionRow
          session={item}
          onPress={() =>
            router.push({
              pathname: "/chat",
              params: { session: item.id },
            })
          }
          onDelete={() => handleDelete(item)}
        />
      )}
    />
  );
}

function SessionRow({
  session,
  onPress,
  onDelete,
}: {
  session: ChatSessionListItem;
  onPress: () => void;
  onDelete: () => void;
}) {
  const title = session.title.trim() || "New chat";
  return (
    <View className="flex-row items-stretch overflow-hidden rounded-lg border border-border bg-surface">
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        className="flex-1 px-4 py-3 active:opacity-80"
      >
        <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
          {title}
        </Text>
        <Text className="mt-0.5 text-xs text-muted" numberOfLines={1}>
          {session.message_count}{" "}
          {session.message_count === 1 ? "message" : "messages"} ·{" "}
          {formatRelative(session.last_message_at)}
        </Text>
      </Pressable>
      <Pressable
        onPress={onDelete}
        accessibilityRole="button"
        accessibilityLabel="Delete chat session"
        hitSlop={6}
        className="items-center justify-center border-l border-border px-4 active:opacity-80"
      >
        <Text className="text-base text-muted">✕</Text>
      </Pressable>
    </View>
  );
}

/**
 * "just now" / "5 minutes ago" / "2 days ago" / "May 30, 2026" — same
 * shape the web history page uses so the relative copy stays
 * consistent across platforms.
 */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const now = Date.now();
  const diffSec = Math.max(0, Math.round((now - then) / 1000));
  if (diffSec < 60) return "just now";
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min} ${min === 1 ? "minute" : "minutes"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} ${hr === 1 ? "hour" : "hours"} ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} ${day === 1 ? "day" : "days"} ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
