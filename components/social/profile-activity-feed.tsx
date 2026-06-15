// The activities tab on a public profile: the viewer-scoped feed for
// `username`, rendered as READ-ONLY cards. Behavior mirrors
// prog-strength-web app/(app)/u/[username]/_components/ProfileActivityFeed.tsx,
// minus reactions/comments — mobile does not port those this phase (the
// gated tab only needs read-only cards).
//
// Three terminal states beyond the list:
//   - locked  → the API returned `locked: true` (the viewer isn't an accepted
//               follower of a private user); render the gated message.
//   - empty   → authorized but no posts yet; render "No activity yet."
//   - error   → a non-401 failure; 401 clears the token and bounces to /login.
//
// Pagination appends each page and drives "Load more" off `next_before`.
//
// Each card deep-links to the source detail screen when a mobile route
// exists for its `source_type` (workout / run); pr and best_effort have no
// mobile detail screen yet, so those cards are non-interactive.
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { clearToken, getToken } from "@/lib/auth";
import { listUserTimeline, type TimelinePost, type TimelineSourceType } from "@/lib/api";

const SOURCE_ICON: Record<TimelineSourceType, keyof typeof Ionicons.glyphMap> = {
  workout: "barbell-outline",
  run: "trending-up-outline",
  pr: "trophy-outline",
  best_effort: "flash-outline",
};

// Map a post to its mobile detail route, or null when no mobile screen
// exists for that source type (web's content.href targets web routes).
function mobileHref(post: TimelinePost): string | null {
  if (post.source_type === "workout") return `/activities/workout/${post.source_id}`;
  if (post.source_type === "run") return `/activities/run/${post.source_id}`;
  return null;
}

export function ProfileActivityFeed({ username }: { username: string }) {
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const [posts, setPosts] = useState<TimelinePost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAuthError = useCallback(async (err: unknown): Promise<boolean> => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("401")) {
      await clearToken();
      routerRef.current.replace("/login");
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getToken();
      if (!token || cancelled) return;
      try {
        const page = await listUserTimeline(token, username);
        if (cancelled) return;
        setLocked(Boolean(page.locked));
        setPosts(page.posts);
        setCursor(page.next_before);
        setError(null);
      } catch (err: unknown) {
        if (cancelled) return;
        if (await handleAuthError(err)) return;
        setError(err instanceof Error ? err.message : "Could not load activity");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, handleAuthError]);

  const loadMore = async () => {
    const token = await getToken();
    if (!token || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listUserTimeline(token, username, cursor);
      setPosts((prev) => [...prev, ...page.posts]);
      setCursor(page.next_before);
    } catch (err: unknown) {
      if (!(await handleAuthError(err))) {
        setError(err instanceof Error ? err.message : "Could not load more activity");
      }
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) {
    return (
      <View className="items-center py-8">
        <ActivityIndicator color="#fafafa" />
      </View>
    );
  }

  if (error) {
    return (
      <View className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-6">
        <Text className="text-center text-sm text-danger">{error}</Text>
      </View>
    );
  }

  if (locked) {
    return (
      <View className="rounded-lg border border-border bg-surface px-4 py-10">
        <Text className="text-center text-sm text-muted">
          This user&apos;s activity is visible to accepted followers.
        </Text>
      </View>
    );
  }

  if (posts.length === 0) {
    return (
      <View className="rounded-lg border border-border bg-surface px-4 py-10">
        <Text className="text-center text-sm text-muted">No activity yet.</Text>
      </View>
    );
  }

  return (
    <View className="gap-3">
      {posts.map((post) => (
        <ActivityCard key={post.id} post={post} />
      ))}

      {cursor ? (
        <Pressable
          onPress={loadMore}
          disabled={loadingMore}
          accessibilityRole="button"
          accessibilityLabel="Load more activity"
          className="mt-1 min-h-11 items-center justify-center self-center rounded-full border border-border bg-surface px-4 py-2 active:opacity-80 disabled:opacity-50"
        >
          <Text className="text-xs text-muted">{loadingMore ? "Loading…" : "Load more"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ActivityCard({ post }: { post: TimelinePost }) {
  const router = useRouter();
  const href = mobileHref(post);
  const icon = SOURCE_ICON[post.source_type] ?? "ellipse-outline";

  const body = (
    <>
      <View className="flex-row items-center gap-2">
        <Ionicons name={icon} size={16} color="#a1a1aa" />
        <Text className="flex-1 text-sm font-semibold text-foreground" numberOfLines={1}>
          {post.content.title}
        </Text>
      </View>
      {post.content.subtitle ? (
        <Text className="text-xs text-muted" numberOfLines={2}>
          {post.content.subtitle}
        </Text>
      ) : null}
      {post.content.metrics.length > 0 ? (
        <View className="flex-row flex-wrap gap-2">
          {post.content.metrics.map((m, i) => (
            <View key={i} className="rounded-full border border-border bg-background px-2 py-0.5">
              <Text className="text-[11px] tabular-nums text-muted">{m}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </>
  );

  if (href) {
    return (
      <Pressable
        onPress={() => router.push(href)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${post.content.title}`}
        className="gap-2 rounded-lg border border-border bg-surface px-4 py-3 active:opacity-80"
      >
        {body}
      </Pressable>
    );
  }
  return <View className="gap-2 rounded-lg border border-border bg-surface px-4 py-3">{body}</View>;
}
