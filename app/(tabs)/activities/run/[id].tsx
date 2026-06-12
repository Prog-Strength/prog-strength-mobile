// Run detail screen. Shows a stats grid, then pace / heart rate /
// elevation charts derived from the run's trackpoints.
//
// Conventions inherited from workout/[id].tsx:
//   - Stack.Screen for dynamic title
//   - load/error/loading pattern with 401 bounce
//   - ScrollView layout
//   - dark header from _layout.tsx screenOptions
//
// Deliberate mobile v1 deviations:
//   - No chart cursors/tooltips (desktop hover affordance, not useful on
//     small touch screens — see RunMetricChart).
//   - Alert.prompt for rename is iOS-only (acceptable; single-user app).
//   - ActionSheetIOS for the ellipsis menu is iOS-only; on Android/web
//     the ellipsis button is still rendered but tapping it is a no-op
//     (deferred for v1 — no Android target yet).
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { clearToken, getToken } from "@/lib/auth";
import {
  deleteRunningSession,
  getRunningSession,
  renameRunningSession,
  type RunningSession,
  type RunningTrackpoint,
} from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import {
  formatDistance,
  formatPace,
  formatRunDuration,
  KM_PER_MILE,
  METERS_PER_KM,
  METERS_PER_MILE,
  runFallbackName,
  type DistanceUnit,
} from "@/lib/units";
import { RunMetricChart } from "@/components/activities/run-metric-chart";

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function RunDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useProfile();
  const unit: DistanceUnit = profile?.distance_unit ?? "mi";

  const [run, setRun] = useState<RunningSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        router.replace("/login");
        return;
      }
      const session = await getRunningSession(token, id);
      setRun(session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("401")) {
        await clearToken();
        router.replace("/login");
        return;
      }
      setError(msg);
    }
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  // --- action handlers -------------------------------------------------------

  const handleRename = useCallback(() => {
    if (!run) return;
    const current = run.name && run.name.trim().length > 0 ? run.name : "";
    Alert.prompt(
      "Rename run",
      undefined,
      async (newName) => {
        if (!newName || newName.trim().length === 0) return;
        try {
          const token = await getToken();
          if (!token) return;
          const updated = await renameRunningSession(token, run.id, newName.trim());
          setRun(updated);
        } catch (err) {
          Alert.alert(
            "Rename failed",
            err instanceof Error ? err.message : String(err),
          );
        }
      },
      "plain-text",
      current,
    );
  }, [run]);

  const handleDelete = useCallback(() => {
    if (!run) return;
    Alert.alert(
      "Delete run?",
      "This run and all its trackpoints will be permanently removed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const token = await getToken();
              if (!token) return;
              await deleteRunningSession(token, run.id);
              router.back();
            } catch (err) {
              Alert.alert(
                "Delete failed",
                err instanceof Error ? err.message : String(err),
              );
            }
          },
        },
      ],
    );
  }, [run, router]);

  const handleEllipsis = useCallback(() => {
    if (Platform.OS !== "ios") return; // Android v1 — menu not implemented
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ["Cancel", "Rename", "Delete"],
        cancelButtonIndex: 0,
        destructiveButtonIndex: 2,
      },
      (idx) => {
        if (idx === 1) handleRename();
        if (idx === 2) handleDelete();
      },
    );
  }, [handleRename, handleDelete]);

  // --- loading / error states ------------------------------------------------

  if (!run && !error) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#fafafa" />
      </View>
    );
  }
  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-center text-sm text-danger">{error}</Text>
      </View>
    );
  }
  if (!run) {
    // Defensive: covered by the loading/error checks above.
    return null;
  }

  const title =
    run.name && run.name.trim().length > 0
      ? run.name.trim()
      : runFallbackName(run.start_time);

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <Pressable
              onPress={handleEllipsis}
              hitSlop={8}
              accessibilityLabel="Run actions"
              accessibilityRole="button"
              className="active:opacity-60"
            >
              <Ionicons name="ellipsis-horizontal" size={22} color="#fafafa" />
            </Pressable>
          ),
        }}
      />
      <RunDetailContent run={run} unit={unit} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Content (separate component to avoid hooks-before-return issues)
// ---------------------------------------------------------------------------

function RunDetailContent({
  run,
  unit,
}: {
  run: RunningSession;
  unit: DistanceUnit;
}) {
  const trackpoints = useMemo(() => run.trackpoints ?? [], [run.trackpoints]);

  // --- chart point sets ------------------------------------------------------
  // x = distance in display unit

  const pacePoints = useMemo(
    () =>
      trackpoints
        .filter(
          (tp): tp is RunningTrackpoint & { pace_sec_per_km: number } =>
            tp.pace_sec_per_km != null,
        )
        .map((tp) => ({
          x: tp.distance_meters / (unit === "mi" ? METERS_PER_MILE : METERS_PER_KM),
          // Convert sec/km → sec/display-unit
          y: tp.pace_sec_per_km * (unit === "mi" ? KM_PER_MILE : 1),
        })),
    [trackpoints, unit],
  );

  const hrPoints = useMemo(
    () =>
      trackpoints
        .filter(
          (tp): tp is RunningTrackpoint & { heart_rate_bpm: number } =>
            tp.heart_rate_bpm != null,
        )
        .map((tp) => ({
          x: tp.distance_meters / (unit === "mi" ? METERS_PER_MILE : METERS_PER_KM),
          y: tp.heart_rate_bpm,
        })),
    [trackpoints, unit],
  );

  const elevPoints = useMemo(
    () =>
      trackpoints
        .filter(
          (tp): tp is RunningTrackpoint & { elevation_meters: number } =>
            tp.elevation_meters != null,
        )
        .map((tp) => ({
          x: tp.distance_meters / (unit === "mi" ? METERS_PER_MILE : METERS_PER_KM),
          y: tp.elevation_meters,
        })),
    [trackpoints, unit],
  );

  // --- stat tile helpers -----------------------------------------------------

  const distance = `${formatDistance(run.distance_meters, unit)} ${unit}`;
  const avgPace =
    run.avg_pace_sec_per_km != null
      ? `${formatPace(run.avg_pace_sec_per_km, unit)} /${unit}`
      : "—";
  const duration = formatRunDuration(run.duration_seconds);
  const bestPace =
    run.best_pace_sec_per_km != null
      ? `${formatPace(run.best_pace_sec_per_km, unit)} /${unit}`
      : "—";
  const avgHr =
    run.avg_heart_rate_bpm != null
      ? `${Math.round(run.avg_heart_rate_bpm)} bpm`
      : "—";
  const maxHr =
    run.max_heart_rate_bpm != null
      ? `${Math.round(run.max_heart_rate_bpm)} bpm`
      : "—";
  const calories =
    run.total_calories != null ? String(Math.round(run.total_calories)) : "—";
  const elevGain =
    run.elevation_gain_meters != null
      ? `${Math.round(run.elevation_gain_meters)} m`
      : "—";

  return (
    <ScrollView className="flex-1 bg-background">
      <View className="gap-4 px-4 py-4">
        {/* Date */}
        <View className="rounded-lg border border-border bg-surface px-4 py-3">
          <Text className="text-xs uppercase tracking-wider text-muted">
            Date
          </Text>
          <Text className="mt-1 text-base font-medium text-foreground">
            {formatDateTime(run.start_time)}
          </Text>
        </View>

        {/* Stats grid — 2 columns × 4 rows */}
        <View className="flex-row flex-wrap gap-3">
          <StatTile label="Distance" value={distance} />
          <StatTile label="Avg Pace" value={avgPace} />
          <StatTile label="Duration" value={duration} />
          <StatTile label="Best Pace" value={bestPace} />
          <StatTile label="Avg HR" value={avgHr} />
          <StatTile label="Max HR" value={maxHr} />
          <StatTile label="Calories" value={calories} />
          <StatTile label="Elev Gain" value={elevGain} />
        </View>

        {/* Pace chart */}
        <ChartCard title="Pace">
          {pacePoints.length >= 2 ? (
            <RunMetricChart
              points={pacePoints}
              color="#3b82f6"
              xLabel={unit}
              yFormat={(y) => {
                // m:ss — same logic as formatPace but operating on
                // already-converted sec/display-unit values.
                const total = Math.round(y);
                const m = Math.floor(total / 60);
                const s = total % 60;
                return `${m}:${String(s).padStart(2, "0")}`;
              }}
              invertY
            />
          ) : (
            <NoDataPlaceholder />
          )}
        </ChartCard>

        {/* Heart rate chart */}
        <ChartCard title="Heart Rate">
          {hrPoints.length >= 2 ? (
            <RunMetricChart
              points={hrPoints}
              color="#f87171"
              xLabel={unit}
              yFormat={(y) => String(Math.round(y))}
              referenceY={run.avg_heart_rate_bpm ?? undefined}
              referenceLabel={
                run.avg_heart_rate_bpm != null
                  ? `Avg ${Math.round(run.avg_heart_rate_bpm)} bpm`
                  : undefined
              }
            />
          ) : (
            <NoDataPlaceholder />
          )}
        </ChartCard>

        {/* Elevation chart */}
        <ChartCard title="Elevation">
          {elevPoints.length >= 2 ? (
            <RunMetricChart
              points={elevPoints}
              color="#34d399"
              xLabel={unit}
              yFormat={(y) => `${Math.round(y)} m`}
            />
          ) : (
            <NoDataPlaceholder />
          )}
        </ChartCard>
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatTile({ label, value }: { label: string; value: string }) {
  return (
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

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View className="rounded-lg border border-border bg-surface px-4 py-3">
      <Text className="mb-3 text-sm font-semibold text-foreground">{title}</Text>
      {children}
    </View>
  );
}

function NoDataPlaceholder() {
  return (
    <View className="h-10 items-center justify-center">
      <Text className="text-xs text-muted">No data</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}
