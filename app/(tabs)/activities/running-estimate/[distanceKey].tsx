// Running max-effort estimate detail screen. Mirrors the web running
// estimate view: a distance switcher, a headline stat grid (estimated
// max-effort time, current best + gap, confidence + basis), an estimate
// progression chart with a confidence band and actual-attempt dots, and a
// paginated attempts list.
//
// Conventions inherited from run/[id].tsx:
//   - useLocalSearchParams for the dynamic param
//   - Stack.Screen for the (dynamic) title
//   - load/error/loading pattern with 401 bounce
//   - ScrollView layout; dark header from _layout.tsx screenOptions
//   - local StatTile/ChartCard helpers
//
// The estimate may be null (basis "insufficient_data", still HTTP 200) —
// in that case we show an empty-state prompt and skip the tiles/chart.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import Svg, { Circle, G, Line, Path, Polyline, Text as SvgText } from "react-native-svg";
import { clearToken, getToken } from "@/lib/auth";
import { getRunningMaxEffort, type RunningMaxEffortDetail } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import { formatPace, formatRunDuration, type DistanceUnit } from "@/lib/units";
import { niceXTicks, niceYTicks } from "@/components/charts/ticks";
import { SegmentedControl, type Segment } from "@/components/segmented-control";

// The fixed v1 distance set, shortest first. `short` labels feed the
// switcher (kept compact so all six fit a phone-width segmented control);
// `label` is the human distance name used in the screen title.
const STANDARD_DISTANCES: { key: string; label: string; short: string }[] = [
  { key: "1mi", label: "1 Mile", short: "1mi" },
  { key: "2mi", label: "2 Mile", short: "2mi" },
  { key: "5k", label: "5K", short: "5K" },
  { key: "10k", label: "10K", short: "10K" },
  { key: "half_marathon", label: "Half", short: "Half" },
  { key: "marathon", label: "Marathon", short: "Full" },
];

const DISTANCE_SEGMENTS: readonly Segment<string>[] = STANDARD_DISTANCES.map((d) => ({
  value: d.key,
  label: d.short,
}));

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function RunningEstimateScreen() {
  const router = useRouter();
  const { distanceKey } = useLocalSearchParams<{ distanceKey: string }>();
  const { profile } = useProfile();
  const unit: DistanceUnit = profile?.distance_unit ?? "mi";

  const [detail, setDetail] = useState<RunningMaxEffortDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!distanceKey) return;
    setError(null);
    setDetail(null);
    try {
      const token = await getToken();
      if (!token) {
        router.replace("/login");
        return;
      }
      const data = await getRunningMaxEffort(token, distanceKey);
      setDetail(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("401")) {
        await clearToken();
        router.replace("/login");
        return;
      }
      setError(msg);
    }
  }, [distanceKey, router]);

  // Reload on param change (distance switch routes back into this screen).
  useEffect(() => {
    load();
  }, [load]);

  const known = STANDARD_DISTANCES.find((d) => d.key === distanceKey);
  const title = known ? `${known.label} Estimate` : "Max-Effort Estimate";

  const onSwitch = useCallback(
    (key: string) => {
      if (key === distanceKey) return;
      router.replace(`/activities/running-estimate/${key}`);
    },
    [distanceKey, router],
  );

  return (
    <>
      <Stack.Screen options={{ title }} />
      <ScrollView className="flex-1 bg-background">
        <View className="gap-4 px-4 py-4">
          {/* Distance switcher */}
          <SegmentedControl
            value={distanceKey ?? "5k"}
            onChange={onSwitch}
            segments={DISTANCE_SEGMENTS}
            ariaLabel="Estimate distance"
          />

          {!detail && !error && (
            <View className="items-center py-10">
              <ActivityIndicator color="#fafafa" />
            </View>
          )}

          {error && (
            <View className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
              <Text className="text-xs text-danger">{error}</Text>
            </View>
          )}

          {detail && !error && <EstimateContent detail={detail} unit={unit} />}
        </View>
      </ScrollView>
    </>
  );
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const ATTEMPTS_PAGE = 8;

function EstimateContent({ detail, unit }: { detail: RunningMaxEffortDetail; unit: DistanceUnit }) {
  const [attemptsShown, setAttemptsShown] = useState(ATTEMPTS_PAGE);

  // Empty state: no estimate (basis "insufficient_data"). Skip tiles/chart.
  if (!detail.estimate) {
    return (
      <View className="rounded-lg border border-border bg-surface px-4 py-8">
        <Text className="text-center text-sm text-muted">
          Log a run at this distance to see an estimate.
        </Text>
      </View>
    );
  }

  const { stats } = detail;
  const estimated =
    stats.estimated_max_effort_seconds != null
      ? formatRunDuration(stats.estimated_max_effort_seconds)
      : "—";
  const currentBest =
    stats.current_best_seconds != null ? formatRunDuration(stats.current_best_seconds) : "—";
  const gap = stats.gap_seconds != null ? formatGap(stats.gap_seconds) : null;
  const confidence = stats.confidence ? capitalize(stats.confidence) : "—";
  const basisLabel = detail.estimate.basis ? humanizeSource(detail.estimate.basis) : undefined;

  // Estimate line points (t = as_of, y = seconds).
  const linePoints = detail.estimate_history.map((p) => ({
    t: Date.parse(p.as_of),
    lower: p.lower_seconds,
    upper: p.upper_seconds,
    y: p.seconds,
  }));
  // Actual attempts as dots (t = achieved_at, y = duration_seconds).
  const attemptDots = detail.attempts.map((a) => ({
    t: Date.parse(a.achieved_at),
    y: a.duration_seconds,
  }));

  const visibleAttempts = detail.attempts.slice(0, attemptsShown);
  const hasMore = detail.attempts.length > attemptsShown;

  return (
    <>
      {/* Headline stat grid */}
      <View className="flex-row flex-wrap gap-3">
        <StatTile label="Est. max-effort" value={estimated} headline />
        <StatTile label="Current best" value={currentBest} sub={gap ?? undefined} />
        <StatTile label="Confidence" value={confidence} sub={basisLabel} />
      </View>
      {stats.data_summary ? <Text className="text-xs text-muted">{stats.data_summary}</Text> : null}

      {/* Estimate chart */}
      <ChartCard title="Estimate over time">
        <EstimateChart linePoints={linePoints} attemptDots={attemptDots} height={180} />
        <Text className="mt-2 text-[10px] text-muted">
          Shaded band is the confidence range; dots are your actual runs. Lower is faster.
        </Text>
      </ChartCard>

      {/* Attempts list */}
      <ChartCard title="Attempts">
        {detail.attempts.length === 0 ? (
          <Text className="text-xs text-muted">No logged attempts at this distance yet.</Text>
        ) : (
          <View className="gap-2">
            {visibleAttempts.map((a) => (
              <View
                key={`${a.activity_id}-${a.achieved_at}`}
                className="flex-row items-center justify-between border-b border-border/60 pb-2"
              >
                <View>
                  <Text className="text-sm font-medium text-foreground">
                    {formatRunDuration(a.duration_seconds)}
                  </Text>
                  <Text className="text-[10px] uppercase tracking-wider text-muted">
                    {formatDate(a.achieved_at)} · {humanizeSource(a.source)}
                  </Text>
                </View>
                <Text className="text-xs tabular-nums text-muted">
                  {formatPace(a.pace_sec_per_km, unit)} /{unit}
                </Text>
              </View>
            ))}
            {hasMore && (
              <Pressable
                onPress={() => setAttemptsShown((n) => n + ATTEMPTS_PAGE)}
                accessibilityRole="button"
                className="min-h-[44px] items-center justify-center active:opacity-70"
              >
                <Text className="text-xs text-accent">
                  Show more ({detail.attempts.length - attemptsShown} more)
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </ChartCard>
    </>
  );
}

// ---------------------------------------------------------------------------
// Estimate chart — line + confidence band + actual-attempt dots
// ---------------------------------------------------------------------------
//
// Mirrors TimeSeriesChart's scaling/axis approach (onLayout width
// measurement, PADDING constants, niceYTicks/niceXTicks). Adds a shaded
// confidence-band Path spanning lower→upper across the dates, and renders
// actual attempts as a second, contrasting dot series.

const PADDING_LEFT = 44;
const PADDING_RIGHT = 12;
const PADDING_TOP = 12;
const PADDING_BOTTOM = 22;

const COLOR_GRID = "#27272a";
const COLOR_AXIS = "#a1a1aa";
const COLOR_BG = "#18181b";
const COLOR_LINE = "#60a5fa";
const COLOR_BAND = "#60a5fa";
const COLOR_ATTEMPT = "#34d399";

const Y_DOMAIN_PADDING = 0.08;

type LinePoint = { t: number; y: number; lower: number; upper: number };

function EstimateChart({
  linePoints,
  attemptDots,
  height = 180,
}: {
  linePoints: LinePoint[];
  attemptDots: { t: number; y: number }[];
  height?: number;
}) {
  const [width, setWidth] = useState(0);

  // Combined domains so both series and the band fit. The estimate line
  // anchors the x-domain; attempts may extend it.
  const allT = useMemo(
    () => [...linePoints.map((p) => p.t), ...attemptDots.map((d) => d.t)],
    [linePoints, attemptDots],
  );
  const allY = useMemo(
    () => [...linePoints.flatMap((p) => [p.lower, p.upper, p.y]), ...attemptDots.map((d) => d.y)],
    [linePoints, attemptDots],
  );

  const xDomain = useMemo<[number, number] | null>(() => {
    if (allT.length === 0) return null;
    const min = Math.min(...allT);
    const max = Math.max(...allT);
    if (min === max) return [min - 86_400_000, max + 86_400_000];
    return [min, max];
  }, [allT]);

  const yDomain = useMemo<[number, number] | null>(() => {
    if (allY.length === 0) return null;
    const rawMin = Math.min(...allY);
    const rawMax = Math.max(...allY);
    if (rawMin === rawMax) {
      const pad = Math.max(1, Math.abs(rawMin) * 0.05);
      return [rawMin - pad, rawMax + pad];
    }
    const range = rawMax - rawMin;
    const pad = range * Y_DOMAIN_PADDING;
    return [rawMin - pad, rawMax + pad];
  }, [allY]);

  // Width not yet known → same-height placeholder.
  if (width === 0) {
    return (
      <View
        style={{ height, backgroundColor: COLOR_BG, borderRadius: 8 }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      />
    );
  }

  // No data at all (defensive — empty state handled upstream).
  if (!xDomain || !yDomain) {
    return (
      <View
        style={{
          height,
          backgroundColor: COLOR_BG,
          borderRadius: 8,
          alignItems: "center",
          justifyContent: "center",
        }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        <Text style={{ color: COLOR_AXIS, fontSize: 13 }}>No data</Text>
      </View>
    );
  }

  const [xMin, xMax] = xDomain;
  const [yMin, yMax] = yDomain;

  const plotW = width - PADDING_LEFT - PADDING_RIGHT;
  const plotH = height - PADDING_TOP - PADDING_BOTTOM;

  // With a single estimate point there's no x-range to spread across;
  // center it so the band/dot still render sensibly.
  const xScale = (t: number) =>
    xMax === xMin ? PADDING_LEFT + plotW / 2 : PADDING_LEFT + ((t - xMin) / (xMax - xMin)) * plotW;
  const yScale = (v: number) => PADDING_TOP + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const yTicks = niceYTicks(yMin, yMax, 4);
  const xTicks = niceXTicks(xMin, xMax, Math.min(3, Math.max(2, linePoints.length)));

  // Confidence band: upper edge left→right, then lower edge right→left.
  const sorted = [...linePoints].sort((a, b) => a.t - b.t);
  const bandPath =
    sorted.length >= 2
      ? `M ${sorted.map((p) => `${xScale(p.t)},${yScale(p.upper)}`).join(" L ")} L ${sorted
          .slice()
          .reverse()
          .map((p) => `${xScale(p.t)},${yScale(p.lower)}`)
          .join(" L ")} Z`
      : null;

  const linePolyPoints =
    sorted.length >= 2 ? sorted.map((p) => `${xScale(p.t)},${yScale(p.y)}`).join(" ") : null;

  return (
    <View
      style={{ height, backgroundColor: COLOR_BG, borderRadius: 8 }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      <Svg width={width} height={height}>
        {/* Y grid lines + labels */}
        {yTicks.map((tick) => {
          const y = yScale(tick);
          return (
            <G key={`yt-${tick}`}>
              <Line
                x1={PADDING_LEFT}
                y1={y}
                x2={width - PADDING_RIGHT}
                y2={y}
                stroke={COLOR_GRID}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <SvgText
                x={PADDING_LEFT - 5}
                y={y + 3}
                fill={COLOR_AXIS}
                fontSize={10}
                textAnchor="end"
              >
                {formatRunDuration(tick)}
              </SvgText>
            </G>
          );
        })}

        {/* X labels */}
        {xTicks.map((tick, i) => (
          <SvgText
            key={`xt-${i}`}
            x={xScale(tick)}
            y={height - 6}
            fill={COLOR_AXIS}
            fontSize={10}
            textAnchor="middle"
          >
            {new Date(tick).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </SvgText>
        ))}

        {/* Confidence band */}
        {bandPath && <Path d={bandPath} fill={COLOR_BAND} fillOpacity={0.15} stroke="none" />}

        {/* Estimate line */}
        {linePolyPoints && (
          <Polyline
            points={linePolyPoints}
            fill="none"
            stroke={COLOR_LINE}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* Single estimate point → callout dot */}
        {sorted.length === 1 && (
          <Circle cx={xScale(sorted[0].t)} cy={yScale(sorted[0].y)} r={4} fill={COLOR_LINE} />
        )}

        {/* Actual attempt dots */}
        {attemptDots.map((d, i) => (
          <Circle
            key={`att-${i}`}
            cx={xScale(d.t)}
            cy={yScale(d.y)}
            r={3.5}
            fill={COLOR_ATTEMPT}
            stroke={COLOR_BG}
            strokeWidth={1}
          />
        ))}
      </Svg>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatTile({
  label,
  value,
  sub,
  headline,
}: {
  label: string;
  value: string;
  sub?: string;
  headline?: boolean;
}) {
  return (
    <View
      style={{ flexBasis: "47%" }}
      className="rounded-lg border border-border bg-surface px-3 py-3"
    >
      <Text
        className={`tabular-nums text-foreground ${
          headline ? "text-2xl font-semibold" : "text-base font-semibold"
        }`}
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
      {sub ? (
        <Text className="mt-0.5 text-[10px] text-muted" numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="rounded-lg border border-border bg-surface px-4 py-3">
      <Text className="mb-3 text-sm font-semibold text-foreground">{title}</Text>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Signed gap vs the estimate, e.g. "+0:12 vs estimate" / "−0:05 vs estimate". */
function formatGap(seconds: number): string {
  if (seconds === 0) return "On estimate";
  const sign = seconds > 0 ? "+" : "−";
  return `${sign}${formatRunDuration(Math.abs(seconds))} vs est.`;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Humanize an attempt's source enum, e.g. "garmin_api" → "Garmin". */
function humanizeSource(source: string): string {
  switch (source) {
    case "garmin_api":
      return "Garmin";
    case "manual_tcx":
      return "Manual";
    default:
      return source
        .split("_")
        .map((w) => capitalize(w))
        .join(" ");
  }
}
