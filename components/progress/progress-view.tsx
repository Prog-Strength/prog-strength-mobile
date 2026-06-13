// Progress segment inside the Progress tab. Movement-pattern + timeframe
// selectors at the top, then stat tiles, then the SVG chart with a
// tap-to-inspect tooltip card below it, then the dual-mode table
// (1RM estimates × Sets × Reps × Weight).
//
// Layout adapted from web /progress:
//   - Movement-pattern pills and timeframe pills at the top (two rows).
//   - Stat tiles are 1×3 column on phones, no breakpoint flip.
//   - Tables are simplified: no fixed columns / horizontal scroll, just
//     a stacked card per row. Phone-screen reality.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { clearToken, getToken } from "@/lib/auth";
import {
  listProgression,
  listWorkouts,
  type ExerciseBaseline,
  type MuscleGroupProgression,
  type MuscleGroupProgressionPoint,
  type MovementPattern,
  type PerExerciseTrend,
  type Workout,
} from "@/lib/api";
import { exerciseColorMap, ProgressionChart } from "@/components/progress/progression-chart";

type Timeframe = "30d" | "60d" | "90d";

const TIMEFRAMES: { id: Timeframe; label: string; days: number }[] = [
  { id: "30d", label: "30d", days: 30 },
  { id: "60d", label: "60d", days: 60 },
  { id: "90d", label: "90d", days: 90 },
];

const MOVEMENT_PATTERNS: { id: MovementPattern; label: string }[] = [
  { id: "push", label: "Push" },
  { id: "pull", label: "Pull" },
  { id: "legs", label: "Legs" },
  { id: "core", label: "Core" },
  { id: "all", label: "All" },
];

type TableView = "estimates" | "sets";

export function ProgressView() {
  const router = useRouter();
  const [timeframe, setTimeframe] = useState<Timeframe>("90d");
  const [pattern, setPattern] = useState<MovementPattern>("all");
  const [progression, setProgression] = useState<MuscleGroupProgression | null>(null);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<MuscleGroupProgressionPoint | null>(null);

  useEffect(() => {
    // Stale guard: a rapid pattern/timeframe toggle re-runs this effect
    // while the previous fetch is in flight — without the flag, the
    // slower response would land its data under the newer selection.
    let stale = false;
    Promise.resolve(getToken())
      .then(async (t) => {
        if (!t) {
          router.replace("/login");
          return;
        }
        const days = TIMEFRAMES.find((x) => x.id === timeframe)?.days ?? 90;
        const until = new Date();
        const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
        const sinceISO = since.toISOString();
        const untilISO = until.toISOString();
        setLoading(true);
        setError(null);
        setSelectedPoint(null);
        const [prog, page] = await Promise.all([
          listProgression(t, pattern, sinceISO, untilISO),
          listWorkouts(t, { since: sinceISO, until: untilISO, limit: 100 }),
        ]);
        if (stale) return;
        setProgression(prog);
        setWorkouts(page.items);
      })
      .catch((err: Error) => {
        if (err.message.toLowerCase().includes("401")) {
          clearToken();
          router.replace("/login");
          return;
        }
        if (stale) return;
        setError(err.message);
        setProgression(null);
        setWorkouts([]);
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [timeframe, pattern, router]);

  return (
    <ScrollView contentContainerClassName="gap-3 px-4 pb-8" keyboardShouldPersistTaps="handled">
      <MovementPatternPills value={pattern} onChange={setPattern} />
      <TimeframePills value={timeframe} onChange={setTimeframe} />

      {error && (
        <View className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
          <Text className="text-xs text-danger">{error}</Text>
        </View>
      )}

      {loading && !progression && (
        <View className="items-center py-6">
          <ActivityIndicator />
        </View>
      )}

      {!loading && progression && progression.points.length === 0 && (
        <View className="rounded-lg border border-border bg-surface p-6">
          <Text className="text-center text-sm font-medium text-foreground">
            {pattern === "all"
              ? "No sessions in this window"
              : `No ${pattern} sessions in this window`}
          </Text>
          <Text className="mt-1 text-center text-xs text-muted">
            Log a few sessions via chat, or extend the timeframe.
          </Text>
        </View>
      )}

      {progression && progression.points.length > 0 && (
        <ProgressionContent
          progression={progression}
          workouts={workouts}
          selectedPoint={selectedPoint}
          onSelectPoint={setSelectedPoint}
        />
      )}
    </ScrollView>
  );
}

// --- selectors ----------------------------------------------------

function MovementPatternPills({
  value,
  onChange,
}: {
  value: MovementPattern;
  onChange: (v: MovementPattern) => void;
}) {
  return (
    <View className="flex-row gap-2">
      {MOVEMENT_PATTERNS.map((mp) => {
        const active = mp.id === value;
        return (
          <Pressable
            key={mp.id}
            onPress={() => onChange(mp.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            // py-2 + hitSlop clears the SOW's 44pt touch-target floor.
            hitSlop={{ top: 8, bottom: 8 }}
            className={`rounded-full border px-3 py-2 ${
              active ? "border-accent bg-accent/15" : "border-border bg-surface"
            } active:opacity-80`}
          >
            <Text className={`text-xs ${active ? "text-foreground" : "text-muted"}`}>
              {mp.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function TimeframePills({
  value,
  onChange,
}: {
  value: Timeframe;
  onChange: (v: Timeframe) => void;
}) {
  return (
    <View className="flex-row gap-2">
      {TIMEFRAMES.map((tf) => {
        const active = tf.id === value;
        return (
          <Pressable
            key={tf.id}
            onPress={() => onChange(tf.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            // py-2 + hitSlop clears the SOW's 44pt touch-target floor.
            hitSlop={{ top: 8, bottom: 8 }}
            className={`rounded-full border px-3 py-2 ${
              active ? "border-accent bg-accent" : "border-border bg-surface"
            } active:opacity-80`}
          >
            <Text className={`text-xs ${active ? "text-accent-fg" : "text-muted"}`}>
              Last {tf.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// --- main content -------------------------------------------------

function ProgressionContent({
  progression,
  workouts,
  selectedPoint,
  onSelectPoint,
}: {
  progression: MuscleGroupProgression;
  workouts: Workout[];
  selectedPoint: MuscleGroupProgressionPoint | null;
  onSelectPoint: (p: MuscleGroupProgressionPoint | null) => void;
}) {
  const { points, exercise_baselines, per_exercise_trends, aggregate } = progression;
  const colorMap = useMemo(() => exerciseColorMap(exercise_baselines), [exercise_baselines]);

  // Best session = highest normalized point in the window (most motivating
  // absolute number on the page). Matches web's definition exactly.
  const bestPoint = useMemo(
    () =>
      points.reduce<MuscleGroupProgressionPoint | null>(
        (acc, p) => (acc === null || p.normalized_max > acc.normalized_max ? p : acc),
        null,
      ),
    [points],
  );

  // Build a map from exercise_id → trend for O(1) legend lookups.
  const trendsByExerciseId = useMemo(() => {
    const m = new Map<string, PerExerciseTrend>();
    for (const t of per_exercise_trends) m.set(t.exercise_id, t);
    return m;
  }, [per_exercise_trends]);

  // "Below threshold" banner: every trend has null slope (not enough
  // sessions per exercise to fit a regression). Copy from web.
  const allBelowThreshold =
    per_exercise_trends.length > 0 && per_exercise_trends.every((t) => t.slope_per_month === null);

  const selectedKey = selectedPoint
    ? `${selectedPoint.workout_id}:${selectedPoint.exercise_id}`
    : null;

  return (
    <View className="gap-3">
      {/* Aggregate stat tiles — lifts progressing, median slope, best session */}
      <View className="flex-row gap-2">
        <StatTile
          value={
            aggregate !== null ? `${aggregate.lifts_progressing} / ${aggregate.lifts_tracked}` : "—"
          }
          label="Lifts progressing"
          tone={
            aggregate !== null
              ? progressTone(aggregate.lifts_progressing, aggregate.lifts_tracked)
              : "neutral"
          }
        />
        <StatTile
          value={aggregate !== null ? formatSlope(aggregate.median_slope_per_month) : "—"}
          label="Median per-exercise slope"
          tone={aggregate !== null ? slopeTone(aggregate.median_slope_per_month) : "neutral"}
        />
        <StatTile
          value={bestPoint ? `${Math.round(bestPoint.normalized_max * 100)}% of baseline` : "—"}
          label={
            bestPoint ? `Best session • ${formatDate(bestPoint.performed_at)}` : "Best session"
          }
        />
      </View>

      {allBelowThreshold && (
        <View className="rounded-md border border-border bg-surface px-3 py-2">
          <Text className="text-xs text-muted">
            You have at least 3 sessions needed per exercise to fit a trend. Keep logging —
            direction shows up around session 3.
          </Text>
        </View>
      )}

      <ProgressionChart
        points={points}
        trends={per_exercise_trends}
        baselines={exercise_baselines}
        selectedPointKey={selectedKey}
        onSelectPoint={onSelectPoint}
      />

      {selectedPoint && (
        <SelectedPointCard
          point={selectedPoint}
          color={colorMap.get(selectedPoint.exercise_id) ?? "#3b82f6"}
          onDismiss={() => onSelectPoint(null)}
        />
      )}

      <Legend
        baselines={exercise_baselines}
        colorMap={colorMap}
        trendsByExerciseId={trendsByExerciseId}
      />

      <TablesSection
        points={points}
        workouts={workouts}
        baselines={exercise_baselines}
        colorMap={colorMap}
      />
    </View>
  );
}

function StatTile({
  value,
  label,
  tone = "neutral",
}: {
  value: string;
  label: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-300"
      : tone === "negative"
        ? "text-danger"
        : "text-foreground";
  return (
    <View className="flex-1 rounded-lg border border-border bg-surface px-3 py-2">
      <Text className={`text-lg font-semibold tabular-nums ${toneClass}`}>{value}</Text>
      <Text
        className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted"
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

function SelectedPointCard({
  point,
  color,
  onDismiss,
}: {
  point: MuscleGroupProgressionPoint;
  color: string;
  onDismiss: () => void;
}) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(`/activities/workout/${point.workout_id}`)}
      onLongPress={onDismiss}
      accessibilityRole="button"
      className="gap-1 rounded-lg border border-border bg-surface p-3 active:opacity-80"
    >
      <View className="flex-row items-center gap-2">
        <View style={{ backgroundColor: color }} className="h-2 w-2 rounded-full" />
        <Text className="flex-1 text-sm font-medium text-foreground" numberOfLines={1}>
          {point.exercise_name}
        </Text>
        <Text className="text-[10px] uppercase tracking-wider text-muted">
          {formatDate(point.performed_at)}
        </Text>
      </View>
      <Text className="text-base font-semibold text-foreground">
        {formatPercent(point.normalized_max)} of baseline
      </Text>
      <Text className="text-xs text-muted">
        {formatNumber(point.avg_estimated_1rm)} {point.unit} avg · {point.set_count}{" "}
        {point.set_count === 1 ? "set" : "sets"}
        {point.max_estimated_1rm > point.avg_estimated_1rm &&
          ` · max ${formatNumber(point.max_estimated_1rm)} ${point.unit}`}
      </Text>
      <Text className="mt-1 text-xs text-accent">View workout →</Text>
    </Pressable>
  );
}

function Legend({
  baselines,
  colorMap,
  trendsByExerciseId,
}: {
  baselines: ExerciseBaseline[];
  colorMap: Map<string, string>;
  trendsByExerciseId: Map<string, PerExerciseTrend>;
}) {
  return (
    <View className="flex-row flex-wrap gap-x-3 gap-y-1.5">
      {baselines.map((b) => {
        const trend = trendsByExerciseId.get(b.exercise_id);
        const dir = directionLabel(trend);
        const slopeClass =
          dir.tone === "positive"
            ? "text-emerald-300"
            : dir.tone === "negative"
              ? "text-danger"
              : "text-muted";
        return (
          <View key={b.exercise_id} className="flex-row items-center gap-1.5">
            <View
              style={{ backgroundColor: colorMap.get(b.exercise_id) ?? "#3b82f6" }}
              className="h-2 w-3 rounded-full"
            />
            <Text className="text-[10px] text-muted">
              {b.exercise_name}
              {b.baseline > 0 ? ` · baseline ${formatNumber(b.baseline)} ${b.unit}` : ""}
              {"  "}
              <Text className={`text-[10px] ${slopeClass}`}>
                {dir.arrow ? `${dir.arrow} ` : ""}
                {dir.text}
              </Text>
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// --- tables -------------------------------------------------------

function TablesSection({
  points,
  workouts,
  baselines,
  colorMap,
}: {
  points: MuscleGroupProgressionPoint[];
  workouts: Workout[];
  baselines: ExerciseBaseline[];
  colorMap: Map<string, string>;
}) {
  const [view, setView] = useState<TableView>("estimates");
  const [filterExerciseID, setFilterExerciseID] = useState<string | null>(null);

  const baselineByID = useMemo(() => {
    const m = new Map<string, ExerciseBaseline>();
    for (const b of baselines) m.set(b.exercise_id, b);
    return m;
  }, [baselines]);

  const estimateRows = useMemo(() => {
    const filtered = filterExerciseID
      ? points.filter((p) => p.exercise_id === filterExerciseID)
      : points;
    return [...filtered].sort(
      (a, b) => new Date(b.performed_at).getTime() - new Date(a.performed_at).getTime(),
    );
  }, [points, filterExerciseID]);

  const setsRows = useMemo(() => buildSetsRows(workouts, baselineByID), [workouts, baselineByID]);
  const filteredSetsRows = useMemo(
    () =>
      filterExerciseID ? setsRows.filter((r) => r.exercise_id === filterExerciseID) : setsRows,
    [setsRows, filterExerciseID],
  );

  const estimateCountByExercise = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of points) {
      m.set(p.exercise_id, (m.get(p.exercise_id) ?? 0) + 1);
    }
    return m;
  }, [points]);
  const setsCountByExercise = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of setsRows) {
      m.set(r.exercise_id, (m.get(r.exercise_id) ?? 0) + 1);
    }
    return m;
  }, [setsRows]);
  const activeCounts = view === "estimates" ? estimateCountByExercise : setsCountByExercise;
  const activeTotal = view === "estimates" ? points.length : setsRows.length;

  return (
    <View className="gap-2 rounded-lg border border-border bg-surface p-3">
      <View className="flex-row gap-2">
        <ViewToggleButton
          active={view === "estimates"}
          onPress={() => setView("estimates")}
          label="1RM"
        />
        <ViewToggleButton
          active={view === "sets"}
          onPress={() => setView("sets")}
          label="Sets × Reps × Weight"
        />
      </View>

      <View className="flex-row flex-wrap gap-1.5">
        <FilterPill
          active={filterExerciseID === null}
          onPress={() => setFilterExerciseID(null)}
          label={`All (${activeTotal})`}
        />
        {baselines.map((b) => (
          <FilterPill
            key={b.exercise_id}
            active={filterExerciseID === b.exercise_id}
            onPress={() => setFilterExerciseID(b.exercise_id)}
            color={colorMap.get(b.exercise_id) ?? "#3b82f6"}
            label={`${b.exercise_name} (${activeCounts.get(b.exercise_id) ?? 0})`}
          />
        ))}
      </View>

      {view === "estimates" ? (
        <EstimatesRows rows={estimateRows} colorMap={colorMap} />
      ) : (
        <SetsRows rows={filteredSetsRows} colorMap={colorMap} />
      )}
    </View>
  );
}

function ViewToggleButton({
  active,
  onPress,
  label,
}: {
  active: boolean;
  onPress: () => void;
  label: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      className={`flex-1 rounded-full border px-3 py-1 ${
        active ? "border-accent bg-accent" : "border-border bg-background"
      } active:opacity-80`}
    >
      <Text
        className={`text-center text-xs font-medium ${active ? "text-accent-fg" : "text-muted"}`}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function FilterPill({
  active,
  onPress,
  label,
  color,
}: {
  active: boolean;
  onPress: () => void;
  label: string;
  color?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={`flex-row items-center gap-1.5 rounded-full border px-2.5 py-1 ${
        active ? "border-accent bg-accent/15" : "border-border bg-background"
      } active:opacity-80`}
    >
      {color && <View style={{ backgroundColor: color }} className="h-2 w-2 rounded-full" />}
      <Text className={`text-[10px] ${active ? "text-foreground" : "text-muted"}`}>{label}</Text>
    </Pressable>
  );
}

function EstimatesRows({
  rows,
  colorMap,
}: {
  rows: MuscleGroupProgressionPoint[];
  colorMap: Map<string, string>;
}) {
  const router = useRouter();
  if (rows.length === 0) {
    return (
      <Text className="py-4 text-center text-xs text-muted">
        No estimates for this exercise in the selected window.
      </Text>
    );
  }
  return (
    <View className="gap-1.5">
      {rows.map((p) => {
        const color = colorMap.get(p.exercise_id) ?? "#3b82f6";
        return (
          <Pressable
            key={`${p.workout_id}:${p.exercise_id}`}
            onPress={() => router.push(`/activities/workout/${p.workout_id}`)}
            accessibilityRole="button"
            className="flex-row items-center gap-2 rounded-md border border-border bg-background p-2 active:opacity-80"
          >
            <View style={{ backgroundColor: color }} className="h-2 w-2 rounded-full" />
            <View className="flex-1">
              <Text className="text-xs font-medium text-foreground" numberOfLines={1}>
                {p.exercise_name}
              </Text>
              <Text className="text-[10px] text-muted">
                {formatDate(p.performed_at)} · {p.set_count} {p.set_count === 1 ? "set" : "sets"}
              </Text>
            </View>
            <View className="items-end">
              <Text className="text-xs font-semibold tabular-nums text-foreground">
                {formatNumber(p.avg_estimated_1rm)} {p.unit}
              </Text>
              <Text className="text-[10px] tabular-nums text-muted">
                {formatPercent(p.normalized_max)}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

type SetsTableRow = {
  workout_id: string;
  exercise_id: string;
  exercise_name: string;
  performed_at: string;
  reps: number;
  weight: number;
  unit: "lb" | "kg";
  set_count: number;
};

function buildSetsRows(
  workouts: Workout[],
  baselineByID: Map<string, ExerciseBaseline>,
): SetsTableRow[] {
  const rows: SetsTableRow[] = [];
  for (const w of workouts) {
    for (const we of w.exercises) {
      const baseline = baselineByID.get(we.exercise_id);
      if (!baseline) continue;
      const groups = new Map<
        string,
        { reps: number; weight: number; unit: "lb" | "kg"; count: number }
      >();
      for (const s of we.sets) {
        const key = `${s.reps}|${s.weight}|${s.unit}`;
        const existing = groups.get(key);
        if (existing) existing.count++;
        else {
          groups.set(key, {
            reps: s.reps,
            weight: s.weight,
            unit: s.unit,
            count: 1,
          });
        }
      }
      for (const g of groups.values()) {
        rows.push({
          workout_id: w.id,
          exercise_id: we.exercise_id,
          exercise_name: baseline.exercise_name,
          performed_at: w.performed_at,
          reps: g.reps,
          weight: g.weight,
          unit: g.unit,
          set_count: g.count,
        });
      }
    }
  }
  rows.sort((a, b) => {
    const t = new Date(b.performed_at).getTime() - new Date(a.performed_at).getTime();
    if (t !== 0) return t;
    if (a.exercise_id !== b.exercise_id) return a.exercise_name.localeCompare(b.exercise_name);
    return b.weight - a.weight;
  });
  return rows;
}

function SetsRows({ rows, colorMap }: { rows: SetsTableRow[]; colorMap: Map<string, string> }) {
  const router = useRouter();
  if (rows.length === 0) {
    return (
      <Text className="py-4 text-center text-xs text-muted">
        No sets logged for this exercise in the selected window.
      </Text>
    );
  }
  return (
    <View className="gap-1.5">
      {rows.map((r, idx) => {
        const color = colorMap.get(r.exercise_id) ?? "#3b82f6";
        return (
          <Pressable
            key={`${r.workout_id}:${r.exercise_id}:${r.reps}:${r.weight}:${idx}`}
            onPress={() => router.push(`/activities/workout/${r.workout_id}`)}
            accessibilityRole="button"
            className="flex-row items-center gap-2 rounded-md border border-border bg-background p-2 active:opacity-80"
          >
            <View style={{ backgroundColor: color }} className="h-2 w-2 rounded-full" />
            <View className="flex-1">
              <Text className="text-xs font-medium text-foreground" numberOfLines={1}>
                {r.exercise_name}
              </Text>
              <Text className="text-[10px] text-muted">{formatDate(r.performed_at)}</Text>
            </View>
            <Text className="text-xs font-semibold tabular-nums text-foreground">
              {r.set_count} × {r.reps} @ {formatNumber(r.weight)} {r.unit}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// --- helpers ------------------------------------------------------

function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatPercent(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

/**
 * Signed one-decimal percent-per-month slope, e.g. "+1.4%/mo" / "−0.8%/mo".
 * Mirrors web's StatCards.formatSlope exactly (same sign/precision handling).
 * null or non-finite → "—".
 */
function formatSlope(slope: number | null): string {
  if (slope === null || !Number.isFinite(slope)) return "—";
  const sign = slope > 0 ? "+" : "";
  return `${sign}${slope.toFixed(1)}%/mo`;
}

/**
 * Tone for the "Lifts progressing" tile.
 * positive ≥ 0.5, negative ≤ 0.25, neutral in between.
 */
function progressTone(progressing: number, tracked: number): "positive" | "negative" | "neutral" {
  if (tracked <= 0) return "neutral";
  const ratio = progressing / tracked;
  if (ratio >= 0.5) return "positive";
  if (ratio <= 0.25) return "negative";
  return "neutral";
}

/**
 * Tone for the median slope tile. ±0.5 %/mo band matches legend thresholds.
 */
function slopeTone(slope: number | null): "positive" | "negative" | "neutral" {
  if (slope === null) return "neutral";
  if (slope > 0.5) return "positive";
  if (slope < -0.5) return "negative";
  return "neutral";
}

type Direction = {
  arrow: "↑" | "→" | "↓" | null;
  text: string;
  tone: "positive" | "negative" | "neutral";
};

/**
 * Map a per-exercise trend to its legend direction indicator.
 * Mirrors web's ProgressChart.directionLabel exactly (±0.5 thresholds).
 */
function directionLabel(trend: PerExerciseTrend | undefined): Direction {
  const slope = trend?.slope_per_month ?? null;
  if (slope === null || !Number.isFinite(slope)) {
    return { arrow: null, text: "not enough data", tone: "neutral" };
  }
  const sign = slope > 0 ? "+" : slope < 0 ? "−" : "";
  const magnitude = Math.abs(slope).toFixed(1);
  const text = `${sign}${magnitude}%/mo`;
  if (slope > 0.5) return { arrow: "↑", text, tone: "positive" };
  if (slope < -0.5) return { arrow: "↓", text, tone: "negative" };
  return { arrow: "→", text, tone: "neutral" };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
