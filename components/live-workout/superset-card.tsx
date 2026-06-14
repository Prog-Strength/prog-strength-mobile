// A superset card — exercises sharing a `superset_group`, logged a round
// at a time. Each member shows its already-logged sets (read-only) and a
// single editable "next round" row. "Log round" appends one set to each
// member (`logSupersetRound`) and starts the rest timer; members may end
// with differing set counts (a partial round just leaves some members
// with fewer logged sets — that's fine). "Ungroup" dissolves the group.
//
// The members carry their original session index so reps/weight edits
// and the round payload map back to `logSupersetRound(group, byIndex)`.
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useActiveWorkoutSession } from "@/lib/active-workout-session";
import { useProfile } from "@/lib/profile-context";
import { formatWeight } from "@/lib/units";
import type { DraftExercise, DraftSet } from "@/lib/workout-draft";

export type SupersetMember = { index: number; name: string; exercise: DraftExercise };

export function SupersetCard({ group, members }: { group: number; members: SupersetMember[] }) {
  const { logSupersetRound, ungroupSuperset, startRestTimer } = useActiveWorkoutSession();
  const { profile } = useProfile();
  const fallbackUnit: "lb" | "kg" = profile?.weight_unit ?? "lb";
  const preferred = profile?.weight_unit;

  // Local "next round" draft, keyed by session index. Seeds each member
  // from its last logged set so consecutive rounds default sensibly.
  const [draft, setDraft] = useState<Record<number, DraftSet>>(() =>
    seedDraft(members, fallbackUnit),
  );

  // The "round index" is the count of the member that has logged the
  // most sets so far — i.e. the round we're about to enter.
  const loggedRounds = Math.max(0, ...members.map((m) => m.exercise.sets.length));

  function patch(index: number, p: Partial<DraftSet>) {
    setDraft((d) => ({ ...d, [index]: { ...d[index], ...p } }));
  }

  function onLogRound() {
    const sets: Record<number, DraftSet> = {};
    for (const m of members) sets[m.index] = draft[m.index];
    logSupersetRound(group, sets);
    startRestTimer();
    // Carry the just-logged values forward as the next round's default.
    setDraft({ ...draft });
  }

  return (
    <View className="rounded-lg border border-border border-l-4 border-l-accent bg-surface px-4 py-3">
      <View className="flex-row items-center justify-between gap-3 border-b border-border/60 pb-2">
        <Text className="text-xs font-semibold uppercase tracking-wider text-accent">Superset</Text>
        <View className="flex-row items-center gap-3">
          <Text className="text-xs text-muted">Round {loggedRounds + 1}</Text>
          <Pressable
            onPress={() => ungroupSuperset(group)}
            accessibilityRole="button"
            accessibilityLabel="Ungroup superset"
            className="min-h-11 justify-center active:opacity-70"
          >
            <Text className="text-xs text-muted">Ungroup</Text>
          </Pressable>
        </View>
      </View>

      {members.map((m, i) => {
        const letter = String.fromCharCode(65 + i);
        // Guard against a missing draft entry (a member index without a
        // seeded row) so next.reps/next.weight can't throw. Mirror the
        // seed fallback: a zeroed set in the member's last unit, else lb.
        const next = draft[m.index] ?? {
          reps: 0,
          weight: 0,
          unit: m.exercise.sets[m.exercise.sets.length - 1]?.unit ?? "lb",
        };
        return (
          <View key={m.index} className={i === 0 ? "mt-3" : "mt-3 border-t border-border/40 pt-3"}>
            <Text className="text-sm font-medium text-foreground" numberOfLines={2}>
              <Text className="text-accent">{letter}</Text> {m.name}
            </Text>

            {/* Already-logged sets (read-only) */}
            {m.exercise.sets.length > 0 && (
              <View className="mt-1 gap-0.5">
                {m.exercise.sets.map((s, si) => (
                  <View key={si} className="flex-row items-baseline justify-between gap-3">
                    <Text className="text-xs text-muted">Round {si + 1}</Text>
                    <Text className="text-sm tabular-nums text-foreground">
                      {s.reps} × {formatWeight(s.weight, s.unit, preferred ?? s.unit)}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Next-round editable row */}
            <View className="mt-2 flex-row items-center gap-2">
              <TextInput
                value={next.reps ? String(next.reps) : ""}
                onChangeText={(t) => patch(m.index, { reps: parseIntInput(t) })}
                keyboardType="number-pad"
                placeholder="reps"
                placeholderTextColor="#71717a"
                className="min-h-11 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums text-foreground"
              />
              <TextInput
                value={next.weight ? String(next.weight) : ""}
                onChangeText={(t) => patch(m.index, { weight: parseFloatInput(t) })}
                keyboardType="decimal-pad"
                placeholder="weight"
                placeholderTextColor="#71717a"
                className="min-h-11 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums text-foreground"
              />
              <View className="w-16 flex-row overflow-hidden rounded-md border border-border">
                {(["lb", "kg"] as const).map((u) => {
                  const active = next.unit === u;
                  return (
                    <Pressable
                      key={u}
                      onPress={() => patch(m.index, { unit: u })}
                      accessibilityRole="button"
                      accessibilityLabel={`Set unit ${u} for ${m.name}`}
                      accessibilityState={{ selected: active }}
                      className={`flex-1 items-center justify-center py-2 active:opacity-70 ${
                        active ? "bg-accent" : "bg-background"
                      }`}
                    >
                      <Text className={`text-xs ${active ? "text-background" : "text-muted"}`}>
                        {u}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        );
      })}

      <Pressable
        onPress={onLogRound}
        accessibilityRole="button"
        accessibilityLabel={`Log round ${loggedRounds + 1}`}
        className="mt-3 min-h-11 items-center justify-center rounded-md border border-accent bg-accent/15 active:opacity-70"
      >
        <Text className="text-sm font-semibold text-accent">Log round {loggedRounds + 1}</Text>
      </Pressable>
    </View>
  );
}

function seedDraft(members: SupersetMember[], fallbackUnit: "lb" | "kg"): Record<number, DraftSet> {
  const d: Record<number, DraftSet> = {};
  for (const m of members) {
    const last = m.exercise.sets[m.exercise.sets.length - 1];
    d[m.index] = last
      ? { reps: last.reps, weight: last.weight, unit: last.unit }
      : { reps: 0, weight: 0, unit: fallbackUnit };
  }
  return d;
}

function parseIntInput(text: string): number {
  const n = parseInt(text.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function parseFloatInput(text: string): number {
  const cleaned = text.replace(/[^0-9.]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}
