// Add-exercise search for the live session. A text input filters the
// catalog (same predicate as the /exercises screen: lower-cased
// substring across name + muscle_groups[] + equipment[]). Tapping a
// result adds it to the session (the provider seeds the prefilled first
// set) and clears the query. Results are capped so a blank-ish query
// doesn't render the whole catalog.
import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useExerciseCatalog } from "@/components/exercise-catalog-context";
import { useActiveWorkoutSession } from "@/lib/active-workout-session";

const MAX_RESULTS = 8;

export function ExerciseSearch() {
  const { exercises } = useExerciseCatalog();
  const { addExercise } = useActiveWorkoutSession();
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return exercises
      .filter((e) => {
        if (e.name.toLowerCase().includes(q)) return true;
        if (e.muscle_groups.some((mg) => mg.toLowerCase().includes(q))) return true;
        if (e.equipment.some((eq) => eq.toLowerCase().includes(q))) return true;
        return false;
      })
      .slice(0, MAX_RESULTS);
  }, [exercises, query]);

  function onPick(id: string) {
    addExercise(id);
    setQuery("");
  }

  return (
    <View className="rounded-lg border border-border bg-surface px-3 py-3">
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Add an exercise…"
        placeholderTextColor="#71717a"
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        className="min-h-11 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      />
      {query.trim().length > 0 && (
        <View className="mt-2">
          {results.length === 0 ? (
            <Text className="px-1 py-2 text-sm text-muted">No exercises match.</Text>
          ) : (
            results.map((e) => (
              <Pressable
                key={e.id}
                onPress={() => onPick(e.id)}
                accessibilityRole="button"
                accessibilityLabel={`Add ${e.name}`}
                className="min-h-11 justify-center rounded-md px-2 py-2 active:bg-background"
              >
                <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                  {e.name}
                </Text>
                {e.muscle_groups.length > 0 && (
                  <Text className="mt-0.5 text-xs text-muted" numberOfLines={1}>
                    {e.muscle_groups.join(", ")}
                  </Text>
                )}
              </Pressable>
            ))
          )}
        </View>
      )}
    </View>
  );
}
