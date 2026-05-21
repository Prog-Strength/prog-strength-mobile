// Workout detail screen. Read-only for v1 — we don't yet support
// editing or deleting from mobile. Shows the date, optional name and
// notes, then every exercise's sets in order. PR badges call out any
// records the workout produced.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { clearToken, getToken } from "@/lib/auth";
import {
  getWorkout,
  listExercises,
  type Exercise,
  type Workout,
} from "@/lib/api";

export default function WorkoutDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [exerciseByID, setExerciseByID] = useState<Map<string, Exercise>>(
    new Map(),
  );
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        router.replace("/login");
        return;
      }
      const [w, catalog] = await Promise.all([
        getWorkout(token, id),
        listExercises(),
      ]);
      setWorkout(w);
      setExerciseByID(new Map(catalog.map((e) => [e.id, e])));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("401")) {
        await clearToken();
        router.replace("/login");
        return;
      }
      setError(msg);
    }
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  if (!workout && !error) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#fafafa" />
      </View>
    );
  }
  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-center text-sm text-danger">{error}</Text>
      </View>
    );
  }
  if (!workout) {
    // Defensive — TypeScript needs this branch even though it should
    // be covered by the error/loading checks above.
    return null;
  }

  const title =
    workout.name && workout.name.trim().length > 0
      ? workout.name
      : "Workout";

  return (
    <>
      <Stack.Screen options={{ title }} />
      <ScrollView className="flex-1 bg-background">
        <View className="gap-4 px-4 py-4">
          <View className="rounded-lg border border-border bg-surface px-4 py-3">
            <Text className="text-xs uppercase tracking-wider text-muted">
              Performed
            </Text>
            <Text className="mt-1 text-base font-medium text-foreground">
              {formatDateTime(workout.performed_at)}
            </Text>
            {workout.notes && workout.notes.trim().length > 0 && (
              <>
                <Text className="mt-3 text-xs uppercase tracking-wider text-muted">
                  Notes
                </Text>
                <Text className="mt-1 text-sm text-foreground">
                  {workout.notes}
                </Text>
              </>
            )}
            {workout.personal_records_set.length > 0 && (
              <View className="mt-3 flex-row flex-wrap gap-2">
                {workout.personal_records_set.map((pr) => {
                  const name =
                    exerciseByID.get(pr.exercise_id)?.name ?? pr.exercise_id;
                  return (
                    <View
                      key={pr.id}
                      className="rounded-full border border-accent/40 bg-accent/15 px-3 py-1"
                    >
                      <Text className="text-xs text-foreground">
                        New PR · {name} · {formatNumber(pr.weight)} {pr.unit}{" "}
                        × {pr.reps}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {workout.exercises.map((we, idx) => {
            const name =
              exerciseByID.get(we.exercise_id)?.name ?? we.exercise_id;
            return (
              <View
                key={`${we.exercise_id}:${idx}`}
                className="rounded-lg border border-border bg-surface px-4 py-3"
              >
                <View className="flex-row items-baseline justify-between gap-3">
                  <Text className="flex-1 text-base font-medium text-foreground">
                    {name}
                  </Text>
                  <Text className="text-xs text-muted">
                    {we.sets.length}{" "}
                    {we.sets.length === 1 ? "set" : "sets"}
                  </Text>
                </View>
                {we.notes && we.notes.trim().length > 0 && (
                  <Text className="mt-1 text-xs text-muted">{we.notes}</Text>
                )}
                <View className="mt-2 gap-1">
                  {we.sets.map((s, setIdx) => (
                    <View
                      key={setIdx}
                      className="flex-row items-baseline justify-between gap-3"
                    >
                      <Text className="text-xs text-muted">
                        Set {setIdx + 1}
                      </Text>
                      <Text className="text-sm tabular-nums text-foreground">
                        {s.reps} × {formatNumber(s.weight)} {s.unit}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </>
  );
}

function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}
