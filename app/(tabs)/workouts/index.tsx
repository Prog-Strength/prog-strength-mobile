// Workouts list. Mirrors prog-strength-web's /workouts page in v1
// shape: a flat list of sessions, most recent first, each row tapping
// through to /workouts/[id] for the full detail.
//
// We fetch the exercise catalog alongside the page of workouts so the
// row component can show "Bench Press × 3, Squat × 5" instead of slug
// IDs. The catalog is small and admin-curated so we don't bother
// paginating it.
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { clearToken, getToken } from "@/lib/auth";
import { listWorkouts, type Workout } from "@/lib/api";
import { WorkoutRow } from "@/components/workout-row";
import { useExerciseCatalog } from "@/components/exercise-catalog-context";

export default function WorkoutsListScreen() {
  const router = useRouter();
  const { byID: exerciseByID } = useExerciseCatalog();
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (opts: { refreshing?: boolean } = {}) => {
      if (opts.refreshing) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) {
          router.replace("/login");
          return;
        }
        const page = await listWorkouts(token, { limit: 50 });
        setWorkouts(page.items);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // The API returns 401 when the JWT is expired or revoked. Wipe
        // the token and bounce so the user can re-OAuth.
        if (msg.toLowerCase().includes("401")) {
          await clearToken();
          router.replace("/login");
          return;
        }
        setError(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router],
  );

  // useFocusEffect fires on first focus too, so it covers the initial
  // load *and* refetch-on-tab-return. A separate useEffect would
  // double-fire on mount.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading && workouts.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#fafafa" />
      </View>
    );
  }

  return (
    <FlatList
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-3 gap-3"
      data={workouts}
      keyExtractor={(w) => w.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load({ refreshing: true })}
          tintColor="#fafafa"
        />
      }
      ListEmptyComponent={
        error ? (
          <View className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2">
            <Text className="text-sm text-danger">{error}</Text>
          </View>
        ) : (
          <View className="rounded-lg border border-border bg-surface px-4 py-6">
            <Text className="text-center text-sm font-medium text-foreground">
              No workouts yet
            </Text>
            <Text className="mt-1 text-center text-xs text-muted">
              Head to the Chat tab and tell the coach what you trained —
              they&apos;ll log it for you.
            </Text>
          </View>
        )
      }
      renderItem={({ item }) => (
        <WorkoutRow
          workout={item}
          exerciseByID={exerciseByID}
          onPress={() => router.push(`/workouts/${item.id}`)}
        />
      )}
    />
  );
}
