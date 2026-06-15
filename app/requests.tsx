// Follow requests — `/requests`. Reached from the Settings "Follow
// requests" row; lives outside (tabs) so it presents full-screen with a
// back affordance. Parity with web app/(app)/requests/page.tsx.
//
// Two tabs (a <SegmentedControl>):
//   - Incoming: others asking to follow the viewer — Accept / Reject per row.
//   - Outgoing: the viewer's own still-pending requests — Cancel per row.
//
// Both actions are OPTIMISTIC: the row is removed from the list
// immediately, then the API call fires; on failure the row is restored and
// an Alert is shown. A 401 from any call clears the token and bounces to
// /login. Switching tabs re-fetches that direction's page.
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { clearToken, getToken } from "@/lib/auth";
import {
  acceptFollow,
  cancelOrUnfollow,
  listFollowRequests,
  rejectFollow,
  type FollowRequest,
} from "@/lib/api";
import { ProfileRow } from "@/components/social/profile-row";
import { SegmentedControl } from "@/components/segmented-control";

type Direction = "incoming" | "outgoing";

const HEADER_OPTIONS = {
  title: "Follow requests",
  headerShown: true,
  headerStyle: { backgroundColor: "#0a0a0b" },
  headerTitleStyle: { color: "#fafafa" },
  headerTintColor: "#fafafa",
  headerShadowVisible: false,
} as const;

export default function RequestsScreen() {
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const [direction, setDirection] = useState<Direction>("incoming");
  const [requests, setRequests] = useState<FollowRequest[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<Set<string>>(new Set());

  const handleAuthError = useCallback(async (err: unknown): Promise<boolean> => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("401")) {
      await clearToken();
      routerRef.current.replace("/login");
      return true;
    }
    return false;
  }, []);

  // (Re)load the current direction's first page whenever the tab changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const token = await getToken();
      if (!token || cancelled) return;
      try {
        const page = await listFollowRequests(token, direction);
        if (cancelled) return;
        setRequests(page.requests);
        setCursor(page.next_cursor);
        setError(null);
      } catch (err: unknown) {
        if (cancelled) return;
        if (await handleAuthError(err)) return;
        setError(err instanceof Error ? err.message : "Could not load requests");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [direction, handleAuthError]);

  const loadMore = async () => {
    const token = await getToken();
    if (!token || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listFollowRequests(token, direction, cursor);
      setRequests((prev) => [...prev, ...page.requests]);
      setCursor(page.next_cursor);
    } catch (err: unknown) {
      if (!(await handleAuthError(err))) {
        setError(err instanceof Error ? err.message : "Could not load more requests");
      }
    } finally {
      setLoadingMore(false);
    }
  };

  // Optimistically drop the row, fire `op`, restore on failure.
  const act = async (
    req: FollowRequest,
    op: (token: string) => Promise<unknown>,
    failMsg: string,
  ) => {
    if (acting.has(req.user_id)) return;
    const token = await getToken();
    if (!token) return;
    setActing((s) => new Set(s).add(req.user_id));
    const snapshot = requests;
    setRequests((prev) => prev.filter((r) => r.user_id !== req.user_id));
    try {
      await op(token);
    } catch (err: unknown) {
      setRequests(snapshot);
      if (!(await handleAuthError(err))) {
        Alert.alert("Requests", err instanceof Error ? err.message : failMsg);
      }
    } finally {
      setActing((s) => {
        const next = new Set(s);
        next.delete(req.user_id);
        return next;
      });
    }
  };

  const rowAction = (req: FollowRequest) => {
    // Requests are addressed by the other party's handle. A handle-less
    // party can't be acted on by username; render a muted note instead.
    const handle = req.username;
    const busy = acting.has(req.user_id);
    if (!handle) {
      return <Text className="text-xs text-muted">—</Text>;
    }
    if (direction === "incoming") {
      return (
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => act(req, (t) => acceptFollow(t, handle), "Could not accept")}
            disabled={busy}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Accept request"
            className={`min-h-11 items-center justify-center rounded-full bg-accent px-3 py-1 active:opacity-80 ${
              busy ? "opacity-50" : ""
            }`}
          >
            <Text className="text-xs font-medium text-accent-fg">Accept</Text>
          </Pressable>
          <Pressable
            onPress={() => act(req, (t) => rejectFollow(t, handle), "Could not reject")}
            disabled={busy}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Reject request"
            className={`min-h-11 items-center justify-center rounded-full border border-border bg-surface px-3 py-1 active:opacity-80 ${
              busy ? "opacity-50" : ""
            }`}
          >
            <Text className="text-xs font-medium text-muted">Reject</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <Pressable
        onPress={() => act(req, (t) => cancelOrUnfollow(t, handle), "Could not cancel")}
        disabled={busy}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Cancel request"
        className={`min-h-11 items-center justify-center rounded-full border border-border bg-surface px-3 py-1 active:opacity-80 ${
          busy ? "opacity-50" : ""
        }`}
      >
        <Text className="text-xs font-medium text-muted">Cancel</Text>
      </Pressable>
    );
  };

  const emptyMessage = direction === "incoming" ? "No pending requests." : "No outgoing requests.";

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 px-4 py-4 pb-12">
      <Stack.Screen options={HEADER_OPTIONS} />

      <SegmentedControl<Direction>
        value={direction}
        onChange={setDirection}
        ariaLabel="Request direction"
        segments={[
          { value: "incoming", label: "Incoming" },
          { value: "outgoing", label: "Outgoing" },
        ]}
      />

      {loading ? (
        <View className="items-center py-8">
          <ActivityIndicator color="#fafafa" />
        </View>
      ) : error ? (
        <View className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-6">
          <Text className="text-center text-sm text-danger">{error}</Text>
        </View>
      ) : requests.length === 0 ? (
        <View className="rounded-lg border border-border bg-surface px-4 py-10">
          <Text className="text-center text-sm text-muted">{emptyMessage}</Text>
        </View>
      ) : (
        <View className="gap-3">
          {requests.map((req) => (
            <ProfileRow key={req.user_id} user={req} action={rowAction(req)} />
          ))}

          {cursor ? (
            <Pressable
              onPress={loadMore}
              disabled={loadingMore}
              accessibilityRole="button"
              accessibilityLabel="Load more requests"
              className="mt-1 min-h-11 items-center justify-center self-center rounded-full border border-border bg-surface px-4 py-2 active:opacity-80 disabled:opacity-50"
            >
              <Text className="text-xs text-muted">{loadingMore ? "Loading…" : "Load more"}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}
