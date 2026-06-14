// One non-superset exercise in the live session. Renders the catalog
// name, per-set rows (reps / weight numeric inputs + a lb/kg toggle),
// add/remove set, an exercise-notes field, remove-exercise, up/down
// reorder, and a "Make superset" selection toggle the parent uses to
// group two or more exercises.
//
// "+ Add set" copies the last set's reps/weight/unit as the new default
// (falling back to a zeroed set in the profile unit) and starts the rest
// timer — logging a set is the natural moment to begin resting.
import { Pressable, Text, TextInput, View } from "react-native";
import { useActiveWorkoutSession } from "@/lib/active-workout-session";
import { useProfile } from "@/lib/profile-context";
import type { DraftExercise, DraftSet } from "@/lib/workout-draft";

export function ExerciseCard({
  exercise,
  index,
  name,
  total,
  selected,
  onToggleSelect,
}: {
  exercise: DraftExercise;
  index: number;
  name: string;
  total: number;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const {
    addSet,
    updateSet,
    removeSet,
    removeExercise,
    reorderExercise,
    setExerciseNotes,
    startRestTimer,
  } = useActiveWorkoutSession();
  const { profile } = useProfile();
  const fallbackUnit: "lb" | "kg" = profile?.weight_unit ?? "lb";

  function onAddSet() {
    const last = exercise.sets[exercise.sets.length - 1];
    const next: DraftSet = last
      ? { reps: last.reps, weight: last.weight, unit: last.unit }
      : { reps: 0, weight: 0, unit: fallbackUnit };
    addSet(index, next);
    startRestTimer();
  }

  return (
    <View className="rounded-lg border border-border bg-surface px-4 py-3">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1 text-base font-medium text-foreground" numberOfLines={2}>
          {name}
        </Text>
        <View className="flex-row items-center gap-1">
          <Pressable
            onPress={() => reorderExercise(index, index - 1)}
            disabled={index === 0}
            accessibilityRole="button"
            accessibilityLabel={`Move ${name} up`}
            className={`min-h-11 min-w-11 items-center justify-center rounded-md active:bg-background ${
              index === 0 ? "opacity-30" : ""
            }`}
          >
            <Text className="text-base text-foreground">↑</Text>
          </Pressable>
          <Pressable
            onPress={() => reorderExercise(index, index + 1)}
            disabled={index === total - 1}
            accessibilityRole="button"
            accessibilityLabel={`Move ${name} down`}
            className={`min-h-11 min-w-11 items-center justify-center rounded-md active:bg-background ${
              index === total - 1 ? "opacity-30" : ""
            }`}
          >
            <Text className="text-base text-foreground">↓</Text>
          </Pressable>
          <Pressable
            onPress={() => removeExercise(index)}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${name}`}
            className="min-h-11 min-w-11 items-center justify-center rounded-md active:bg-background"
          >
            <Text className="text-base text-danger">✕</Text>
          </Pressable>
        </View>
      </View>

      {/* Set rows */}
      <View className="mt-3 gap-2">
        <View className="flex-row items-center gap-2">
          <Text className="w-8 text-[10px] uppercase tracking-wider text-muted">Set</Text>
          <Text className="flex-1 text-[10px] uppercase tracking-wider text-muted">Reps</Text>
          <Text className="flex-1 text-[10px] uppercase tracking-wider text-muted">Weight</Text>
          <Text className="w-16 text-[10px] uppercase tracking-wider text-muted">Unit</Text>
          <View className="w-9" />
        </View>
        {exercise.sets.map((set, setIdx) => (
          <SetRow
            key={setIdx}
            set={set}
            label={setIdx + 1}
            onReps={(reps) => updateSet(index, setIdx, { reps })}
            onWeight={(weight) => updateSet(index, setIdx, { weight })}
            onUnit={(unit) => updateSet(index, setIdx, { unit })}
            onRemove={() => removeSet(index, setIdx)}
          />
        ))}
      </View>

      <Pressable
        onPress={onAddSet}
        accessibilityRole="button"
        accessibilityLabel={`Add set to ${name}`}
        className="mt-3 min-h-11 items-center justify-center rounded-md border border-border bg-background active:opacity-70"
      >
        <Text className="text-sm font-medium text-accent">+ Add set</Text>
      </Pressable>

      {/* Exercise notes */}
      <TextInput
        value={exercise.notes ?? ""}
        onChangeText={(text) => setExerciseNotes(index, text)}
        placeholder="Notes (optional)"
        placeholderTextColor="#71717a"
        multiline
        className="mt-3 min-h-11 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      />

      {/* Make-superset selection toggle */}
      <Pressable
        onPress={onToggleSelect}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={`Select ${name} for a superset`}
        className="mt-3 min-h-11 flex-row items-center gap-2 active:opacity-70"
      >
        <View
          className={`h-5 w-5 items-center justify-center rounded border ${
            selected ? "border-accent bg-accent" : "border-border bg-background"
          }`}
        >
          {selected && <Text className="text-xs font-bold text-background">✓</Text>}
        </View>
        <Text className="text-sm text-muted">Make superset</Text>
      </Pressable>
    </View>
  );
}

function SetRow({
  set,
  label,
  onReps,
  onWeight,
  onUnit,
  onRemove,
}: {
  set: DraftSet;
  label: number;
  onReps: (reps: number) => void;
  onWeight: (weight: number) => void;
  onUnit: (unit: "lb" | "kg") => void;
  onRemove: () => void;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <Text className="w-8 text-xs text-muted">{label}</Text>
      <TextInput
        defaultValue={set.reps ? String(set.reps) : ""}
        onChangeText={(text) => onReps(parseIntInput(text))}
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor="#71717a"
        className="min-h-11 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums text-foreground"
      />
      <TextInput
        defaultValue={set.weight ? String(set.weight) : ""}
        onChangeText={(text) => onWeight(parseFloatInput(text))}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor="#71717a"
        className="min-h-11 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums text-foreground"
      />
      <View className="w-16 flex-row overflow-hidden rounded-md border border-border">
        {(["lb", "kg"] as const).map((u) => {
          const active = set.unit === u;
          return (
            <Pressable
              key={u}
              onPress={() => onUnit(u)}
              accessibilityRole="button"
              accessibilityLabel={`Set unit ${u}`}
              accessibilityState={{ selected: active }}
              className={`flex-1 items-center justify-center py-2 active:opacity-70 ${
                active ? "bg-accent" : "bg-background"
              }`}
            >
              <Text className={`text-xs ${active ? "text-background" : "text-muted"}`}>{u}</Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={`Remove set ${label}`}
        className="w-9 min-h-11 items-center justify-center rounded-md active:bg-background"
      >
        <Text className="text-sm text-danger">✕</Text>
      </Pressable>
    </View>
  );
}

// Numeric input parsers — empty/garbage becomes 0 so the stored set is
// always a finite number (`isSessionSaveable` rejects non-finite). Reps
// are whole numbers; weight allows one decimal point.
function parseIntInput(text: string): number {
  const n = parseInt(text.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function parseFloatInput(text: string): number {
  const cleaned = text.replace(/[^0-9.]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}
