// Workouts list, extracted from app/(tabs)/activities/index.tsx in Task 4.
// Mirrors prog-strength-web's /workouts page in spirit but groups sessions
// into weekly sections — each header shows the Mon-Sun date range, the
// workout count, and the total training time.
// Weeks start on Monday to match the calendar tab and how lifters
// mentally chunk a training week.
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, SectionList, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { clearToken, getToken } from "@/lib/auth";
import { listWorkouts, type Workout } from "@/lib/api";
import { WorkoutRow } from "@/components/workout-row";
import { useExerciseCatalog } from "@/components/exercise-catalog-context";
import { DurationChart } from "@/components/workouts/duration-chart";

type WeekSection = {
  // Stable key for SectionList: YYYY-MM-DD of the week's Monday.
  key: string;
  // Monday of the week (local time, midnight).
  weekStart: Date;
  // "May 26 – Jun 1" or "May 26 – 31" when the week stays in one month.
  title: string;
  // Number of workouts logged in the week.
  count: number;
  // Sum of (ended_at - performed_at) across workouts that have an
  // ended_at. Workouts without an end time contribute zero — surfaced
  // as a subtle hint that we don't know the duration rather than as a
  // bogus low number.
  totalDurationMs: number;
  // True when at least one workout in the section lacks ended_at, so
  // the header can append a "+" to the duration as a "this is a
  // lower bound" indicator.
  hasUnclosedWorkout: boolean;
  data: Workout[];
};

export function WorkoutsView() {
  const router = useRouter();
  const { byID: exerciseByID } = useExerciseCatalog();
  const [workouts, setWorkouts] = useState<Workout[]>([]);
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
        const page = await listWorkouts(token, { limit: 50 });
        setWorkouts(page.items);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // The API returns 401 when the JWT is expired or revoked. Wipe
        // the token and bounce so the user can re-OAuth.
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
    [router],
  );

  // useFocusEffect fires on first focus too, so it covers the initial
  // load *and* refetch-on-tab-return. A separate useEffect would
  // double-fire on mount.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Bucket workouts into Monday-anchored weeks. The server already
  // returns most-recent-first, so iterating in order preserves both
  // section order (sections appear in the order the first workout of
  // each week is encountered) and intra-section order.
  const sections = useMemo(() => groupByWeek(workouts), [workouts]);

  if (loading && workouts.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#fafafa" />
      </View>
    );
  }

  return (
    <SectionList<Workout, WeekSection>
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-3 gap-3"
      sections={sections}
      keyExtractor={(w) => w.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load({ refreshing: true })}
          tintColor="#fafafa"
        />
      }
      // SectionList doesn't expose a contentContainer gap that affects
      // both rows and headers, so we add a small top margin on every
      // header except the first. ItemSeparatorComponent is the
      // idiomatic place for it.
      ItemSeparatorComponent={() => <View className="h-3" />}
      SectionSeparatorComponent={() => <View className="h-2" />}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View className="mb-3">
          <DurationChart />
        </View>
      }
      ListEmptyComponent={
        error ? (
          <View className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2">
            <Text className="text-sm text-danger">{error}</Text>
          </View>
        ) : (
          <View className="rounded-lg border border-border bg-surface px-4 py-6">
            <Text className="text-center text-sm font-medium text-foreground">No workouts yet</Text>
            <Text className="mt-1 text-center text-xs text-muted">
              Head to the Chat tab and tell the coach what you trained — they&apos;ll log it for
              you.
            </Text>
          </View>
        )
      }
      renderSectionHeader={({ section }) => <WeekHeader section={section} />}
      renderItem={({ item }) => (
        <WorkoutRow
          workout={item}
          exerciseByID={exerciseByID}
          onPress={() => router.push(`/activities/workout/${item.id}`)}
        />
      )}
    />
  );
}

function WeekHeader({ section }: { section: WeekSection }) {
  const durationLabel =
    section.totalDurationMs > 0
      ? formatDuration(section.totalDurationMs) + (section.hasUnclosedWorkout ? "+" : "")
      : "—";
  return (
    <View className="flex-row items-baseline justify-between px-1">
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted">
        {section.title}
      </Text>
      <Text className="text-[10px] text-muted tabular-nums">
        {section.count} {section.count === 1 ? "workout" : "workouts"}
        {"  ·  "}
        {durationLabel}
      </Text>
    </View>
  );
}

// --- helpers ------------------------------------------------------

function groupByWeek(workouts: Workout[]): WeekSection[] {
  // Map preserves insertion order, so the resulting sections come out
  // in the order each week's first workout was encountered — which is
  // most-recent-first because the server pre-sorts.
  const byKey = new Map<string, WeekSection>();
  for (const w of workouts) {
    const performedAt = new Date(w.performed_at);
    const weekStart = startOfWeekMonday(performedAt);
    const key = isoDateKey(weekStart);
    const section = byKey.get(key);
    const durationMs = workoutDurationMs(w);
    const hasEnd = w.ended_at != null && w.ended_at !== "";
    if (section) {
      section.data.push(w);
      section.count += 1;
      section.totalDurationMs += durationMs;
      if (!hasEnd) section.hasUnclosedWorkout = true;
    } else {
      byKey.set(key, {
        key,
        weekStart,
        title: formatWeekRange(weekStart),
        count: 1,
        totalDurationMs: durationMs,
        hasUnclosedWorkout: !hasEnd,
        data: [w],
      });
    }
  }
  return Array.from(byKey.values());
}

// Returns the Monday of the week containing `d`, at local midnight.
// Mirrors the calendar tab's Monday-first convention.
function startOfWeekMonday(d: Date): Date {
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // getDay(): 0 = Sunday. Monday-anchored rotation:
  //   Sun(0) -> 6, Mon(1) -> 0, ..., Sat(6) -> 5.
  const lead = (local.getDay() + 6) % 7;
  local.setDate(local.getDate() - lead);
  return local;
}

function isoDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatWeekRange(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  const sameYear = monday.getFullYear() === sunday.getFullYear();
  const monStr = monday.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  // Two-part formatter: if Mon + Sun share a month, the second half is
  // just the day number ("May 26 – 31"); if they cross months, both
  // halves carry the month ("May 26 – Jun 1"). A new year inside the
  // range is rare enough that we just let locale handle the year via
  // toLocaleDateString rather than special-casing it.
  const sunStr = sameMonth
    ? String(sunday.getDate())
    : sunday.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        ...(sameYear ? {} : { year: "numeric" }),
      });
  return `${monStr} – ${sunStr}`;
}

function workoutDurationMs(w: Workout): number {
  if (!w.ended_at) return 0;
  const start = new Date(w.performed_at).getTime();
  const end = new Date(w.ended_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return end - start;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
