// One row in the workouts list — name (or date if unnamed), the
// performed-at date, and a one-line summary of the exercises logged.
// Tapping anywhere on the row pushes into the detail route.
import { Pressable, Text, View } from "react-native";
import type { Exercise, Workout } from "@/lib/api";

export function WorkoutRow({
  workout,
  exerciseByID,
  onPress,
}: {
  workout: Workout;
  exerciseByID: Map<string, Exercise>;
  onPress: () => void;
}) {
  const title =
    workout.name && workout.name.trim().length > 0
      ? workout.name
      : formatDate(workout.performed_at);

  // Up to three exercise names, then "+ N more" for the tail. Three
  // fits on a phone-width row without truncation in most cases; the
  // exact cutoff is a feel call, easy to bump later.
  const names = workout.exercises
    .map((we) => exerciseByID.get(we.exercise_id)?.name ?? we.exercise_id)
    .filter(Boolean);
  const summary =
    names.length === 0
      ? "No exercises"
      : names.length <= 3
        ? names.join(" · ")
        : `${names.slice(0, 3).join(" · ")} +${names.length - 3} more`;

  const setCount = workout.exercises.reduce(
    (n, we) => n + we.sets.length,
    0,
  );
  const prCount = workout.personal_records_set.length;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="rounded-lg border border-border bg-surface px-4 py-3 active:opacity-80"
    >
      <View className="flex-row items-baseline justify-between gap-3">
        <Text
          numberOfLines={1}
          className="flex-1 text-base font-medium text-foreground"
        >
          {title}
        </Text>
        <Text className="text-xs text-muted">
          {formatDate(workout.performed_at)}
        </Text>
      </View>
      <Text numberOfLines={2} className="mt-1 text-xs text-muted">
        {summary}
      </Text>
      <View className="mt-2 flex-row gap-3">
        <Text className="text-[10px] uppercase tracking-wider text-muted">
          {setCount} {setCount === 1 ? "set" : "sets"}
        </Text>
        {prCount > 0 && (
          <Text className="text-[10px] uppercase tracking-wider text-accent">
            {prCount} new PR{prCount === 1 ? "" : "s"}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
