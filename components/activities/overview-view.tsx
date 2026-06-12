// Overview segment of the Activities hub. Shows hero + secondary stat tiles
// and a merged recent-activity list (workouts + runs), scoped to the active
// timeframe.
//
// ScrollView choice: the content is bounded — 8 tiles + up to 10 recent rows.
// FlatList's windowing overhead buys nothing here; ScrollView with
// RefreshControl matches workouts-view.tsx's list-header pattern and avoids
// the FlatList VirtualizedList nesting warning when ScrollView wraps it.
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { clearToken, getToken } from "@/lib/auth";
import {
  listRunningSessions,
  listWorkouts,
  type RunningSession,
  type Workout,
} from "@/lib/api";
import {
  convertWeight,
  formatDistance,
  formatPace,
  runFallbackName,
  type DistanceUnit,
} from "@/lib/units";
import { useProfile } from "@/lib/profile-context";
import { type Timeframe, timeframeBounds } from "./timeframe-pills";

// --- component -------------------------------------------------------

export function OverviewView({ timeframe }: { timeframe: Timeframe }) {
  const router = useRouter();
  const { profile } = useProfile();
  const weightUnit: "lb" | "kg" = profile?.weight_unit ?? "lb";
  const distanceUnit: DistanceUnit = profile?.distance_unit ?? "mi";

  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [runs, setRuns] = useState<RunningSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (opts: { refreshing?: boolean } = {}) => {
      if (opts.refreshing) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) {
          router.replace("/login");
          return;
        }
        const bounds = timeframeBounds(timeframe);
        const [wp, sp] = await Promise.all([
          listWorkouts(token, { ...bounds, limit: 100 }),
          listRunningSessions(token, bounds),
        ]);
        setWorkouts(wp.items);
        setRuns(sp.activities);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes("401")) {
          await clearToken();
          router.replace("/login");
          return;
        }
        setError(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router, timeframe],
  );

  // useFocusEffect covers initial load + refetch-on-tab-return.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading && workouts.length === 0 && runs.length === 0 && !error) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#fafafa" />
      </View>
    );
  }

  const stats = computeStats(workouts, runs, weightUnit);

  // Merge workouts + runs sorted newest-first, take 10.
  type ActivityItem =
    | { kind: "workout"; item: Workout }
    | { kind: "run"; item: RunningSession };

  const recent: ActivityItem[] = [
    ...workouts.map((w): ActivityItem => ({ kind: "workout", item: w })),
    ...runs.map((r): ActivityItem => ({ kind: "run", item: r })),
  ]
    .sort((a, b) => {
      const ta =
        a.kind === "workout"
          ? new Date(a.item.performed_at).getTime()
          : new Date(a.item.start_time).getTime();
      const tb =
        b.kind === "workout"
          ? new Date(b.item.performed_at).getTime()
          : new Date(b.item.start_time).getTime();
      return tb - ta;
    })
    .slice(0, 10);

  const isEmpty = workouts.length === 0 && runs.length === 0;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 pb-6 gap-3"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load({ refreshing: true })}
          tintColor="#fafafa"
        />
      }
    >
      {/* Error */}
      {error && (
        <View className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2">
          <Text className="text-sm text-danger">{error}</Text>
        </View>
      )}

      {!error && (
        <>
          {/* Hero row */}
          <View className="mt-3 flex-row flex-wrap gap-3">
            <StatTile label="Total time" value={formatTotalTime(stats.totalMs)} />
            <StatTile label="Sessions" value={String(stats.totalSessions)} />
            <StatTile label="Workouts" value={String(stats.workoutCount)} />
            <StatTile label="Runs" value={String(stats.runCount)} />
          </View>

          {/* Secondary row */}
          <View className="flex-row flex-wrap gap-3">
            <StatTile
              label={`Volume (${weightUnit})`}
              value={stats.totalVolume.toLocaleString("en-US", {
                maximumFractionDigits: 0,
              })}
            />
            <StatTile
              label={`Distance (${distanceUnit})`}
              value={`${formatDistance(stats.totalDistanceMeters, distanceUnit)} ${distanceUnit}`}
            />
            <StatTile label="PRs" value={String(stats.prCount)} />
            <StatTile
              label="Avg session"
              value={
                stats.totalSessions > 0
                  ? formatAvgSession(stats.totalMs / stats.totalSessions)
                  : "—"
              }
            />
          </View>

          {/* Recent activity list */}
          {isEmpty ? (
            <View className="rounded-lg border border-border bg-surface px-4 py-6">
              <Text className="text-center text-sm font-medium text-foreground">
                No activity in this window.
              </Text>
              <Text className="mt-1 text-center text-xs text-muted">
                Log a workout or import a .tcx run to get started.
              </Text>
            </View>
          ) : (
            <View className="gap-2">
              <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                Recent activity
              </Text>
              {recent.map((entry) =>
                entry.kind === "workout" ? (
                  <WorkoutRow
                    key={entry.item.id}
                    workout={entry.item}
                    onPress={() =>
                      router.push(`/activities/workout/${entry.item.id}`)
                    }
                  />
                ) : (
                  <RunRow
                    key={entry.item.id}
                    run={entry.item}
                    distanceUnit={distanceUnit}
                    onPress={() =>
                      router.push(`/activities/run/${entry.item.id}`)
                    }
                  />
                ),
              )}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

// --- stat computation ------------------------------------------------

type OverviewStats = {
  totalMs: number;
  totalSessions: number;
  workoutCount: number;
  runCount: number;
  totalVolume: number;
  totalDistanceMeters: number;
  prCount: number;
};

function computeStats(
  workouts: Workout[],
  runs: RunningSession[],
  weightUnit: "lb" | "kg",
): OverviewStats {
  // Total time: workout spans (ended_at present) + run duration_seconds.
  // Mirrors web's ActivitiesOverviewView: skip in-progress workouts, use ms.
  let workoutMs = 0;
  let totalVolume = 0;
  let prCount = 0;
  for (const w of workouts) {
    if (w.ended_at) {
      const ms =
        new Date(w.ended_at).getTime() - new Date(w.performed_at).getTime();
      if (ms > 0) workoutMs += ms;
    }
    totalVolume += workoutVolumeInUnit(w, weightUnit);
    prCount += w.personal_records_set.length;
  }

  let runMs = 0;
  let totalDistanceMeters = 0;
  for (const r of runs) {
    runMs += r.duration_seconds * 1000;
    totalDistanceMeters += r.distance_meters;
  }

  const totalMs = workoutMs + runMs;
  const workoutCount = workouts.length;
  const runCount = runs.length;
  const totalSessions = workoutCount + runCount;

  return {
    totalMs,
    totalSessions,
    workoutCount,
    runCount,
    totalVolume,
    totalDistanceMeters,
    prCount,
  };
}

/**
 * Volume math mirrors web's workout-volume.ts: Σ reps × weight across every
 * set, with each set's stored weight converted to the user's preferred unit
 * before summing. Bodyweight sets (weight=0) contribute 0.
 */
function workoutVolumeInUnit(workout: Workout, to: "lb" | "kg"): number {
  let total = 0;
  for (const ex of workout.exercises) {
    for (const s of ex.sets) {
      total += s.reps * convertWeight(s.weight, s.unit, to);
    }
  }
  return total;
}

// --- time formatters -------------------------------------------------

/**
 * Milliseconds → "Xh Ym" (when ≥1 h) or "Ym" (< 1 h).
 * "0m" when zero. Matches web's formatHours contract.
 */
function formatTotalTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Average session ms → "Xm". */
function formatAvgSession(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  return `${Math.round(ms / 60000)}m`;
}

// --- sub-components --------------------------------------------------

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    // ~47% width mirrors running-view.tsx MetricTile: (100% - gap) / 2
    <View
      style={{ flexBasis: "47%" }}
      className="rounded-lg border border-border bg-surface px-3 py-3"
    >
      <Text
        className="text-base font-semibold tabular-nums text-foreground"
        numberOfLines={1}
      >
        {value}
      </Text>
      <Text
        className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted"
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

// Accent blue #3b82f6 for workouts, teal #2dd4bf for runs — matches calendar
// color convention specified in the task.
const ACCENT_WORKOUT = "#3b82f6";
const ACCENT_RUN = "#2dd4bf";

function WorkoutRow({
  workout,
  onPress,
}: {
  workout: Workout;
  onPress: () => void;
}) {
  const name =
    workout.name && workout.name.trim().length > 0 ? workout.name : "Workout";
  const dateLabel = formatActivityDate(workout.performed_at);
  const exerciseCount = workout.exercises.length;
  const stat = `${exerciseCount} ${exerciseCount === 1 ? "exercise" : "exercises"}`;

  return (
    <ActivityRow
      accentColor={ACCENT_WORKOUT}
      name={name}
      dateLabel={dateLabel}
      stat={stat}
      onPress={onPress}
    />
  );
}

function RunRow({
  run,
  distanceUnit,
  onPress,
}: {
  run: RunningSession;
  distanceUnit: DistanceUnit;
  onPress: () => void;
}) {
  const name =
    run.name && run.name.trim().length > 0
      ? run.name
      : runFallbackName(run.start_time);
  const dateLabel = formatActivityDate(run.start_time);
  const distance = `${formatDistance(run.distance_meters, distanceUnit)} ${distanceUnit}`;
  const pace =
    run.avg_pace_sec_per_km != null
      ? `${formatPace(run.avg_pace_sec_per_km, distanceUnit)} /${distanceUnit}`
      : null;
  const stat = [distance, pace].filter(Boolean).join(" · ");

  return (
    <ActivityRow
      accentColor={ACCENT_RUN}
      name={name}
      dateLabel={dateLabel}
      stat={stat}
      onPress={onPress}
    />
  );
}

function ActivityRow({
  accentColor,
  name,
  dateLabel,
  stat,
  onPress,
}: {
  accentColor: string;
  name: string;
  dateLabel: string;
  stat: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // 44pt touch target per HIG
      style={{ minHeight: 44 }}
      className="flex-row items-center overflow-hidden rounded-lg border border-border bg-surface active:opacity-80"
    >
      {/* Colored left bar distinguishing workouts (accent) from runs (teal) */}
      <View style={{ width: 4, alignSelf: "stretch", backgroundColor: accentColor }} />
      <View className="flex-1 flex-row items-center gap-2 px-3 py-3">
        <View className="flex-1 gap-0.5">
          <View className="flex-row items-baseline justify-between gap-2">
            <Text
              numberOfLines={1}
              className="flex-1 text-base font-medium text-foreground"
            >
              {name}
            </Text>
            <Text className="text-xs text-muted">{dateLabel}</Text>
          </View>
          <Text numberOfLines={1} className="text-xs text-muted">
            {stat}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#6b7280" />
      </View>
    </Pressable>
  );
}

// --- helpers ---------------------------------------------------------

function formatActivityDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
