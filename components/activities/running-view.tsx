// Running segment of the Activities hub. Shows a 2×2 metrics banner
// above a flat list of runs, both scoped to the active timeframe.
// Mirrors the web's /activities?tab=running surface but uses RN
// patterns from workouts-view.tsx (useFocusEffect, RefreshControl,
// danger-box error, ListEmptyComponent).
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { clearToken, getToken } from "@/lib/auth";
import {
  DuplicateRunError,
  getRunningMetrics,
  importRunningTcx,
  listRunningSessions,
  type RunningMetrics,
  type RunningSession,
} from "@/lib/api";
import {
  formatDistance,
  formatPace,
  formatRunDuration,
  runFallbackName,
  type DistanceUnit,
} from "@/lib/units";
import { useProfile } from "@/lib/profile-context";
import { type Timeframe, timeframeBounds } from "./timeframe-pills";

// --- component -------------------------------------------------------

export function RunningView({ timeframe }: { timeframe: Timeframe }) {
  const router = useRouter();
  const { profile } = useProfile();
  const unit: DistanceUnit = profile?.distance_unit ?? "mi";

  const [metrics, setMetrics] = useState<RunningMetrics | null>(null);
  const [runs, setRuns] = useState<RunningSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);

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
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const bounds = timeframeBounds(timeframe);
        const [m, page] = await Promise.all([
          getRunningMetrics(token, tz),
          listRunningSessions(token, bounds),
        ]);
        setMetrics(m);
        // API returns desc by start_time; sort defensively so the list
        // is always newest-first regardless of API changes.
        const sorted = [...page.activities].sort(
          (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime(),
        );
        setRuns(sorted);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // 401 → token expired/revoked; bounce to login.
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

  const importTcx = useCallback(async () => {
    setImportError(null);
    setDuplicateOf(null);
    const res = await DocumentPicker.getDocumentAsync({
      type: ["application/octet-stream", "application/xml", "text/xml", "*/*"],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    if (asset.size != null && asset.size > 10 * 1024 * 1024) {
      setImportError("File is larger than the 10 MB limit.");
      return;
    }
    setImporting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("not signed in");
      const session = await importRunningTcx(token, {
        uri: asset.uri,
        name: asset.name ?? "activity.tcx",
        mimeType: asset.mimeType ?? "application/xml",
      });
      router.push(`/activities/run/${session.id}`);
      void load({ refreshing: false });
    } catch (err) {
      if (err instanceof DuplicateRunError) {
        setDuplicateOf(err.existingActivityId);
        setImportError("This run is already in your log.");
      } else {
        setImportError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setImporting(false);
    }
  }, [router, load]);

  // useFocusEffect covers initial load + refetch-on-tab-return.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading && runs.length === 0 && !error) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#fafafa" />
      </View>
    );
  }

  return (
    <FlatList
      className="flex-1 bg-background"
      contentContainerClassName="px-4 pb-6 gap-3"
      data={runs}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load({ refreshing: true })}
          tintColor="#fafafa"
        />
      }
      ItemSeparatorComponent={() => <View className="h-2" />}
      ListHeaderComponent={
        <MetricsBanner
          metrics={metrics}
          unit={unit}
          error={error}
          importing={importing}
          importError={importError}
          duplicateOf={duplicateOf}
          onImport={importTcx}
          onViewDuplicate={(id) => router.push(`/activities/run/${id}`)}
        />
      }
      ListEmptyComponent={
        error ? null : (
          <View className="rounded-lg border border-border bg-surface px-4 py-6">
            <Text className="text-center text-sm font-medium text-foreground">
              No runs in this window.
            </Text>
            <Text className="mt-1 text-center text-xs text-muted">
              Import a .tcx to get started.
            </Text>
          </View>
        )
      }
      renderItem={({ item }) => (
        <RunRow run={item} unit={unit} onPress={() => router.push(`/activities/run/${item.id}`)} />
      )}
    />
  );
}

// --- MetricsBanner ---------------------------------------------------

function MetricsBanner({
  metrics,
  unit,
  error,
  importing,
  importError,
  duplicateOf,
  onImport,
  onViewDuplicate,
}: {
  metrics: RunningMetrics | null;
  unit: DistanceUnit;
  error: string | null;
  importing: boolean;
  importError: string | null;
  duplicateOf: string | null;
  onImport: () => void;
  onViewDuplicate: (id: string) => void;
}) {
  return (
    <View className="gap-3 py-3">
      {/* Import .tcx button */}
      <Pressable
        onPress={onImport}
        disabled={importing}
        accessibilityRole="button"
        accessibilityLabel="Import TCX file"
        style={{ minHeight: 44 }}
        className="flex-row items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 active:opacity-80"
      >
        {importing ? (
          <ActivityIndicator size="small" color="#fafafa" />
        ) : (
          <>
            <Ionicons name="cloud-upload-outline" size={18} color="#fafafa" />
            <Text className="text-sm font-medium text-foreground">Import .tcx</Text>
          </>
        )}
      </Pressable>
      {/* Import error / duplicate box */}
      {importError != null && (
        <View className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2">
          <Text className="text-sm text-danger">{importError}</Text>
          {duplicateOf != null && duplicateOf.length > 0 && (
            <Pressable
              onPress={() => onViewDuplicate(duplicateOf)}
              accessibilityRole="link"
              hitSlop={6}
              className="mt-1 self-start active:opacity-70"
            >
              <Text className="text-sm font-medium text-danger underline">View run →</Text>
            </Pressable>
          )}
        </View>
      )}
      {error && (
        <View className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2">
          <Text className="text-sm text-danger">{error}</Text>
        </View>
      )}
      {metrics && (
        <View className="flex-row flex-wrap gap-3">
          {/* This week */}
          <MetricTile
            label="This week"
            value={`${formatDistance(metrics.current_week.distance_meters, unit)} ${unit}`}
            secondary={
              metrics.current_week.delta_pct_vs_prior_week != null
                ? deltaPctLine(metrics.current_week.delta_pct_vs_prior_week)
                : null
            }
            secondaryTone={deltaTone(metrics.current_week.delta_pct_vs_prior_week)}
          />
          {/* This month */}
          <MetricTile
            label="This month"
            value={`${formatDistance(metrics.current_month.distance_meters, unit)} ${unit}`}
            secondary={`${metrics.current_month.run_count} ${metrics.current_month.run_count === 1 ? "run" : "runs"}`}
          />
          {/* Avg pace (30d) */}
          <MetricTile
            label="Avg pace (30d)"
            value={
              metrics.recent_avg_pace_sec_per_km != null
                ? `${formatPace(metrics.recent_avg_pace_sec_per_km, unit)} /${unit}`
                : "—"
            }
          />
          {/* All time */}
          <MetricTile
            label="All time"
            value={`${formatDistance(metrics.all_time.distance_meters, unit)} ${unit}`}
            secondary={`${metrics.all_time.run_count} ${metrics.all_time.run_count === 1 ? "run" : "runs"}`}
          />
        </View>
      )}
    </View>
  );
}

// Each tile takes half the row width (minus the gap), giving us a 2×2
// grid. flex-1 lets them share equal space within the flex-row wrap.
function MetricTile({
  label,
  value,
  secondary,
  secondaryTone = "neutral",
}: {
  label: string;
  value: string;
  secondary?: string | null;
  secondaryTone?: "positive" | "negative" | "neutral";
}) {
  const secondaryClass =
    secondaryTone === "positive"
      ? "text-emerald-300"
      : secondaryTone === "negative"
        ? "text-danger"
        : "text-muted";
  return (
    // width calc: (100% - gap) / 2 — implemented via flex basis so
    // NativeWind's Tailwind JIT doesn't need an arbitrary value.
    <View
      style={{ flexBasis: "47%" }}
      className="rounded-lg border border-border bg-surface px-3 py-3"
    >
      <Text className="text-base font-semibold tabular-nums text-foreground" numberOfLines={1}>
        {value}
      </Text>
      <Text
        className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted"
        numberOfLines={1}
      >
        {label}
      </Text>
      {secondary != null && (
        <Text className={`mt-1 text-xs ${secondaryClass}`} numberOfLines={1}>
          {secondary}
        </Text>
      )}
    </View>
  );
}

// --- RunRow ----------------------------------------------------------

function RunRow({
  run,
  unit,
  onPress,
}: {
  run: RunningSession;
  unit: DistanceUnit;
  onPress: () => void;
}) {
  const name = run.name && run.name.trim().length > 0 ? run.name : runFallbackName(run.start_time);

  const dateLabel = formatRunDate(run.start_time);

  const distance = `${formatDistance(run.distance_meters, unit)} ${unit}`;
  const pace =
    run.avg_pace_sec_per_km != null
      ? `${formatPace(run.avg_pace_sec_per_km, unit)} /${unit}`
      : null;
  const duration = formatRunDuration(run.duration_seconds);
  const hr = run.avg_heart_rate_bpm != null ? `${Math.round(run.avg_heart_rate_bpm)} bpm` : null;

  // "5.2 mi · 8:42 /mi · 45:12" plus optional "· 152 bpm"
  const metricParts = [distance, pace, duration, hr].filter(Boolean);
  const metricsLine = metricParts.join(" · ");

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // min-height 44pt per HIG touch target guideline
      style={{ minHeight: 44 }}
      className="rounded-lg border border-border bg-surface px-4 py-3 active:opacity-80"
    >
      <View className="flex-row items-center gap-2">
        <View className="flex-1 gap-0.5">
          <View className="flex-row items-baseline justify-between gap-2">
            <Text numberOfLines={1} className="flex-1 text-base font-medium text-foreground">
              {name}
            </Text>
            <Text className="text-xs text-muted">{dateLabel}</Text>
          </View>
          <Text numberOfLines={1} className="text-xs text-muted">
            {metricsLine}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#6b7280" />
      </View>
    </Pressable>
  );
}

// --- helpers ---------------------------------------------------------

function formatRunDate(iso: string): string {
  // "Thu, Jun 11" — matches workout-row.tsx date line style.
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function deltaPctLine(pct: number): string {
  if (pct === 0) return "0% vs last week";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${Math.round(pct)}% vs last week`;
}

type DeltaTone = "positive" | "negative" | "neutral";

function deltaTone(pct: number | null): DeltaTone {
  if (pct == null || pct === 0) return "neutral";
  return pct > 0 ? "positive" : "negative";
}
