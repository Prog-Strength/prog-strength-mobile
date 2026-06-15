// People search — `/search`. Reached from the Settings "Find people" row;
// lives outside (tabs) so it presents full-screen with a back affordance.
// Parity with web app/(app)/search/page.tsx.
//
// A debounced query input over `searchProfiles`, rendering the
// server-ranked result rows (each an inline-follow <ProfileRow>) with a
// cursored "Load more". An empty query clears results rather than
// searching. Each in-flight search is tagged with a monotonic id so a slow
// earlier response can't overwrite a newer query's results.
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { clearToken, getToken } from "@/lib/auth";
import { searchProfiles, type ProfileSummary } from "@/lib/api";
import { ProfileRow } from "@/components/social/profile-row";

const DEBOUNCE_MS = 300;

const HEADER_OPTIONS = {
  title: "Find people",
  headerShown: true,
  headerStyle: { backgroundColor: "#0a0a0b" },
  headerTitleStyle: { color: "#fafafa" },
  headerTintColor: "#fafafa",
  headerShadowVisible: false,
} as const;

export default function SearchScreen() {
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProfileSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  // Monotonic search token: only the latest search may commit its results.
  const searchSeq = useRef(0);

  const handleAuthError = useCallback(async (err: unknown): Promise<boolean> => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("401")) {
      await clearToken();
      routerRef.current.replace("/login");
      return true;
    }
    return false;
  }, []);

  // Debounce the query → run a fresh first-page search. A blank query resets.
  useEffect(() => {
    const q = query.trim();
    const seq = ++searchSeq.current;
    if (!q) {
      setResults([]);
      setCursor(null);
      setError(null);
      setSearched(false);
      setLoading(false);
      return;
    }
    const handle = setTimeout(() => {
      (async () => {
        const token = await getToken();
        if (!token) return;
        setLoading(true);
        try {
          const page = await searchProfiles(token, q);
          if (seq !== searchSeq.current) return;
          setResults(page.users);
          setCursor(page.next_cursor);
          setError(null);
          setSearched(true);
        } catch (err: unknown) {
          if (seq !== searchSeq.current) return;
          if (await handleAuthError(err)) return;
          setError(err instanceof Error ? err.message : "Search failed");
        } finally {
          if (seq === searchSeq.current) setLoading(false);
        }
      })();
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, handleAuthError]);

  const loadMore = async () => {
    const token = await getToken();
    const q = query.trim();
    if (!token || !q || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await searchProfiles(token, q, cursor);
      setResults((prev) => [...prev, ...page.users]);
      setCursor(page.next_cursor);
    } catch (err: unknown) {
      if (!(await handleAuthError(err))) {
        setError(err instanceof Error ? err.message : "Could not load more results");
      }
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 px-4 py-4 pb-12"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={HEADER_OPTIONS} />

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search people by name or @handle"
        placeholderTextColor="#a1a1aa"
        accessibilityLabel="Search people"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        className="min-h-11 rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
      />

      {error ? (
        <View className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-6">
          <Text className="text-center text-sm text-danger">{error}</Text>
        </View>
      ) : null}

      {!error && loading ? (
        <View className="items-center py-8">
          <ActivityIndicator color="#fafafa" />
        </View>
      ) : null}

      {!error && !loading && searched && results.length === 0 ? (
        <View className="rounded-lg border border-border bg-surface px-4 py-10">
          <Text className="text-center text-sm text-muted">No people found.</Text>
        </View>
      ) : null}

      {!error && results.length > 0 ? (
        <View className="gap-3">
          {results.map((u) => (
            <ProfileRow key={u.user_id} user={u} />
          ))}

          {cursor ? (
            <Pressable
              onPress={loadMore}
              disabled={loadingMore}
              accessibilityRole="button"
              accessibilityLabel="Load more results"
              className="mt-1 min-h-11 items-center justify-center self-center rounded-full border border-border bg-surface px-4 py-2 active:opacity-80 disabled:opacity-50"
            >
              <Text className="text-xs text-muted">{loadingMore ? "Loading…" : "Load more"}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
