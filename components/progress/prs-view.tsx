// PRs segment inside the Progress tab. Trophy-case list: each row is
// one headline lift with the user's heaviest set + their current
// recency-weighted estimated 1RM. When the estimate sits meaningfully
// above the PR weight, we surface a "Time for a max?" badge — that's
// the load-bearing reason this view exists.
//
// A nested Lifts | Running segmented control lets users switch between
// strength PRs and running best efforts without leaving the PRs segment.
//
// Layout adapted from web /personal-records:
//   - Cards are full-width single column (phone reality vs the
//     web's 3-up grid).
//   - "Customize" lives only in the Lifts view header.
//   - Expandable 1RM history chart per card (lazy fetch, ref-cached).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { clearToken, getToken } from "@/lib/auth";
import {
  getExerciseOneRMHistory,
  listPersonalRecords,
  type ExerciseOneRMHistory,
  type PersonalRecord,
} from "@/lib/api";
import { convertWeight, formatWeight } from "@/lib/units";
import { useProfile } from "@/lib/profile-context";
import { SegmentedControl, type Segment } from "@/components/segmented-control";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { HeadlineExercisesSheet } from "@/components/progress/headline-exercises-sheet";
import { RunningPRsView } from "@/components/progress/running-prs-view";

type PRTab = "lifts" | "running";

const PR_TABS: readonly Segment<PRTab>[] = [
  { value: "lifts", label: "Lifts" },
  { value: "running", label: "Running" },
];

export function PRsView() {
  const [tab, setTab] = useState<PRTab>("lifts");
  const [records, setRecords] = useState<PersonalRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const router = useRouter();
  const { profile } = useProfile();
  const preferred = profile?.weight_unit ?? null;

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

  // Null-safe wrapper for lib/units formatWeight that converts to the
  // preferred unit. This is a deliberate improvement over the old
  // as-logged rendering — weights/1RMs now display in the user's
  // preferred unit regardless of the unit they were logged in.
  const fmtWeight = useCallback(
    (v: number | null, unit: "lb" | "kg" | null) => {
      if (v === null || unit === null) return "—";
      return formatWeight(v, unit, preferred ?? unit);
    },
    [preferred],
  );

  return (
    <View className="flex-1">
      {/* Nested Lifts | Running toggle */}
      <View className="px-4 pb-2 pt-1">
        <SegmentedControl value={tab} onChange={setTab} segments={PR_TABS} ariaLabel="PR view" />
      </View>

      {tab === "lifts" ? (
        <LiftsContent
          records={records}
          error={error}
          customizeOpen={customizeOpen}
          setCustomizeOpen={setCustomizeOpen}
          onRefetch={refetch}
          fmtWeight={fmtWeight}
        />
      ) : (
        <RunningPRsView />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Lifts content
// ---------------------------------------------------------------------------

function LiftsContent({
  records,
  error,
  customizeOpen,
  setCustomizeOpen,
  onRefetch,
  fmtWeight,
}: {
  records: PersonalRecord[] | null;
  error: string | null;
  customizeOpen: boolean;
  setCustomizeOpen: (v: boolean) => void;
  onRefetch: () => void;
  fmtWeight: (v: number | null, unit: "lb" | "kg" | null) => string;
}) {
  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between px-4 pb-2">
        <Text className="text-xs text-muted">Heaviest set vs current estimated 1RM.</Text>
        <Pressable
          onPress={() => setCustomizeOpen(true)}
          accessibilityRole="button"
          className="rounded-full border border-border bg-surface px-3 py-1 active:opacity-80"
        >
          <Text className="text-xs font-medium text-foreground">Customize</Text>
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
            <Text className="text-center text-sm text-muted">No headline lifts configured.</Text>
          </View>
        )}

        {records?.map((r) => (
          <PRCard key={r.exercise_id} record={r} fmtWeight={fmtWeight} />
        ))}
      </ScrollView>

      <HeadlineExercisesSheet
        open={customizeOpen}
        onSaved={() => {
          setCustomizeOpen(false);
          onRefetch();
        }}
        onClose={() => setCustomizeOpen(false)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// PR card with expandable 1RM history chart
// ---------------------------------------------------------------------------

function PRCard({
  record,
  fmtWeight,
}: {
  record: PersonalRecord;
  fmtWeight: (v: number | null, unit: "lb" | "kg" | null) => string;
}) {
  const router = useRouter();
  const { profile } = useProfile();
  const preferred = profile?.weight_unit ?? null;

  const hasPR = record.weight !== null && record.workout_id !== null;

  const [historyExpanded, setHistoryExpanded] = useState(false);
  // Ref-cache: once fetched for an exercise_id, re-expand does not refetch.
  const historyCache = useRef<Map<string, ExerciseOneRMHistory>>(new Map());
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<ExerciseOneRMHistory | null>(null);

  // Gap is computed with both operands converted to the same display
  // unit (the preferred unit, like the values it renders beside) — the
  // PR weight and estimated 1RM may be stored in different units.
  const { gap, gapPct } = useMemo(() => {
    if (
      !hasPR ||
      record.current_estimated_1rm === null ||
      record.weight === null ||
      record.unit === null ||
      record.estimated_1rm_unit === null
    ) {
      return { gap: null, gapPct: null };
    }
    const to = preferred ?? record.unit;
    const oneRm = convertWeight(record.current_estimated_1rm, record.estimated_1rm_unit, to);
    const prWeight = convertWeight(record.weight, record.unit, to);
    const g = oneRm - prWeight;
    return { gap: g, gapPct: prWeight > 0 ? (g / prWeight) * 100 : null };
  }, [
    hasPR,
    record.current_estimated_1rm,
    record.weight,
    record.unit,
    record.estimated_1rm_unit,
    preferred,
  ]);
  const readyForAttempt = gapPct !== null && gapPct >= 5;

  const onPress = () => {
    if (hasPR && record.workout_id) {
      router.push(`/activities/workout/${record.workout_id}`);
    }
  };

  const toggleHistory = useCallback(async () => {
    const next = !historyExpanded;
    setHistoryExpanded(next);
    if (!next) return; // collapsing — nothing to fetch

    // Already cached?
    const cached = historyCache.current.get(record.exercise_id);
    if (cached) {
      setHistoryData(cached);
      return;
    }

    // First expand — fetch
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const t = await getToken();
      if (!t) return;
      const data = await getExerciseOneRMHistory(t, record.exercise_id);
      historyCache.current.set(record.exercise_id, data);
      setHistoryData(data);
    } catch (err: unknown) {
      setHistoryError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setHistoryLoading(false);
    }
  }, [historyExpanded, record.exercise_id]);

  // Build chart points with unit conversion to preferred
  const chartPoints = useMemo(() => {
    if (!historyData) return [];
    const targetUnit = preferred ?? historyData.unit;
    return historyData.points.map((p) => ({
      t: Date.parse(p.performed_at),
      y: convertWeight(p.estimated_1rm, historyData.unit, targetUnit),
    }));
  }, [historyData, preferred]);

  const chartUnit = preferred ?? historyData?.unit ?? "lb";

  return (
    <View className="gap-2 rounded-lg border border-border bg-surface p-3">
      {/* Header row: exercise name + badge */}
      <Pressable
        onPress={onPress}
        disabled={!hasPR}
        accessibilityRole="button"
        className="active:opacity-80 disabled:opacity-100"
      >
        <View className="flex-row items-center justify-between gap-2">
          <Text className="flex-1 text-sm font-semibold text-foreground" numberOfLines={1}>
            {record.exercise_name}
          </Text>
          {readyForAttempt && (
            <View className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5">
              <Text className="text-[10px] font-medium text-amber-200">Time for a max?</Text>
            </View>
          )}
        </View>

        {hasPR ? (
          <View className="mt-1">
            <Text className="text-2xl font-semibold tabular-nums text-foreground">
              {fmtWeight(record.weight, record.unit)}
              <Text className="text-base font-normal text-muted">
                {"  "}× {record.reps}
              </Text>
            </Text>
            <Text className="text-[10px] uppercase tracking-wider text-muted">
              Set on {formatDate(record.achieved_at)}
            </Text>
          </View>
        ) : (
          <View className="mt-1">
            <Text className="text-2xl font-semibold text-muted">—</Text>
            <Text className="text-[10px] uppercase tracking-wider text-muted">No record yet</Text>
          </View>
        )}

        <View className="mt-2 border-t border-border pt-2">
          <Text className="text-[10px] uppercase tracking-wider text-muted">
            Current estimated 1RM
          </Text>
          <Text className="mt-0.5 text-sm font-medium tabular-nums text-foreground">
            {fmtWeight(record.current_estimated_1rm, record.estimated_1rm_unit)}
            {gap !== null && Math.abs(gap) >= 1 && (
              <Text className={`text-xs ${gap > 0 ? "text-emerald-300" : "text-muted"}`}>
                {"  "}
                {gap > 0 ? "+" : ""}
                {gap.toFixed(1)} vs PR
              </Text>
            )}
          </Text>
        </View>

        {hasPR && record.workout_id && (
          <Text className="mt-1 text-xs text-accent">View workout →</Text>
        )}
      </Pressable>

      {/* History expand footer — only for records that have a PR */}
      {hasPR && (
        <Pressable
          onPress={toggleHistory}
          accessibilityRole="button"
          accessibilityLabel={historyExpanded ? "Hide history" : "Show history"}
          accessibilityState={{ expanded: historyExpanded }}
          className="mt-1 min-h-[44px] flex-row items-center justify-center gap-1 border-t border-border pt-2 active:opacity-70"
          hitSlop={8}
        >
          <Text className="text-xs text-muted">History</Text>
          <Text className={`text-xs text-muted ${historyExpanded ? "rotate-180" : ""}`}>
            {historyExpanded ? "▲" : "▾"}
          </Text>
        </Pressable>
      )}

      {/* Inline history content */}
      {historyExpanded && (
        <View className="pt-1">
          {historyLoading && (
            <View className="items-center py-3">
              <ActivityIndicator size="small" />
            </View>
          )}
          {historyError && <Text className="text-xs text-danger">{historyError}</Text>}
          {historyData && !historyLoading && (
            <TimeSeriesChart
              points={chartPoints}
              yFormat={(y) => formatWeight(y, chartUnit, chartUnit)}
              height={140}
            />
          )}
        </View>
      )}
    </View>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
