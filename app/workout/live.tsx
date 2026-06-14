// Live-session screen — the core logging surface on phone. Add exercises
// via catalog search, append/edit/remove sets, group exercises into
// supersets and log them a round at a time, watch the elapsed clock and
// the rest timer, then Finish into review. The session lives in the
// root-mounted ActiveWorkoutSessionProvider; this screen is a pure view
// over it plus the add-exercise search.
//
// If there's no active session (e.g. the user landed here after a
// discard) we bounce back to Activities — there's nothing to log.
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useActiveWorkoutSession } from "@/lib/active-workout-session";
import { useExerciseCatalog } from "@/components/exercise-catalog-context";
import { DurationClock } from "@/components/live-workout/duration-clock";
import { ExerciseSearch } from "@/components/live-workout/exercise-search";
import { ExerciseCard } from "@/components/live-workout/exercise-card";
import { SupersetCard, type SupersetMember } from "@/components/live-workout/superset-card";
import { RestTimer } from "@/components/live-workout/rest-timer";
import type { DraftExercise } from "@/lib/workout-draft";

// Walks the session's exercises in array order (the source of truth for
// rendering and for the saved exercise order), collapsing contiguous
// runs that share a non-null superset_group into one superset chunk.
// Mirrors the read-only workout-detail grouping. Each item keeps its
// original session index so edits map back to the provider mutators.
type Chunk =
  | { type: "single"; index: number; exercise: DraftExercise }
  | { type: "superset"; group: number; members: { index: number; exercise: DraftExercise }[] };

function groupChunks(exercises: DraftExercise[]): Chunk[] {
  const chunks: Chunk[] = [];
  exercises.forEach((exercise, index) => {
    const sg = exercise.superset_group;
    if (sg == null) {
      chunks.push({ type: "single", index, exercise });
      return;
    }
    const prev = chunks[chunks.length - 1];
    if (prev && prev.type === "superset" && prev.group === sg) {
      prev.members.push({ index, exercise });
    } else {
      chunks.push({ type: "superset", group: sg, members: [{ index, exercise }] });
    }
  });
  return chunks;
}

export default function LiveWorkoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, setName, createSuperset, discard } = useActiveWorkoutSession();
  const { byID } = useExerciseCatalog();

  // Indices selected for "Make superset". Cleared after grouping or when
  // the underlying exercise list changes out from under us.
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // No active session → nothing to log. Bounce back to Activities. Done
  // in an effect so we don't call router during render.
  useEffect(() => {
    if (!session) router.replace("/(tabs)/activities");
  }, [session, router]);

  const chunks = useMemo(() => groupChunks(session?.exercises ?? []), [session?.exercises]);

  if (!session) return null;

  function toggleSelect(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function onCreateSuperset() {
    createSuperset([...selected]);
    setSelected(new Set());
  }

  function onDiscard() {
    Alert.alert(
      "Discard workout?",
      "This will delete the in-progress workout. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            discard();
            router.replace("/(tabs)/activities");
          },
        },
      ],
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Header — inline-editable name, elapsed clock, Finish */}
      <View
        className="border-b border-border bg-background px-4 pb-3"
        style={{ paddingTop: insets.top + 8 }}
      >
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1">
            <TextInput
              value={session.name}
              onChangeText={setName}
              placeholder="Workout name"
              placeholderTextColor="#71717a"
              className="text-lg font-semibold text-foreground"
            />
            <DurationClock performedAt={session.performed_at} />
          </View>
          <Pressable
            onPress={() => router.push("/workout/review")}
            accessibilityRole="button"
            accessibilityLabel="Finish workout"
            className="min-h-11 items-center justify-center rounded-md border border-accent bg-accent px-4 active:opacity-80"
          >
            <Text className="text-sm font-semibold text-background">Finish</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <ExerciseSearch />

        {chunks.length === 0 && (
          <View className="rounded-lg border border-border bg-surface px-4 py-6">
            <Text className="text-center text-sm text-muted">
              Search above to add your first exercise.
            </Text>
          </View>
        )}

        {chunks.map((chunk) =>
          chunk.type === "single" ? (
            <ExerciseCard
              key={`s:${chunk.index}`}
              exercise={chunk.exercise}
              index={chunk.index}
              name={byID.get(chunk.exercise.exercise_id)?.name ?? chunk.exercise.exercise_id}
              total={session.exercises.length}
              selected={selected.has(chunk.index)}
              onToggleSelect={() => toggleSelect(chunk.index)}
            />
          ) : (
            <SupersetCard
              key={`ss:${chunk.group}`}
              group={chunk.group}
              members={chunk.members.map<SupersetMember>((m) => ({
                index: m.index,
                exercise: m.exercise,
                name: byID.get(m.exercise.exercise_id)?.name ?? m.exercise.exercise_id,
              }))}
            />
          ),
        )}

        {/* Discard */}
        <Pressable
          onPress={onDiscard}
          accessibilityRole="button"
          accessibilityLabel="Discard workout"
          className="mt-2 min-h-11 items-center justify-center rounded-md border border-danger/40 bg-danger/10 active:opacity-70"
        >
          <Text className="text-sm font-medium text-danger">Discard workout</Text>
        </Pressable>
      </ScrollView>

      {/* Make-superset action bar — appears once 2+ are selected */}
      {selected.size >= 2 && (
        <Pressable
          onPress={onCreateSuperset}
          accessibilityRole="button"
          accessibilityLabel={`Group ${selected.size} exercises into a superset`}
          className="mx-4 mb-2 min-h-11 items-center justify-center rounded-md border border-accent bg-accent active:opacity-80"
        >
          <Text className="text-sm font-semibold text-background">
            Make superset ({selected.size})
          </Text>
        </Pressable>
      )}

      {/* Rest timer pinned at the bottom of the flow */}
      <View style={{ paddingBottom: insets.bottom }}>
        <RestTimer />
      </View>
    </KeyboardAvoidingView>
  );
}
