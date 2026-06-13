// Exercises catalog — root-level stack screen (same pattern as settings.tsx).
// Pushed from the Settings "Exercise catalog" row and from the workout-detail
// exercise name Pressable. No sixth tab (five-tab cap); web has this as a tab.
//
// Data source: useExerciseCatalog() — fetched once per session by the
// ExerciseCatalogProvider mounted in app/_layout.tsx (root, so this root
// route can consume it). No auth call here.
//
// Search predicate mirrors web's exactly: lower-cased substring match
// across name + muscle_groups[] + equipment[].
//
// A–Z grouping mirrors web's exactly: sort by name, group by uppercased
// first letter, "#" fallback, sections sorted by letter.
//
// "Request an exercise" banner: web uses a mailto link to config.betaContactEmail.
// Mobile config (lib/config.ts) exposes no contact email — rendered as plain
// text without a link. Deferred: add betaContactEmail to config if/when a
// contact address is established.
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, SectionList, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import { useExerciseCatalog } from "@/components/exercise-catalog-context";
import { MuscleGroupPill } from "@/components/muscle-group-pill";
import { EquipmentPill } from "@/components/equipment-pill";
import type { Exercise } from "@/lib/api";

// Shared dark header options — mirrors settings.tsx HEADER_OPTIONS exactly.
const HEADER_OPTIONS = {
  title: "Exercises",
  headerShown: true,
  headerStyle: { backgroundColor: "#0a0a0b" },
  headerTitleStyle: { color: "#fafafa" },
  headerTintColor: "#fafafa",
  headerShadowVisible: false,
} as const;

export default function ExercisesScreen() {
  const { exercises, loading, error } = useExerciseCatalog();
  const [query, setQuery] = useState("");
  const [expandedIDs, setExpandedIDs] = useState<Set<string>>(new Set());

  // Web's exact predicate: lower-cased substring across name, muscle_groups, equipment.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return exercises;
    return exercises.filter((e) => {
      if (e.name.toLowerCase().includes(q)) return true;
      if (e.muscle_groups.some((mg) => mg.toLowerCase().includes(q))) return true;
      if (e.equipment.some((eq) => eq.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [exercises, query]);

  // Web's exact grouping: sort by name, group by uppercased first letter, "#" fallback.
  // SectionList wants [{ title: string, data: Exercise[] }].
  const sections = useMemo(() => {
    const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    const map = new Map<string, Exercise[]>();
    for (const ex of sorted) {
      const letter = (ex.name[0] ?? "#").toUpperCase();
      const list = map.get(letter);
      if (list) list.push(ex);
      else map.set(letter, [ex]);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([letter, data]) => ({ title: letter, data }));
  }, [filtered]);

  function toggleExpanded(id: string) {
    setExpandedIDs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={HEADER_OPTIONS} />

      {/* Search input */}
      <View className="border-b border-border px-4 py-3">
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name, muscle group, or equipment…"
          placeholderTextColor="#71717a"
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          className="min-h-11 rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
        />
      </View>

      {/* Loading state */}
      {loading && exercises.length === 0 && (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#fafafa" />
          <Text className="mt-2 text-sm text-muted">Loading exercises…</Text>
        </View>
      )}

      {/* Error state */}
      {error && !loading && (
        <View className="m-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
          <Text className="text-sm text-danger">{error}</Text>
        </View>
      )}

      {/* Empty search results */}
      {!loading && !error && exercises.length > 0 && sections.length === 0 && (
        <View className="m-4 rounded-md border border-border bg-surface p-4">
          <Text className="text-center text-sm text-muted">
            No exercises match <Text className="font-mono text-foreground">{query}</Text>.
          </Text>
        </View>
      )}

      {/* Catalog list */}
      {sections.length > 0 && (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled
          contentContainerStyle={{ paddingBottom: 32 }}
          renderSectionHeader={({ section }) => (
            <View className="border-b border-border bg-background px-4 py-1.5">
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted">
                {section.title}
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <ExerciseRow
              exercise={item}
              expanded={expandedIDs.has(item.id)}
              onToggle={() => toggleExpanded(item.id)}
            />
          )}
          ListFooterComponent={<RequestBanner />}
        />
      )}

      {/* Show banner even when no results / initial empty */}
      {!loading && exercises.length === 0 && !error && <RequestBanner />}
    </View>
  );
}

function ExerciseRow({
  exercise,
  expanded,
  onToggle,
}: {
  exercise: Exercise;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <View className="border-b border-border/50 bg-background">
      {/* Row header — tappable, ≥44pt */}
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`${exercise.name}, ${expanded ? "collapse" : "expand"}`}
        accessibilityState={{ expanded }}
        className="min-h-11 flex-row items-center gap-3 px-4 py-3 active:bg-surface"
      >
        {/* Chevron — glyph swap (no rotate; ▼ already points down) */}
        <Text className="text-xs text-muted">{expanded ? "▼" : "▶"}</Text>
        <Text className="flex-1 text-sm font-medium text-foreground" numberOfLines={1}>
          {exercise.name}
        </Text>
      </Pressable>

      {/* Expanded detail */}
      {expanded && (
        <View className="gap-3 border-t border-border/50 px-4 py-3">
          {exercise.description ? (
            <Text className="text-sm text-foreground">{exercise.description}</Text>
          ) : null}

          {exercise.muscle_groups.length > 0 && (
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="text-[10px] uppercase tracking-wide text-muted">Targets</Text>
              {exercise.muscle_groups.map((mg) => (
                <MuscleGroupPill key={mg} label={mg} />
              ))}
            </View>
          )}

          {exercise.equipment.length > 0 && (
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="text-[10px] uppercase tracking-wide text-muted">Equipment</Text>
              {exercise.equipment.map((eq) => (
                <EquipmentPill key={eq} label={eq} />
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * "Request an exercise" informational banner.
 *
 * Web version: mailto link to config.betaContactEmail.
 * Mobile: lib/config.ts exposes no betaContactEmail — rendered as plain
 * text without a link. Deferred: add betaContactEmail to config if a
 * contact address is established for the mobile app.
 */
function RequestBanner() {
  return (
    <View className="mx-4 my-4 flex-row items-start gap-3 rounded-md border border-border bg-surface px-3 py-3">
      <Text className="text-accent" style={{ fontSize: 14, lineHeight: 20 }}>
        ⓘ
      </Text>
      <Text className="flex-1 text-sm text-muted">
        Don&apos;t see an exercise you need? Contact us and we&apos;ll get it added to the catalog.
      </Text>
    </View>
  );
}
