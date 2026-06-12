// Progress segment inside the Progress tab. Muscle group + timeframe
// selectors at the top, then stat tiles, then the SVG chart with a
// tap-to-inspect tooltip card below it, then the dual-mode table
// (1RM estimates × Sets × Reps × Weight).
//
// Layout adapted from web /progress:
//   - Muscle-group pills wrap onto multiple rows on phone widths
//     (11 groups don't fit horizontally).
//   - Stat tiles are 1×3 column on phones, no breakpoint flip.
//   - Tables are simplified: no fixed columns / horizontal scroll, just
//     a stacked card per row. Phone-screen reality.
import { useEffect, useMemo, useState } from "react";
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
  listProgression,
  listWorkouts,
  type ExerciseBaseline,
  type MuscleGroupProgression,
  type MuscleGroupProgressionPoint,
  type Workout,
} from "@/lib/api";
import {
  exerciseColorMap,
  ProgressionChart,
} from "@/components/progress/progression-chart";

type Timeframe = "30d" | "60d" | "90d";

const TIMEFRAMES: { id: Timeframe; label: string; days: number }[] = [
  { id: "30d", label: "30d", days: 30 },
  { id: "60d", label: "60d", days: 60 },
  { id: "90d", label: "90d", days: 90 },
];

const MUSCLE_GROUPS: { id: string; label: string }[] = [
  { id: "chest", label: "Chest" },
  { id: "back", label: "Back" },
  { id: "shoulders", label: "Shoulders" },
  { id: "biceps", label: "Biceps" },
  { id: "triceps", label: "Triceps" },
  { id: "core", label: "Core" },
  { id: "quads", label: "Quads" },
  { id: "hamstrings", label: "Hamstrings" },
  { id: "glutes", label: "Glutes" },
  { id: "calves", label: "Calves" },
  { id: "forearms", label: "Forearms" },
];

type TableView = "estimates" | "sets";

export function ProgressView() {
  const router = useRouter();
  const [muscleGroup, setMuscleGroup] = useState<string>("chest");
  const [timeframe, setTimeframe] = useState<Timeframe>("90d");
  const [progression, setProgression] =
    useState<MuscleGroupProgression | null>(null);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPoint, setSelectedPoint] =
    useState<MuscleGroupProgressionPoint | null>(null);

  useEffect(() => {
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
          listProgression(t, muscleGroup, sinceISO, untilISO),
          listWorkouts(t, { since: sinceISO, until: untilISO, limit: 100 }),
        ]);
        setProgression(prog);
        setWorkouts(page.items);
      })
      .catch((err: Error) => {
        if (err.message.toLowerCase().includes("401")) {
          clearToken();
          router.replace("/login");
          return;
        }
        setError(err.message);
        setProgression(null);
        setWorkouts([]);
      })
      .finally(() => setLoading(false));
  }, [muscleGroup, timeframe, router]);

  return (
    <ScrollView
      contentContainerClassName="gap-3 px-4 pb-8"
      keyboardShouldPersistTaps="handled"
    >
      <MuscleGroupPills value={muscleGroup} onChange={setMuscleGroup} />
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
            No {muscleGroup} sessions in this window
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

function MuscleGroupPills({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-1.5 pt-1">
      {MUSCLE_GROUPS.map((mg) => {
        const active = mg.id === value;
        return (
          <Pressable
            key={mg.id}
            onPress={() => onChange(mg.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            className={`rounded-full border px-3 py-1 ${
              active
                ? "border-accent bg-accent"
                : "border-border bg-surface"
            } active:opacity-80`}
          >
            <Text
              className={`text-xs font-medium ${
                active ? "text-accent-fg" : "text-muted"
              }`}
            >
              {mg.label}
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
            className={`rounded-full border px-3 py-1 ${
              active
                ? "border-accent bg-accent"
                : "border-border bg-surface"
            } active:opacity-80`}
          >
            <Text
              className={`text-xs ${
                active ? "text-accent-fg" : "text-muted"
              }`}
            >
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
  const { points, trendline, exercise_baselines } = progression;
  const colorMap = useMemo(
    () => exerciseColorMap(exercise_baselines),
    [exercise_baselines],
  );

  // Stat tile values. Same definitions as web /progress so the
  // two implementations agree on what's "best."
  const trendPct =
    trendline && trendline.start_value > 0
      ? ((trendline.end_value - trendline.start_value) /
          trendline.start_value) *
        100
      : null;
  const bestPoint = useMemo(
    () =>
      points.reduce<MuscleGroupProgressionPoint | null>(
        (acc, p) =>
          acc === null || p.normalized_max > acc.normalized_max ? p : acc,
        null,
      ),
    [points],
  );
  const exerciseCount = useMemo(
    () => new Set(points.map((p) => p.exercise_id)).size,
    [points],
  );

  const selectedKey = selectedPoint
    ? `${selectedPoint.workout_id}:${selectedPoint.exercise_id}`
    : null;

  return (
    <View className="gap-3">
      <View className="flex-row gap-2">
        <StatTile
          value={formatChange(trendPct)}
          label="Trend"
          tone={
            trendPct === null
              ? "neutral"
              : trendPct > 0.5
                ? "positive"
                : trendPct < -0.5
                  ? "negative"
                  : "neutral"
          }
        />
        <StatTile
          value={
            bestPoint ? `${formatPercent(bestPoint.normalized_max)}` : "—"
          }
          label={bestPoint ? `Best · ${formatDate(bestPoint.performed_at)}` : "Best"}
        />
        <StatTile
          value={String(exerciseCount)}
          label={exerciseCount === 1 ? "Exercise" : "Exercises"}
        />
      </View>

      <ProgressionChart
        points={points}
        trendline={trendline}
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

      <Legend baselines={exercise_baselines} colorMap={colorMap} />

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
      <Text className={`text-lg font-semibold tabular-nums ${toneClass}`}>
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
        <View
          style={{ backgroundColor: color }}
          className="h-2 w-2 rounded-full"
        />
        <Text
          className="flex-1 text-sm font-medium text-foreground"
          numberOfLines={1}
        >
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
        {formatNumber(point.avg_estimated_1rm)} {point.unit} avg ·{" "}
        {point.set_count} {point.set_count === 1 ? "set" : "sets"}
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
}: {
  baselines: ExerciseBaseline[];
  colorMap: Map<string, string>;
}) {
  return (
    <View className="flex-row flex-wrap gap-x-3 gap-y-1">
      {baselines.map((b) => (
        <View
          key={b.exercise_id}
          className="flex-row items-center gap-1.5"
        >
          <View
            style={{ backgroundColor: colorMap.get(b.exercise_id) ?? "#3b82f6" }}
            className="h-2 w-3 rounded-full"
          />
          <Text className="text-[10px] text-muted">
            {b.exercise_name}
            {b.baseline > 0 ? ` · ${formatNumber(b.baseline)} ${b.unit}` : ""}
          </Text>
        </View>
      ))}
      <Text className="text-[10px] uppercase tracking-wider text-muted">
        Dashed = trend
      </Text>
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
      (a, b) =>
        new Date(b.performed_at).getTime() -
        new Date(a.performed_at).getTime(),
    );
  }, [points, filterExerciseID]);

  const setsRows = useMemo(
    () => buildSetsRows(workouts, baselineByID),
    [workouts, baselineByID],
  );
  const filteredSetsRows = useMemo(
    () =>
      filterExerciseID
        ? setsRows.filter((r) => r.exercise_id === filterExerciseID)
        : setsRows,
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
  const activeCounts =
    view === "estimates" ? estimateCountByExercise : setsCountByExercise;
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
        className={`text-center text-xs font-medium ${
          active ? "text-accent-fg" : "text-muted"
        }`}
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
      {color && (
        <View
          style={{ backgroundColor: color }}
          className="h-2 w-2 rounded-full"
        />
      )}
      <Text
        className={`text-[10px] ${
          active ? "text-foreground" : "text-muted"
        }`}
      >
        {label}
      </Text>
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
            <View
              style={{ backgroundColor: color }}
              className="h-2 w-2 rounded-full"
            />
            <View className="flex-1">
              <Text
                className="text-xs font-medium text-foreground"
                numberOfLines={1}
              >
                {p.exercise_name}
              </Text>
              <Text className="text-[10px] text-muted">
                {formatDate(p.performed_at)} · {p.set_count}{" "}
                {p.set_count === 1 ? "set" : "sets"}
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
    const t =
      new Date(b.performed_at).getTime() - new Date(a.performed_at).getTime();
    if (t !== 0) return t;
    if (a.exercise_id !== b.exercise_id)
      return a.exercise_name.localeCompare(b.exercise_name);
    return b.weight - a.weight;
  });
  return rows;
}

function SetsRows({
  rows,
  colorMap,
}: {
  rows: SetsTableRow[];
  colorMap: Map<string, string>;
}) {
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
            <View
              style={{ backgroundColor: color }}
              className="h-2 w-2 rounded-full"
            />
            <View className="flex-1">
              <Text
                className="text-xs font-medium text-foreground"
                numberOfLines={1}
              >
                {r.exercise_name}
              </Text>
              <Text className="text-[10px] text-muted">
                {formatDate(r.performed_at)}
              </Text>
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

function formatChange(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
