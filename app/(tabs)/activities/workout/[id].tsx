// Workout detail screen. Read-only for v1 — we don't yet support
// editing or deleting from mobile. Shows the date, optional name and
// notes, then every exercise's sets in order. Adjacent exercises that
// share a superset_group are collapsed into one card so the visual
// matches the way they were trained (alternating sets within the
// group). PR badges call out any records the workout produced.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { clearToken, getToken } from "@/lib/auth";
import { getWorkout, type Exercise, type Workout, type WorkoutExercise } from "@/lib/api";
import { useExerciseCatalog } from "@/components/exercise-catalog-context";
import { useProfile } from "@/lib/profile-context";
import { formatWeight } from "@/lib/units";

export default function WorkoutDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { byID: exerciseByID } = useExerciseCatalog();
  const { profile } = useProfile();
  const preferred = profile?.weight_unit;
  const [workout, setWorkout] = useState<Workout | null>(null);
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
      const w = await getWorkout(token, id);
      setWorkout(w);
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

  // Compute superset chunks unconditionally so the hook order is
  // stable across renders — the early returns below would otherwise
  // skip this hook when `workout` is null.
  const chunks = useMemo(() => groupBySuperset(workout?.exercises ?? []), [workout?.exercises]);

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

  const title = workout.name && workout.name.trim().length > 0 ? workout.name : "Workout";

  return (
    <>
      <Stack.Screen options={{ title }} />
      <ScrollView className="flex-1 bg-background">
        <View className="gap-4 px-4 py-4">
          <View className="rounded-lg border border-border bg-surface px-4 py-3">
            <Text className="text-xs uppercase tracking-wider text-muted">Performed</Text>
            <Text className="mt-1 text-base font-medium text-foreground">
              {formatDateTime(workout.performed_at)}
            </Text>
            {workout.notes && workout.notes.trim().length > 0 && (
              <>
                <Text className="mt-3 text-xs uppercase tracking-wider text-muted">Notes</Text>
                <Text className="mt-1 text-sm text-foreground">{workout.notes}</Text>
              </>
            )}
            {workout.personal_records_set.length > 0 && (
              <View className="mt-3 flex-row flex-wrap gap-2">
                {workout.personal_records_set.map((pr) => {
                  const name = exerciseByID.get(pr.exercise_id)?.name ?? pr.exercise_id;
                  return (
                    <View
                      key={pr.id}
                      className="rounded-full border border-accent/40 bg-accent/15 px-3 py-1"
                    >
                      <Text className="text-xs text-foreground">
                        New PR · {name} · {formatWeight(pr.weight, pr.unit, preferred ?? pr.unit)} ×{" "}
                        {pr.reps}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {chunks.map((chunk, idx) =>
            chunk.type === "single" ? (
              <ExerciseCard
                key={`s:${chunk.we.exercise_id}:${idx}`}
                we={chunk.we}
                name={exerciseByID.get(chunk.we.exercise_id)?.name ?? chunk.we.exercise_id}
                preferred={preferred}
                onOpenCatalog={() => router.push("/exercises")}
              />
            ) : (
              <SupersetCard
                key={`ss:${chunk.group}:${idx}`}
                chunk={chunk}
                exerciseByID={exerciseByID}
                preferred={preferred}
                onOpenCatalog={() => router.push("/exercises")}
              />
            ),
          )}
        </View>
      </ScrollView>
    </>
  );
}

// --- exercise / superset cards ------------------------------------

type ExerciseChunk =
  | { type: "single"; we: WorkoutExercise }
  | { type: "superset"; group: number; exercises: WorkoutExercise[] };

// Walks the workout's exercises in author-order, collapsing
// contiguous runs that share a non-null superset_group into a single
// "superset" chunk. Non-grouped exercises pass through as "single"
// chunks. Two non-contiguous runs with the same group value would
// render as two separate superset cards — that's intentional, the
// stored exercise_order is the source of truth and reordering would
// be a worse failure mode than rendering duplicates.
function groupBySuperset(exercises: WorkoutExercise[]): ExerciseChunk[] {
  const chunks: ExerciseChunk[] = [];
  for (const we of exercises) {
    const sg = we.superset_group;
    if (sg == null) {
      chunks.push({ type: "single", we });
      continue;
    }
    const prev = chunks[chunks.length - 1];
    if (prev && prev.type === "superset" && prev.group === sg) {
      prev.exercises.push(we);
    } else {
      chunks.push({ type: "superset", group: sg, exercises: [we] });
    }
  }
  return chunks;
}

function ExerciseCard({
  we,
  name,
  preferred,
  onOpenCatalog,
}: {
  we: WorkoutExercise;
  name: string;
  preferred: "lb" | "kg" | undefined;
  onOpenCatalog: () => void;
}) {
  return (
    <View className="rounded-lg border border-border bg-surface px-4 py-3">
      <View className="flex-row items-baseline justify-between gap-3">
        <Pressable
          className="min-h-11 flex-1 justify-center active:opacity-70"
          onPress={onOpenCatalog}
          accessibilityRole="link"
          accessibilityLabel={`${name} — open exercise catalog`}
          hitSlop={6}
        >
          <Text className="text-base font-medium text-foreground">{name}</Text>
        </Pressable>
        <Text className="text-xs text-muted">
          {we.sets.length} {we.sets.length === 1 ? "set" : "sets"}
        </Text>
      </View>
      {we.notes && we.notes.trim().length > 0 && (
        <Text className="mt-1 text-xs text-muted">{we.notes}</Text>
      )}
      <SetList sets={we.sets} preferred={preferred} />
    </View>
  );
}

function SupersetCard({
  chunk,
  exerciseByID,
  preferred,
  onOpenCatalog,
}: {
  chunk: { type: "superset"; group: number; exercises: WorkoutExercise[] };
  exerciseByID: Map<string, Exercise>;
  preferred: "lb" | "kg" | undefined;
  onOpenCatalog: () => void;
}) {
  const totalSets = chunk.exercises.reduce((n, we) => n + we.sets.length, 0);
  return (
    <View className="rounded-lg border border-border border-l-4 border-l-accent bg-surface px-4 py-3">
      <View className="flex-row items-baseline justify-between gap-3 border-b border-border/60 pb-2">
        <Text className="text-xs font-semibold uppercase tracking-wider text-accent">Superset</Text>
        <Text className="text-xs text-muted">
          {chunk.exercises.length} exercises · {totalSets} {totalSets === 1 ? "set" : "sets"}
        </Text>
      </View>
      {chunk.exercises.map((we, i) => {
        const name = exerciseByID.get(we.exercise_id)?.name ?? we.exercise_id;
        // A/B/C... letter prefix matches the Strong/Hevy convention for
        // labeling exercises inside a superset.
        const letter = String.fromCharCode(65 + i);
        return (
          <View
            key={`${we.exercise_id}:${i}`}
            className={i === 0 ? "mt-2" : "mt-3 border-t border-border/40 pt-3"}
          >
            <View className="flex-row items-baseline justify-between gap-3">
              <Pressable
                className="min-h-11 flex-1 justify-center active:opacity-70"
                onPress={onOpenCatalog}
                accessibilityRole="link"
                accessibilityLabel={`${name} — open exercise catalog`}
                hitSlop={6}
              >
                <Text className="text-sm font-medium text-foreground">
                  <Text className="text-accent">{letter}</Text> {name}
                </Text>
              </Pressable>
              <Text className="text-xs text-muted">
                {we.sets.length} {we.sets.length === 1 ? "set" : "sets"}
              </Text>
            </View>
            {we.notes && we.notes.trim().length > 0 && (
              <Text className="mt-1 text-xs text-muted">{we.notes}</Text>
            )}
            <SetList sets={we.sets} preferred={preferred} />
          </View>
        );
      })}
    </View>
  );
}

function SetList({
  sets,
  preferred,
}: {
  sets: WorkoutExercise["sets"];
  preferred: "lb" | "kg" | undefined;
}) {
  return (
    <View className="mt-2 gap-1">
      {sets.map((s, i) => (
        <View key={i} className="flex-row items-baseline justify-between gap-3">
          <Text className="text-xs text-muted">Set {i + 1}</Text>
          <Text className="text-sm tabular-nums text-foreground">
            {s.reps} × {formatWeight(s.weight, s.unit, preferred ?? s.unit)}
          </Text>
        </View>
      ))}
    </View>
  );
}

// --- helpers ------------------------------------------------------

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}
