// Customize-your-headline-lifts sheet. Uses RN's built-in Modal with
// `presentationStyle="pageSheet"` so iOS gives us the standard
// slide-up card with a system-handled swipe-down dismiss.
//
// Behavior mirrors the web HeadlineExercisesModal:
//   - Loads in parallel: full exercise catalog, the user's current
//     selection, the curated defaults.
//   - Checkboxes enforce the 12-item cap pre-emptively.
//   - Reset to defaults + Save are the two action buttons.
//   - "default" badge on catalog rows that are also in the curated set.
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { getToken } from "@/lib/auth";
import {
  listExercises,
  listHeadlineExerciseDefaults,
  listMyHeadlineExercises,
  putMyHeadlineExercises,
  type Exercise,
  type HeadlineExercise,
} from "@/lib/api";

// Mirrors the backend's MaxHeadlineExercises constant — same rationale
// as web: the cap drives the Save button's enable/disable state and
// we don't want a round-trip just to find out the user picked too many.
const MAX_SELECTION = 12;

export function HeadlineExercisesSheet({
  open,
  onSaved,
  onClose,
}: {
  open: boolean;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [catalog, setCatalog] = useState<Exercise[] | null>(null);
  const [selectedIDs, setSelectedIDs] = useState<string[]>([]);
  const [defaultIDs, setDefaultIDs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    Promise.resolve(getToken())
      .then(async (t) => {
        if (!t) throw new Error("not signed in");
        const [cat, mine, defaults] = await Promise.all([
          listExercises(),
          listMyHeadlineExercises(t),
          listHeadlineExerciseDefaults(t),
        ]);
        setCatalog(cat);
        setSelectedIDs(mine.map((m: HeadlineExercise) => m.exercise_id));
        setDefaultIDs(new Set(defaults.map((d) => d.exercise_id)));
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [open]);

  const byMuscleGroup = useMemo(() => {
    if (!catalog) return new Map<string, Exercise[]>();
    const m = new Map<string, Exercise[]>();
    for (const ex of catalog) {
      for (const mg of ex.muscle_groups) {
        const arr = m.get(mg) ?? [];
        arr.push(ex);
        m.set(mg, arr);
      }
    }
    for (const [, arr] of m) {
      arr.sort((a, b) => a.name.localeCompare(b.name));
    }
    return m;
  }, [catalog]);

  const selectedSet = useMemo(() => new Set(selectedIDs), [selectedIDs]);
  const atCap = selectedIDs.length >= MAX_SELECTION;

  function toggle(exerciseID: string) {
    setSelectedIDs((prev) => {
      if (prev.includes(exerciseID)) {
        return prev.filter((id) => id !== exerciseID);
      }
      if (prev.length >= MAX_SELECTION) return prev;
      return [...prev, exerciseID];
    });
  }

  function resetToDefaults() {
    setSelectedIDs(Array.from(defaultIDs));
  }

  async function save() {
    if (selectedIDs.length === 0) {
      setError("Pick at least one exercise.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const t = await getToken();
      if (!t) throw new Error("not signed in");
      await putMyHeadlineExercises(t, selectedIDs);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      visible={open}
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      animationType="slide"
    >
      <View className="flex-1 bg-background">
        <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
          <View className="flex-1">
            <Text className="text-base font-semibold text-foreground">
              Customize headline lifts
            </Text>
            <Text className="text-xs text-muted">
              Pick the exercises surfaced on this page. Up to {MAX_SELECTION}.
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={8}
            className="rounded p-1 active:opacity-80 disabled:opacity-50"
          >
            <Text className="text-base text-muted">✕</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerClassName="gap-4 px-4 py-4">
          {loading && (
            <View className="items-center py-8">
              <ActivityIndicator />
            </View>
          )}
          {error && (
            <View className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
              <Text className="text-xs text-danger">{error}</Text>
            </View>
          )}
          {!loading && catalog && (
            <>
              {Array.from(byMuscleGroup.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([muscleGroup, exercises]) => (
                  <View key={muscleGroup} className="gap-1.5">
                    <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                      {muscleGroup}
                    </Text>
                    {exercises.map((ex) => {
                      const checked = selectedSet.has(ex.id);
                      const isDefault = defaultIDs.has(ex.id);
                      const disabled = !checked && atCap;
                      return (
                        <Pressable
                          key={`${muscleGroup}:${ex.id}`}
                          onPress={() => toggle(ex.id)}
                          disabled={disabled || saving}
                          accessibilityRole="checkbox"
                          accessibilityState={{
                            checked,
                            disabled: disabled || saving,
                          }}
                          className={`flex-row items-center gap-3 rounded-md px-2 py-2 active:opacity-80 ${
                            disabled ? "opacity-50" : ""
                          }`}
                        >
                          <View
                            className={`h-5 w-5 items-center justify-center rounded border ${
                              checked
                                ? "border-accent bg-accent"
                                : "border-border bg-surface"
                            }`}
                          >
                            {checked && (
                              <Text className="text-xs font-bold text-accent-fg">
                                ✓
                              </Text>
                            )}
                          </View>
                          <Text
                            className="flex-1 text-sm text-foreground"
                            numberOfLines={1}
                          >
                            {ex.name}
                          </Text>
                          {isDefault && (
                            <View className="rounded-full border border-border bg-surface px-2 py-0.5">
                              <Text className="text-[10px] text-muted">
                                default
                              </Text>
                            </View>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
            </>
          )}
        </ScrollView>

        <View className="flex-row items-center justify-between gap-3 border-t border-border px-4 py-3">
          <View className="flex-row items-center gap-3">
            <Text className="text-xs text-muted">
              {selectedIDs.length} / {MAX_SELECTION}
            </Text>
            <Pressable
              onPress={resetToDefaults}
              disabled={loading || saving}
              accessibilityRole="button"
              className="active:opacity-80 disabled:opacity-50"
            >
              <Text className="text-xs text-accent">Reset to defaults</Text>
            </Pressable>
          </View>
          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={onClose}
              disabled={saving}
              accessibilityRole="button"
              className="rounded-md border border-border bg-surface px-3 py-1.5 active:opacity-80 disabled:opacity-50"
            >
              <Text className="text-xs font-medium text-foreground">
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={save}
              disabled={loading || saving || selectedIDs.length === 0}
              accessibilityRole="button"
              className="rounded-md bg-accent px-3 py-1.5 active:opacity-80 disabled:opacity-50"
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-xs font-medium text-accent-fg">
                  Save
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
