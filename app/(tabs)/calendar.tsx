// Calendar tab — month grid up top, agenda list below. Mirrors the
// Apple Calendar app's pattern for small screens: the grid is dense
// and information-light (a dot under each day that has a workout),
// the agenda below carries the detail. Tapping a day moves the
// selection + scrolls the agenda; tapping a workout in the agenda
// pushes the existing /activities/workout/[id] detail screen.
//
// All date math is local-time (per the SOW's TZ decision). The API
// query uses UTC bounds derived from the local-day boundaries of the
// visible 6-week grid — that range covers up to 11 days outside the
// current month, which is what the grid's leading/trailing cells
// belong to.
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { clearToken, getToken } from "@/lib/auth";
import {
  listWorkouts,
  listRunningSessions,
  type Exercise,
  type Workout,
  type RunningSession,
} from "@/lib/api";
import { useExerciseCatalog } from "@/components/exercise-catalog-context";
import { useProfile } from "@/lib/profile-context";
import {
  formatDistance,
  formatPace,
  formatRunDuration,
  formatWeight,
  runFallbackName,
  type DistanceUnit,
} from "@/lib/units";

// 7-column header. Monday-first because that's how the lifter
// mentally chunks a training week (Monday = start of the program
// week). Web calendar's day order should follow if/when it adopts
// the same grid.
const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

// Teal #2dd4bf is Tailwind's built-in teal-400; NativeWind exposes it
// via bg-teal-400. The class is used for run dots and run agenda rows.
const TEAL = "#2dd4bf";

export default function CalendarScreen() {
  const router = useRouter();
  const { byID: exerciseByID } = useExerciseCatalog();
  const { profile } = useProfile();
  const distanceUnit: DistanceUnit = profile?.distance_unit ?? "mi";
  // undefined while the profile loads — call sites fall back to each
  // set's own logged unit rather than assuming lb.
  const preferredWeightUnit = profile?.weight_unit;

  const [monthAnchor, setMonthAnchor] = useState<Date>(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date>(() => startOfLocalDay(new Date()));
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [runs, setRuns] = useState<RunningSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 42 cells (6 rows × 7 cols) covering the visible month plus any
  // trailing days of the previous month and leading days of the next.
  // Stable per monthAnchor change; recompute is trivial but caching
  // it via useMemo keeps the grid render referentially stable.
  const grid = useMemo(() => buildMonthGrid(monthAnchor), [monthAnchor]);
  const gridStart = grid[0];
  // useMemo is load-bearing: addDays returns a fresh Date instance, so
  // an inline computation here would yield a new reference each render,
  // invalidate the useCallback below, re-fire useFocusEffect, and
  // re-fetch in an infinite loop.
  const gridEnd = useMemo(() => addDays(grid[grid.length - 1], 1), [grid]);

  const load = useCallback(
    async (since: Date, until: Date) => {
      const token = await getToken();
      if (!token) {
        router.replace("/login");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        // Fetch workouts and running sessions in parallel for the same
        // grid window. The workouts call caps at limit=100 (~3 sessions/
        // day over a 42-day window, plenty of headroom); the runs call
        // uses range mode, which is uncapped. Pagination not needed at
        // single-user scale.
        const [workoutPage, runsPage] = await Promise.all([
          listWorkouts(token, {
            since: since.toISOString(),
            until: until.toISOString(),
            limit: 100,
          }),
          listRunningSessions(token, {
            since: since.toISOString(),
            until: until.toISOString(),
          }),
        ]);
        setWorkouts(workoutPage.items);
        setRuns(runsPage.activities);
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
      }
    },
    [router],
  );

  // useFocusEffect fires on first focus *and* whenever its callback
  // identity changes — covering both initial mount, month navigation,
  // and tab-return. A separate useEffect would double-fire on mount.
  useFocusEffect(
    useCallback(() => {
      load(gridStart, gridEnd);
    }, [load, gridStart, gridEnd]),
  );

  // Bucket workouts by local YYYY-MM-DD for O(1) "does this day have
  // workouts?" lookups during grid render. Keyed by local date string
  // so multi-workout days collapse into one bucket regardless of UTC
  // performed_at differences within the day.
  const workoutsByDay = useMemo(() => {
    const m = new Map<string, Workout[]>();
    for (const w of workouts) {
      const key = localDateKey(new Date(w.performed_at));
      const arr = m.get(key);
      if (arr) arr.push(w);
      else m.set(key, [w]);
    }
    // Sort each day's workouts most-recent-first.
    for (const [, arr] of m) {
      arr.sort((a, b) => new Date(b.performed_at).getTime() - new Date(a.performed_at).getTime());
    }
    return m;
  }, [workouts]);

  // Bucket runs by local YYYY-MM-DD, keyed on start_time.
  const runsByDay = useMemo(() => {
    const m = new Map<string, RunningSession[]>();
    for (const r of runs) {
      const key = localDateKey(new Date(r.start_time));
      const arr = m.get(key);
      if (arr) arr.push(r);
      else m.set(key, [r]);
    }
    // Sort each day's runs most-recent-first.
    for (const [, arr] of m) {
      arr.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
    }
    return m;
  }, [runs]);

  const selectedDayWorkouts = workoutsByDay.get(localDateKey(selectedDay)) ?? [];
  const selectedDayRuns = runsByDay.get(localDateKey(selectedDay)) ?? [];

  return (
    <View className="flex-1 bg-background">
      <MonthHeader
        anchor={monthAnchor}
        onPrev={() => setMonthAnchor((d) => addMonths(d, -1))}
        onNext={() => setMonthAnchor((d) => addMonths(d, 1))}
        onToday={() => {
          const today = startOfLocalDay(new Date());
          setMonthAnchor(startOfMonth(today));
          setSelectedDay(today);
        }}
      />

      <DayLabelsRow />

      <MonthGrid
        grid={grid}
        monthAnchor={monthAnchor}
        selectedDay={selectedDay}
        workoutsByDay={workoutsByDay}
        runsByDay={runsByDay}
        onSelect={setSelectedDay}
      />

      <View className="h-px bg-border" />

      {error && (
        <View className="mx-4 mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
          <Text className="text-xs text-danger">{error}</Text>
        </View>
      )}

      <Agenda
        selectedDay={selectedDay}
        workouts={selectedDayWorkouts}
        runs={selectedDayRuns}
        exerciseByID={exerciseByID}
        loading={loading}
        distanceUnit={distanceUnit}
        preferredWeightUnit={preferredWeightUnit}
        onPressWorkout={(id) => router.push(`/activities/workout/${id}`)}
        onPressRun={(id) => router.push(`/activities/run/${id}`)}
      />
    </View>
  );
}

// --- Header --------------------------------------------------------

function MonthHeader({
  anchor,
  onPrev,
  onNext,
  onToday,
}: {
  anchor: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <View className="flex-row items-center justify-between gap-3 px-4 py-3">
      <View className="flex-row items-center gap-2">
        <NavButton onPress={onPrev} label="‹" accessibilityLabel="Previous month" />
        <Text className="text-base font-semibold text-foreground">{formatMonthYear(anchor)}</Text>
        <NavButton onPress={onNext} label="›" accessibilityLabel="Next month" />
      </View>
      <Pressable
        onPress={onToday}
        accessibilityRole="button"
        className="rounded-full border border-border bg-surface px-3 py-1 active:opacity-80"
      >
        <Text className="text-xs font-medium text-foreground">Today</Text>
      </Pressable>
    </View>
  );
}

function NavButton({
  onPress,
  label,
  accessibilityLabel,
}: {
  onPress: () => void;
  label: string;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className="h-8 w-8 items-center justify-center rounded-full border border-border bg-surface active:opacity-80"
    >
      <Text className="text-base font-semibold text-foreground">{label}</Text>
    </Pressable>
  );
}

// --- Day-labels row -----------------------------------------------

function DayLabelsRow() {
  return (
    <View className="flex-row px-2 pb-1">
      {DAY_LABELS.map((label, i) => (
        <View key={i} className="flex-1 items-center">
          <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}

// --- Grid ---------------------------------------------------------

function MonthGrid({
  grid,
  monthAnchor,
  selectedDay,
  workoutsByDay,
  runsByDay,
  onSelect,
}: {
  grid: Date[];
  monthAnchor: Date;
  selectedDay: Date;
  workoutsByDay: Map<string, Workout[]>;
  runsByDay: Map<string, RunningSession[]>;
  onSelect: (d: Date) => void;
}) {
  const today = startOfLocalDay(new Date());
  // 42 cells laid out as 6 explicit rows of 7 cells at flex-1 each
  // — same primitive the DayLabelsRow uses above, so columns line
  // up by construction. Earlier revisions used a single
  // `flex-row flex-wrap` container with `w-[14.2857%]` per cell,
  // but the percentage rounding produced rows that didn't perfectly
  // match the labels row's flex-1 columns, shifting dates a column
  // or two away from their day-of-week.
  const rows: Date[][] = [];
  for (let r = 0; r < 6; r++) {
    rows.push(grid.slice(r * 7, r * 7 + 7));
  }
  return (
    <View className="px-2">
      {rows.map((row, rowIdx) => (
        <View key={rowIdx} className="flex-row">
          {row.map((d) => {
            const inMonth = d.getMonth() === monthAnchor.getMonth();
            const isToday = sameLocalDay(d, today);
            const isSelected = sameLocalDay(d, selectedDay);
            const key = localDateKey(d);
            const hasWorkouts = (workoutsByDay.get(key)?.length ?? 0) > 0;
            const hasRuns = (runsByDay.get(key)?.length ?? 0) > 0;
            return (
              <Pressable
                key={d.toISOString()}
                onPress={() => onSelect(startOfLocalDay(d))}
                accessibilityRole="button"
                accessibilityLabel={d.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
                className="h-12 flex-1 items-center justify-center"
              >
                <View
                  className={`h-9 w-9 items-center justify-center rounded-full ${
                    isSelected ? "bg-accent" : isToday ? "border border-accent/60" : ""
                  }`}
                >
                  <Text
                    className={`text-sm tabular-nums ${
                      isSelected
                        ? "font-semibold text-accent-fg"
                        : inMonth
                          ? "text-foreground"
                          : "text-muted/60"
                    }`}
                  >
                    {d.getDate()}
                  </Text>
                </View>
                {/* Dot row: workout dot (accent/white) + run dot (teal), side by side */}
                {(hasWorkouts || hasRuns) && (
                  <View className="mt-0.5 flex-row items-center gap-0.5">
                    {hasWorkouts && (
                      <View
                        className={`h-1 w-1 rounded-full ${
                          isSelected ? "bg-accent-fg" : "bg-accent"
                        }`}
                      />
                    )}
                    {hasRuns && <View className="h-1 w-1 rounded-full bg-teal-400" />}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// --- Agenda -------------------------------------------------------

/**
 * At-a-glance summary line: "2 activities · 1 run · 1 lift".
 * Zero parts are omitted (no "0 runs"); every part is singular/plural
 * correct. Mirrors web's day-digest.tsx countLine function exactly.
 */
function countLine(total: number, runs: number, lifts: number): string {
  const activityLabel = `${total} ${total === 1 ? "activity" : "activities"}`;
  const parts: string[] = [];
  if (runs > 0) parts.push(`${runs} ${runs === 1 ? "run" : "runs"}`);
  if (lifts > 0) parts.push(`${lifts} ${lifts === 1 ? "lift" : "lifts"}`);
  return parts.length > 0 ? `${activityLabel} · ${parts.join(" · ")}` : activityLabel;
}

function Agenda({
  selectedDay,
  workouts,
  runs,
  exerciseByID,
  loading,
  distanceUnit,
  preferredWeightUnit,
  onPressWorkout,
  onPressRun,
}: {
  selectedDay: Date;
  workouts: Workout[];
  runs: RunningSession[];
  exerciseByID: Map<string, Exercise>;
  loading: boolean;
  distanceUnit: DistanceUnit;
  preferredWeightUnit: "lb" | "kg" | undefined;
  onPressWorkout: (id: string) => void;
  onPressRun: (id: string) => void;
}) {
  const hasItems = workouts.length > 0 || runs.length > 0;
  const total = workouts.length + runs.length;

  return (
    <ScrollView className="flex-1" contentContainerClassName="px-4 py-3 gap-3">
      <View>
        <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          {selectedDay.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </Text>
        {hasItems && (
          <Text className="mt-0.5 text-xs text-muted">
            {countLine(total, runs.length, workouts.length)}
          </Text>
        )}
      </View>

      {loading && !hasItems && (
        <View className="items-center py-6">
          <ActivityIndicator color="#fafafa" />
        </View>
      )}

      {!loading && !hasItems && (
        <View className="rounded-lg border border-border bg-surface px-4 py-6">
          <Text className="text-center text-sm font-medium text-foreground">
            No activities on this day
          </Text>
          <Text className="mt-1 text-center text-xs text-muted">
            Pick another day from the grid, or log a session from the Chat tab.
          </Text>
        </View>
      )}

      {workouts.map((w) => (
        <WorkoutRow
          key={w.id}
          workout={w}
          exerciseByID={exerciseByID}
          preferredWeightUnit={preferredWeightUnit}
          onPress={() => onPressWorkout(w.id)}
        />
      ))}

      {runs.map((r) => (
        <RunRow key={r.id} run={r} distanceUnit={distanceUnit} onPress={() => onPressRun(r.id)} />
      ))}
    </ScrollView>
  );
}

// --- Workout agenda row -------------------------------------------

/**
 * Agenda row for a workout. Tapping the main area navigates; tapping
 * the chevron on the right expands/collapses an inline exercise breakdown.
 * Both zones are ≥44pt (minHeight on the row + hitSlop on the chevron).
 */
function WorkoutRow({
  workout,
  exerciseByID,
  preferredWeightUnit,
  onPress,
}: {
  workout: Workout;
  exerciseByID: Map<string, Exercise>;
  preferredWeightUnit: "lb" | "kg" | undefined;
  onPress: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const title =
    workout.name && workout.name.trim().length > 0
      ? workout.name.trim()
      : new Date(workout.performed_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });

  const names = workout.exercises
    .map((we) => exerciseByID.get(we.exercise_id)?.name ?? we.exercise_id)
    .filter(Boolean);
  const summary =
    names.length === 0
      ? "No exercises"
      : names.length <= 3
        ? names.join(" · ")
        : `${names.slice(0, 3).join(" · ")} +${names.length - 3} more`;

  const setCount = workout.exercises.reduce((n, we) => n + we.sets.length, 0);

  return (
    <View className="overflow-hidden rounded-lg border border-border bg-surface">
      <View className="flex-row" style={{ minHeight: 44 }}>
        {/* Main tap area — navigates to detail */}
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`View workout: ${title}`}
          className="flex-1 px-4 py-3 active:opacity-80"
        >
          <View className="flex-row items-baseline justify-between gap-3">
            <Text numberOfLines={1} className="flex-1 text-sm font-semibold text-foreground">
              {title}
            </Text>
          </View>
          <Text numberOfLines={2} className="mt-0.5 text-xs text-muted">
            {summary}
          </Text>
          <Text className="mt-1 text-[10px] uppercase tracking-wider text-muted">
            {setCount} {setCount === 1 ? "set" : "sets"}
          </Text>
        </Pressable>
        {/* Chevron — toggles expansion */}
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Collapse details" : "Expand details"}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          className="items-center justify-center px-3 active:opacity-60"
          style={{ minWidth: 44 }}
        >
          <Text
            className="text-base text-muted"
            style={{
              transform: [{ rotate: expanded ? "180deg" : "0deg" }],
            }}
          >
            ›
          </Text>
        </Pressable>
      </View>

      {/* Expanded workout details */}
      {expanded && (
        <View className="border-t border-border px-4 py-3 gap-2">
          {workout.exercises.map((we) => {
            const exName = exerciseByID.get(we.exercise_id)?.name ?? we.exercise_id;
            const sc = we.sets.length;
            // Top set: highest weight
            const topSet =
              we.sets.length > 0
                ? we.sets.reduce((best, s) => (s.weight > best.weight ? s : best), we.sets[0])
                : null;
            const topSetStr = topSet
              ? formatWeight(topSet.weight, topSet.unit, preferredWeightUnit ?? topSet.unit)
              : null;
            return (
              <View
                key={we.exercise_id + String(we.order)}
                className="flex-row items-baseline justify-between gap-3"
              >
                <Text className="flex-1 text-xs text-foreground" numberOfLines={1}>
                  {exName}
                </Text>
                <Text className="text-xs text-muted">
                  {sc} {sc === 1 ? "set" : "sets"}
                  {topSetStr ? ` · ${topSetStr}` : ""}
                </Text>
              </View>
            );
          })}
          {workout.exercises.length === 0 && (
            <Text className="text-xs text-muted">No exercises logged</Text>
          )}
          {workout.notes && workout.notes.trim().length > 0 && (
            <Text className="mt-1 text-xs text-muted italic">{workout.notes.trim()}</Text>
          )}
        </View>
      )}
    </View>
  );
}

// --- Run agenda row -----------------------------------------------

/**
 * Agenda row for a run. Tapping the main area navigates; tapping the
 * chevron on the right expands/collapses a stat breakdown. Both zones
 * are ≥44pt (minHeight on the row + hitSlop on the chevron).
 */
function RunRow({
  run,
  distanceUnit,
  onPress,
}: {
  run: RunningSession;
  distanceUnit: DistanceUnit;
  onPress: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const name =
    run.name && run.name.trim().length > 0 ? run.name.trim() : runFallbackName(run.start_time);
  const distStr = `${formatDistance(run.distance_meters, distanceUnit)} ${distanceUnit}`;
  const paceStr = formatPace(run.avg_pace_sec_per_km, distanceUnit);
  const hasPace = paceStr !== "—";

  const startDate = new Date(run.start_time);
  const timeStr = startDate.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const subtitle = hasPace
    ? `${timeStr} · ${distStr} · ${paceStr} /${distanceUnit}`
    : `${timeStr} · ${distStr}`;

  // Elevation: convert to ft when distance unit is mi (mirrors web run-digest)
  const FEET_PER_METER = 3.28084;
  const elevStr =
    run.elevation_gain_meters != null
      ? distanceUnit === "mi"
        ? `${Math.round(run.elevation_gain_meters * FEET_PER_METER)} ft`
        : `${Math.round(run.elevation_gain_meters)} m`
      : "—";

  return (
    <View className="overflow-hidden rounded-lg border border-border bg-surface">
      <View className="flex-row" style={{ minHeight: 44 }}>
        {/* Teal left accent bar */}
        <View style={{ width: 4, backgroundColor: TEAL }} />
        {/* Main tap area — navigates to detail */}
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`View run: ${name}`}
          className="flex-1 justify-center px-3 py-2 active:opacity-80"
        >
          <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
            {name}
          </Text>
          <Text className="mt-0.5 text-xs text-muted" numberOfLines={1}>
            {subtitle}
          </Text>
        </Pressable>
        {/* Chevron — toggles expansion */}
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Collapse details" : "Expand details"}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          className="items-center justify-center px-3 active:opacity-60"
          style={{ minWidth: 44 }}
        >
          <Text
            className="text-base text-muted"
            style={{
              transform: [{ rotate: expanded ? "180deg" : "0deg" }],
            }}
          >
            ›
          </Text>
        </Pressable>
      </View>

      {/* Expanded run stats */}
      {expanded && (
        <View className="border-t border-border px-4 py-3 gap-1.5">
          <RunStatRow label="Duration" value={formatRunDuration(run.duration_seconds)} />
          <RunStatRow label="Avg pace" value={hasPace ? `${paceStr} /${distanceUnit}` : "—"} />
          <RunStatRow
            label="Avg HR"
            value={run.avg_heart_rate_bpm != null ? `${run.avg_heart_rate_bpm} bpm` : "—"}
          />
          <RunStatRow
            label="Max HR"
            value={run.max_heart_rate_bpm != null ? `${run.max_heart_rate_bpm} bpm` : "—"}
          />
          <RunStatRow
            label="Calories"
            value={run.total_calories != null ? String(run.total_calories) : "—"}
          />
          <RunStatRow label="Elev gain" value={elevStr} />
        </View>
      )}
    </View>
  );
}

function RunStatRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-baseline justify-between gap-4">
      <Text className="text-xs text-muted">{label}</Text>
      <Text className="text-xs tabular-nums text-foreground">{value}</Text>
    </View>
  );
}

// --- helpers ------------------------------------------------------

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + n);
  return startOfMonth(out);
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Local YYYY-MM-DD key. Used to bucket workouts by display-day so a
// workout logged at 11:59pm local sits with that day's entries
// regardless of where it falls on the UTC clock.
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMonthYear(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// buildMonthGrid returns 42 Date entries: the leading partial week
// from the previous month, every day of the anchor's month, and the
// trailing partial week from the next month. Always 6 rows × 7 cols
// even when the month fits in 5 — keeps the grid height stable so
// the agenda below doesn't jump when navigating months.
function buildMonthGrid(anchor: Date): Date[] {
  const first = startOfMonth(anchor);
  // getDay() returns 0..6 with 0 = Sunday. For a Monday-first grid we
  // want Monday to sit in column 0, so the rotation is
  //   Sun(0) -> 6, Mon(1) -> 0, Tue(2) -> 1, ..., Sat(6) -> 5.
  // (getDay() + 6) % 7 expresses that. `lead` is the count of leading
  // trailing-from-previous-month cells we back up by.
  const lead = (first.getDay() + 6) % 7;
  const start = addDays(first, -lead);
  const out: Date[] = [];
  for (let i = 0; i < 42; i++) {
    out.push(addDays(start, i));
  }
  return out;
}
