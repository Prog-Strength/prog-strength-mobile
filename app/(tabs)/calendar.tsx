// Calendar tab — month grid up top, agenda list below. Mirrors the
// Apple Calendar app's pattern for small screens: the grid is dense
// and information-light (a dot under each day that has a workout),
// the agenda below carries the detail. Tapping a day moves the
// selection + scrolls the agenda; tapping a workout in the agenda
// pushes the existing /workouts/[id] detail screen.
//
// All date math is local-time (per the SOW's TZ decision). The API
// query uses UTC bounds derived from the local-day boundaries of the
// visible 6-week grid — that range covers up to 11 days outside the
// current month, which is what the grid's leading/trailing cells
// belong to.
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { clearToken, getToken } from "@/lib/auth";
import { listWorkouts, type Exercise, type Workout } from "@/lib/api";
import { WorkoutRow } from "@/components/workout-row";
import { useExerciseCatalog } from "@/components/exercise-catalog-context";

// 7-column header. Sunday-first matches the US convention the web
// calendar uses too.
const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export default function CalendarScreen() {
  const router = useRouter();
  const { byID: exerciseByID } = useExerciseCatalog();
  const [monthAnchor, setMonthAnchor] = useState<Date>(() =>
    startOfMonth(new Date()),
  );
  const [selectedDay, setSelectedDay] = useState<Date>(() =>
    startOfLocalDay(new Date()),
  );
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 42 cells (6 rows × 7 cols) covering the visible month plus any
  // trailing days of the previous month and leading days of the next.
  // Stable per monthAnchor change; recompute is trivial but caching
  // it via useMemo keeps the grid render referentially stable.
  const grid = useMemo(() => buildMonthGrid(monthAnchor), [monthAnchor]);
  const gridStart = grid[0];
  const gridEnd = addDays(grid[grid.length - 1], 1); // exclusive upper bound

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
        // limit=100 covers ~3 workouts/day for a 42-day window with
        // plenty of headroom. Pagination not needed at single-user scale.
        const page = await listWorkouts(token, {
          since: since.toISOString(),
          until: until.toISOString(),
          limit: 100,
        });
        setWorkouts(page.items);
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
      arr.sort(
        (a, b) =>
          new Date(b.performed_at).getTime() -
          new Date(a.performed_at).getTime(),
      );
    }
    return m;
  }, [workouts]);

  const selectedDayWorkouts =
    workoutsByDay.get(localDateKey(selectedDay)) ?? [];

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
        exerciseByID={exerciseByID}
        loading={loading}
        onPressWorkout={(id) => router.push(`/workouts/${id}`)}
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
        <NavButton
          onPress={onPrev}
          label="‹"
          accessibilityLabel="Previous month"
        />
        <Text className="text-base font-semibold text-foreground">
          {formatMonthYear(anchor)}
        </Text>
        <NavButton
          onPress={onNext}
          label="›"
          accessibilityLabel="Next month"
        />
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
  onSelect,
}: {
  grid: Date[];
  monthAnchor: Date;
  selectedDay: Date;
  workoutsByDay: Map<string, Workout[]>;
  onSelect: (d: Date) => void;
}) {
  const today = startOfLocalDay(new Date());
  // 42 cells in 6 rows of 7. We render as one View with flex-wrap so
  // each cell can carry width: 14.28% (1/7). The fixed cell height
  // (h-12) is what gives the grid its grid-iness without measuring
  // the viewport.
  return (
    <View className="flex-row flex-wrap px-2">
      {grid.map((d, i) => {
        const inMonth = d.getMonth() === monthAnchor.getMonth();
        const isToday = sameLocalDay(d, today);
        const isSelected = sameLocalDay(d, selectedDay);
        const hasWorkouts =
          (workoutsByDay.get(localDateKey(d))?.length ?? 0) > 0;
        return (
          <Pressable
            key={i}
            onPress={() => onSelect(startOfLocalDay(d))}
            accessibilityRole="button"
            accessibilityLabel={d.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
            className="h-12 w-[14.2857%] items-center justify-center"
          >
            <View
              className={`h-9 w-9 items-center justify-center rounded-full ${
                isSelected
                  ? "bg-accent"
                  : isToday
                    ? "border border-accent/60"
                    : ""
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
            {hasWorkouts && (
              <View
                className={`mt-0.5 h-1 w-1 rounded-full ${
                  isSelected ? "bg-accent-fg" : "bg-accent"
                }`}
              />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

// --- Agenda -------------------------------------------------------

function Agenda({
  selectedDay,
  workouts,
  exerciseByID,
  loading,
  onPressWorkout,
}: {
  selectedDay: Date;
  workouts: Workout[];
  exerciseByID: Map<string, Exercise>;
  loading: boolean;
  onPressWorkout: (id: string) => void;
}) {
  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="px-4 py-3 gap-3"
    >
      <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
        {selectedDay.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })}
      </Text>

      {loading && workouts.length === 0 && (
        <View className="items-center py-6">
          <ActivityIndicator color="#fafafa" />
        </View>
      )}

      {!loading && workouts.length === 0 && (
        <View className="rounded-lg border border-border bg-surface px-4 py-6">
          <Text className="text-center text-sm font-medium text-foreground">
            No workouts on this day
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
          onPress={() => onPressWorkout(w.id)}
        />
      ))}
    </ScrollView>
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
  // Day of week of the 1st (0 = Sunday). We back up that many days
  // to align the grid's first cell on a Sunday.
  const lead = first.getDay();
  const start = addDays(first, -lead);
  const out: Date[] = [];
  for (let i = 0; i < 42; i++) {
    out.push(addDays(start, i));
  }
  return out;
}
