// Running personal records view. Renders the six standard distances in
// canonical order (1 Mile → Marathon). Achieved distances are filled from
// listRunningBestEfforts; the fixed distance set ensures unachieved
// distances always render as empty-state cards — matching web's
// RunningView rendering where the distance list is a client-side constant
// and unachieved distances show "—" + "No record yet" with no chevron.
//
// Per-distance expandable history chart uses the same ref-cache pattern
// as the Lifts cards (first expand → fetch, re-expand = no refetch).
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { clearToken, getToken } from "@/lib/auth";
import {
  getRunningBestEffortHistory,
  listRunningBestEfforts,
  type BestEffortPoint,
  type RunningBestEffort,
  type RunningBestEffortHistory,
} from "@/lib/api";
import { formatPace, formatRunDuration } from "@/lib/units";
import { useProfile } from "@/lib/profile-context";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";

/** The fixed v1 distance set, shortest first — mirrors web's RunningView constant. */
const STANDARD_DISTANCES: { key: string; label: string }[] = [
  { key: "1mi", label: "1 Mile" },
  { key: "2mi", label: "2 Mile" },
  { key: "5k", label: "5K" },
  { key: "10k", label: "10K" },
  { key: "half_marathon", label: "Half Marathon" },
  { key: "marathon", label: "Marathon" },
];

export function RunningPRsView() {
  const router = useRouter();
  const [bestEfforts, setBestEfforts] = useState<RunningBestEffort[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchBestEfforts = useCallback(() => {
    setError(null);
    Promise.resolve(getToken())
      .then(async (t) => {
        if (!t) {
          router.replace("/login");
          return;
        }
        const list = await listRunningBestEfforts(t);
        setBestEfforts(list);
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

  // Fetch on focus — which includes mount, since this component mounts
  // fresh each time the Running tab is selected. A separate mount
  // effect would double-fetch.
  useFocusEffect(
    useCallback(() => {
      fetchBestEfforts();
    }, [fetchBestEfforts]),
  );

  const byKey = new Map((bestEfforts ?? []).map((e) => [e.distance_key, e]));

  return (
    <ScrollView contentContainerClassName="gap-2 px-4 pb-8">
      {error && (
        <View className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
          <Text className="text-xs text-danger">{error}</Text>
        </View>
      )}

      {bestEfforts === null && !error && (
        <View className="items-center py-6">
          <ActivityIndicator />
        </View>
      )}

      {STANDARD_DISTANCES.map((d) => (
        <RunningPRCard
          key={d.key}
          distanceKey={d.key}
          distanceLabel={d.label}
          entry={byKey.get(d.key) ?? null}
        />
      ))}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// One running PR card
// ---------------------------------------------------------------------------

function RunningPRCard({
  distanceKey,
  distanceLabel,
  entry,
}: {
  distanceKey: string;
  distanceLabel: string;
  entry: RunningBestEffort | null;
}) {
  const router = useRouter();
  const { profile } = useProfile();
  const distanceUnit = profile?.distance_unit ?? "mi";

  const [historyExpanded, setHistoryExpanded] = useState(false);
  // Ref-cache: once fetched for a distance_key, re-expand does not refetch.
  const historyCache = useRef<Map<string, RunningBestEffortHistory>>(new Map());
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<RunningBestEffortHistory | null>(null);

  const toggleHistory = useCallback(async () => {
    const next = !historyExpanded;
    setHistoryExpanded(next);
    if (!next) return; // collapsing — nothing to fetch

    // Already cached?
    const cached = historyCache.current.get(distanceKey);
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
      const data = await getRunningBestEffortHistory(t, distanceKey);
      historyCache.current.set(distanceKey, data);
      setHistoryData(data);
    } catch (err: unknown) {
      setHistoryError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setHistoryLoading(false);
    }
  }, [historyExpanded, distanceKey]);

  // Build chart points: y = duration_seconds, sorted ascending by time
  const chartPoints = (historyData?.points ?? []).map((p: BestEffortPoint) => ({
    t: Date.parse(p.activity_start_time),
    y: p.duration_seconds,
  }));

  return (
    <View className="gap-2 rounded-lg border border-border bg-surface p-3">
      {/* Distance label */}
      <Text className="text-sm font-semibold text-foreground">{distanceLabel}</Text>

      {/* Achieved vs unachieved */}
      {entry ? (
        <View>
          <Text className="text-2xl font-semibold tabular-nums text-foreground">
            {formatRunDuration(entry.duration_seconds)}
            <Text className="text-base font-normal text-muted">
              {"  "}
              {formatPace(entry.pace_sec_per_km, distanceUnit)}/{distanceUnit}
            </Text>
          </Text>
          <Text className="text-[10px] uppercase tracking-wider text-muted">
            Set on {formatDate(entry.activity_start_time)}
          </Text>
        </View>
      ) : (
        <View>
          <Text className="text-2xl font-semibold text-muted">—</Text>
          <Text className="text-[10px] uppercase tracking-wider text-muted">No record yet</Text>
        </View>
      )}

      {/* "View activity →" link — only for achieved records */}
      {entry && (
        <Pressable
          onPress={() => router.push(`/activities/run/${entry.activity_id}`)}
          accessibilityRole="link"
          className="active:opacity-70"
        >
          <Text className="text-xs text-accent">View activity →</Text>
        </Pressable>
      )}

      {/* Expand footer — only for achieved records */}
      {entry && (
        <Pressable
          onPress={toggleHistory}
          accessibilityRole="button"
          accessibilityLabel={historyExpanded ? "Hide history" : "Show history"}
          accessibilityState={{ expanded: historyExpanded }}
          className="min-h-[44px] flex-row items-center justify-center gap-1 border-t border-border pt-2 active:opacity-70"
          hitSlop={8}
        >
          <Text className="text-xs text-muted">History</Text>
          <Text className="text-xs text-muted">{historyExpanded ? "▲" : "▾"}</Text>
        </Pressable>
      )}

      {/* Inline history content */}
      {historyExpanded && entry && (
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
              yFormat={formatRunDuration}
              caption="lower is faster"
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
