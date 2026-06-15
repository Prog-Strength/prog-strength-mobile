// A paginated, cursored list of profile rows — the shared body behind the
// followers and following list screens (and reusable anywhere a
// `ProfilePage` feed needs rendering). Twin of prog-strength-web
// components/social/ProfileListView.tsx.
//
// The caller supplies a `fetchPage(cursor?)` thunk; this owns loading /
// empty / error states, "Load more" via `next_cursor`, and the
// 401-clears-token-and-bounces posture.
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { clearToken } from "@/lib/auth";
import type { ProfilePage, ProfileSummary } from "@/lib/api";
import { ProfileRow } from "./profile-row";

export function ProfileListView({
  fetchPage,
  emptyMessage,
}: {
  fetchPage: (cursor?: string) => Promise<ProfilePage>;
  emptyMessage: string;
}) {
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  // fetchPage is typically a fresh closure each render; pin it so the mount
  // effect doesn't re-run (and double-fetch) on every parent re-render.
  const fetchPageRef = useRef(fetchPage);
  useEffect(() => {
    fetchPageRef.current = fetchPage;
  }, [fetchPage]);

  const [users, setUsers] = useState<ProfileSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
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
    fetchPageRef
      .current()
      .then((page) => {
        if (cancelled) return;
        setUsers(page.users);
        setCursor(page.next_cursor);
        setError(null);
      })
      .catch(async (err: unknown) => {
        if (cancelled) return;
        if (await handleAuthError(err)) return;
        setError(err instanceof Error ? err.message : "Could not load list");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [handleAuthError]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPageRef.current(cursor);
      setUsers((prev) => [...prev, ...page.users]);
      setCursor(page.next_cursor);
    } catch (err: unknown) {
      if (!(await handleAuthError(err))) {
        setError(err instanceof Error ? err.message : "Could not load more");
      }
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) {
    return (
      <View className="items-center py-10">
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

  if (users.length === 0) {
    return (
      <View className="rounded-lg border border-border bg-surface px-4 py-10">
        <Text className="text-center text-sm text-muted">{emptyMessage}</Text>
      </View>
    );
  }

  return (
    <View className="gap-3">
      {users.map((u) => (
        <ProfileRow key={u.user_id} user={u} />
      ))}

      {cursor ? (
        <Pressable
          onPress={loadMore}
          disabled={loadingMore}
          accessibilityRole="button"
          accessibilityLabel="Load more"
          className="mt-1 min-h-11 items-center justify-center self-center rounded-full border border-border bg-surface px-4 py-2 active:opacity-80 disabled:opacity-50"
        >
          <Text className="text-xs text-muted">{loadingMore ? "Loading…" : "Load more"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
