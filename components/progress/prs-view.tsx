// PRs segment inside the Progress tab. Trophy-case list: each row is
// one headline lift with the user's heaviest set + their current
// recency-weighted estimated 1RM. When the estimate sits meaningfully
// above the PR weight, we surface a "Time for a max?" badge — that's
// the load-bearing reason this view exists.
//
// Layout adapted from web /personal-records:
//   - Cards are full-width single column (phone reality vs the
//     web's 3-up grid).
//   - "Customize" lives in the header as a small button that opens
//     a modal-style sheet (HeadlineExercisesSheet).
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { clearToken, getToken } from "@/lib/auth";
import {
  listPersonalRecords,
  type PersonalRecord,
} from "@/lib/api";
import { HeadlineExercisesSheet } from "@/components/progress/headline-exercises-sheet";

export function PRsView() {
  const router = useRouter();
  const [records, setRecords] = useState<PersonalRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const refetch = useCallback(() => {
    setError(null);
    Promise.resolve(getToken())
      .then(async (t) => {
        if (!t) {
          router.replace("/login");
          return;
        }
        const list = await listPersonalRecords(t);
        setRecords(list);
      })
      .catch((err: Error) => {
        if (err.message.toLowerCase().includes("401")) {
          clearToken();
          router.replace("/login");
          return;
        }
        setError(err.message);
      });
  }, [router]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between px-4 pb-2">
        <Text className="text-xs text-muted">
          Heaviest set vs current estimated 1RM.
        </Text>
        <Pressable
          onPress={() => setCustomizeOpen(true)}
          accessibilityRole="button"
          className="rounded-full border border-border bg-surface px-3 py-1 active:opacity-80"
        >
          <Text className="text-xs font-medium text-foreground">
            Customize
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerClassName="gap-2 px-4 pb-8">
        {error && (
          <View className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
            <Text className="text-xs text-danger">{error}</Text>
          </View>
        )}

        {records === null && !error && (
          <View className="items-center py-6">
            <ActivityIndicator />
          </View>
        )}

        {records && records.length === 0 && (
          <View className="rounded-lg border border-border bg-surface p-6">
            <Text className="text-center text-sm text-muted">
              No headline lifts configured.
            </Text>
          </View>
        )}

        {records?.map((r) => (
          <PRCard key={r.exercise_id} record={r} />
        ))}
      </ScrollView>

      <HeadlineExercisesSheet
        open={customizeOpen}
        onSaved={() => {
          setCustomizeOpen(false);
          refetch();
        }}
        onClose={() => setCustomizeOpen(false)}
      />
    </View>
  );
}

function PRCard({ record }: { record: PersonalRecord }) {
  const router = useRouter();
  const hasPR = record.weight !== null && record.workout_id !== null;

  const gap = useMemo(() => {
    if (!hasPR || record.current_estimated_1rm === null) return null;
    if (record.weight === null) return null;
    return record.current_estimated_1rm - record.weight;
  }, [hasPR, record.current_estimated_1rm, record.weight]);
  const gapPct =
    gap !== null && record.weight !== null && record.weight > 0
      ? (gap / record.weight) * 100
      : null;
  const readyForAttempt = gapPct !== null && gapPct >= 5;

  const onPress = () => {
    if (hasPR && record.workout_id) {
      router.push(`/activities/workout/${record.workout_id}`);
    }
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={!hasPR}
      accessibilityRole="button"
      className="gap-2 rounded-lg border border-border bg-surface p-3 active:opacity-80 disabled:opacity-100"
    >
      <View className="flex-row items-center justify-between gap-2">
        <Text
          className="flex-1 text-sm font-semibold text-foreground"
          numberOfLines={1}
        >
          {record.exercise_name}
        </Text>
        {readyForAttempt && (
          <View className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5">
            <Text className="text-[10px] font-medium text-amber-200">
              Time for a max?
            </Text>
          </View>
        )}
      </View>

      {hasPR ? (
        <View>
          <Text className="text-2xl font-semibold tabular-nums text-foreground">
            {formatWeight(record.weight, record.unit)}
            <Text className="text-base font-normal text-muted">
              {"  "}× {record.reps}
            </Text>
          </Text>
          <Text className="text-[10px] uppercase tracking-wider text-muted">
            Set on {formatDate(record.achieved_at)}
          </Text>
        </View>
      ) : (
        <View>
          <Text className="text-2xl font-semibold text-muted">—</Text>
          <Text className="text-[10px] uppercase tracking-wider text-muted">
            No record yet
          </Text>
        </View>
      )}

      <View className="border-t border-border pt-2">
        <Text className="text-[10px] uppercase tracking-wider text-muted">
          Current estimated 1RM
        </Text>
        <Text className="mt-0.5 text-sm font-medium tabular-nums text-foreground">
          {record.current_estimated_1rm === null
            ? "—"
            : formatWeight(
                record.current_estimated_1rm,
                record.estimated_1rm_unit,
              )}
          {gap !== null && Math.abs(gap) >= 1 && (
            <Text
              className={`text-xs ${
                gap > 0 ? "text-emerald-300" : "text-muted"
              }`}
            >
              {"  "}
              {gap > 0 ? "+" : ""}
              {gap.toFixed(1)} vs PR
            </Text>
          )}
        </Text>
      </View>

      {hasPR && record.workout_id && (
        <Text className="text-xs text-accent">View workout →</Text>
      )}
    </Pressable>
  );
}

function formatWeight(value: number | null, unit: string | null): string {
  if (value === null || unit === null) return "—";
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${unit}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
