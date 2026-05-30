// Time-lifting chart for the Workouts tab. Weekly buckets of total
// workout duration over a user-selected window (30d default, 90d / 6m
// / 1y options). Purpose is motivational: a quick "did I spend enough
// time training?" answer without scrolling the session log.
//
// Renders as an SVG line chart with the area beneath shaded. The line
// connects one point per ISO week (Mon-Sun, matching the calendar
// tab + the workouts list's section grouping). Weeks with no
// completed workouts plot at zero. The total-time-in-window number
// shows in the header so even when the chart is sparse the answer is
// readable at a glance.
//
// Workouts without an `ended_at` contribute zero — we can't infer a
// duration. The header surfaces this with a "+ N open" callout when
// at least one workout in the window is unclosed, so the total reads
// as a lower bound rather than a misleading underreport.
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
} from "react-native";
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from "react-native-svg";
import { useRouter } from "expo-router";
import { clearToken, getToken } from "@/lib/auth";
import { listWorkouts, type Workout } from "@/lib/api";

type Timeframe = { id: string; label: string; days: number };
// Default is 30d ("last month") per the SOW; longer ranges fan back
// for the lifter who wants to confirm a multi-month commitment.
const TIMEFRAMES: Timeframe[] = [
  { id: "30d", label: "30d", days: 30 },
  { id: "90d", label: "90d", days: 90 },
  { id: "6m", label: "6m", days: 180 },
  { id: "1y", label: "1y", days: 365 },
];

const CHART_HEIGHT = 140;
const PADDING_LEFT = 36;
const PADDING_RIGHT = 8;
const PADDING_TOP = 10;
const PADDING_BOTTOM = 20;

const COLOR_GRID = "#27272a";
const COLOR_AXIS = "#a1a1aa";
const COLOR_LINE = "#3b82f6";
// rgba so the SVG fill string lands ready-to-use without per-element
// opacity props.
const COLOR_AREA = "rgba(59, 130, 246, 0.18)";
const COLOR_BG = "#18181b";

export function DurationChart() {
  const router = useRouter();
  const [timeframe, setTimeframe] = useState<Timeframe>(TIMEFRAMES[0]);
  const [workouts, setWorkouts] = useState<Workout[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setWorkouts(null);
    setError(null);
    Promise.resolve(getToken())
      .then(async (t) => {
        if (!t) {
          router.replace("/login");
          return;
        }
        const until = new Date();
        const since = new Date(until.getTime() - timeframe.days * 86_400_000);
        // limit=100 fits a year of training (~3-5 sessions/week × 52
        // = 150-260) under one query at our beta scale. If a heavy
        // year ever exceeds 100 we'll see the chart truncate at the
        // older end — pagination is a follow-up if it shows up.
        const page = await listWorkouts(t, {
          since: since.toISOString(),
          until: until.toISOString(),
          limit: 100,
        });
        setWorkouts(page.items);
      })
      .catch((err: Error) => {
        if (err.message.toLowerCase().includes("401")) {
          clearToken();
          router.replace("/login");
          return;
        }
        setError(err.message);
      });
  }, [timeframe, router]);

  const summary = useMemo(
    () => summarize(workouts ?? [], timeframe.days),
    [workouts, timeframe.days],
  );

  return (
    <View className="gap-2 rounded-lg border border-border bg-surface p-3">
      <View className="flex-row items-baseline justify-between gap-3">
        <View className="flex-1">
          <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Time lifting
          </Text>
          <Text className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
            {formatHours(summary.totalMinutes)}
            {summary.openWorkouts > 0 && (
              <Text className="text-xs text-muted">
                {"  "}+ {summary.openWorkouts} open
              </Text>
            )}
          </Text>
        </View>
        <View className="items-end">
          <Text className="text-[10px] uppercase tracking-wider text-muted">
            Sessions
          </Text>
          <Text className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
            {summary.sessionCount}
          </Text>
        </View>
      </View>

      <TimeframePills value={timeframe} onChange={setTimeframe} />

      {workouts === null ? (
        <View style={{ height: CHART_HEIGHT }} className="items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : summary.weeks.length === 0 || summary.totalMinutes === 0 ? (
        <View
          style={{ height: CHART_HEIGHT }}
          className="items-center justify-center rounded-md border border-border/40 bg-background"
        >
          <Text className="text-xs text-muted">
            No completed workouts in this window.
          </Text>
        </View>
      ) : (
        <AreaChart weeks={summary.weeks} />
      )}

      {error && <Text className="text-xs text-danger">{error}</Text>}
    </View>
  );
}

function TimeframePills({
  value,
  onChange,
}: {
  value: Timeframe;
  onChange: (t: Timeframe) => void;
}) {
  return (
    <View className="flex-row gap-2">
      {TIMEFRAMES.map((tf) => {
        const active = tf.id === value.id;
        return (
          <Pressable
            key={tf.id}
            onPress={() => onChange(tf)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            className={`rounded-full border px-3 py-1 ${
              active
                ? "border-accent bg-accent"
                : "border-border bg-background"
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

// --- chart --------------------------------------------------------

type WeekPoint = { weekStart: Date; minutes: number };

function AreaChart({ weeks }: { weeks: WeekPoint[] }) {
  const [width, setWidth] = useState(0);

  // X domain spans the first and last week's start. With a single
  // point we still draw something — pad the domain by ±3 days so the
  // dot lands centered.
  const tMin = weeks[0].weekStart.getTime();
  const tMax = weeks[weeks.length - 1].weekStart.getTime();
  const xPad = tMin === tMax ? 3 * 86_400_000 : 0;

  // Y domain: 0 floor, max minutes top, with ~15% headroom so the
  // peak isn't slammed against the top edge.
  const yPeak = Math.max(...weeks.map((w) => w.minutes), 1);
  const yMax = yPeak * 1.15;

  if (width === 0) {
    return (
      <View
        style={{ height: CHART_HEIGHT, backgroundColor: COLOR_BG, borderRadius: 6 }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      />
    );
  }

  const plotW = width - PADDING_LEFT - PADDING_RIGHT;
  const plotH = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const baselineY = PADDING_TOP + plotH;

  const xScale = (t: number) =>
    PADDING_LEFT +
    ((t - (tMin - xPad)) / Math.max(1, tMax - tMin + 2 * xPad)) * plotW;
  const yScale = (m: number) => PADDING_TOP + (1 - m / yMax) * plotH;

  // Build the line path and the matching area path. Area closes back
  // along the baseline; line stops at the last point.
  let linePath = "";
  let areaPath = "";
  weeks.forEach((w, i) => {
    const x = xScale(w.weekStart.getTime());
    const y = yScale(w.minutes);
    if (i === 0) {
      linePath += `M ${x} ${y}`;
      areaPath += `M ${x} ${baselineY} L ${x} ${y}`;
    } else {
      linePath += ` L ${x} ${y}`;
      areaPath += ` L ${x} ${y}`;
    }
    if (i === weeks.length - 1) {
      areaPath += ` L ${x} ${baselineY} Z`;
    }
  });

  // Y ticks at 0 / mid / top — keeps labels readable without
  // crowding the small plot. Snap top to a nice round minute number.
  const yTopLabel = niceYTop(yPeak);
  const yTicks = [0, Math.round(yTopLabel / 2), yTopLabel];

  // X ticks: first and last week's start. For wider ranges we add a
  // midpoint label so the lifter has three anchors.
  const xTickValues =
    weeks.length >= 6
      ? [weeks[0].weekStart, weeks[Math.floor(weeks.length / 2)].weekStart, weeks[weeks.length - 1].weekStart]
      : [weeks[0].weekStart, weeks[weeks.length - 1].weekStart];

  return (
    <View
      style={{ height: CHART_HEIGHT, backgroundColor: COLOR_BG, borderRadius: 6 }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      <Svg width={width} height={CHART_HEIGHT}>
        <Rect x={0} y={0} width={width} height={CHART_HEIGHT} fill={COLOR_BG} />

        {/* Y grid + labels */}
        {yTicks.map((t) => {
          const y = yScale(t);
          return (
            <G key={`yt-${t}`}>
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
                x={PADDING_LEFT - 6}
                y={y + 3}
                fill={COLOR_AXIS}
                fontSize={10}
                textAnchor="end"
              >
                {formatTickMinutes(t)}
              </SvgText>
            </G>
          );
        })}

        {/* Area fill (drawn first so the line stroke sits on top). */}
        <Path d={areaPath} fill={COLOR_AREA} />

        {/* Line */}
        <Path
          d={linePath}
          stroke={COLOR_LINE}
          strokeWidth={2}
          fill="none"
        />

        {/* Per-week dots — small markers so single-point ranges still
            render something visible, and so the user can mentally
            associate the line with discrete weeks. */}
        {weeks.map((w, i) => (
          <Circle
            key={`d-${i}`}
            cx={xScale(w.weekStart.getTime())}
            cy={yScale(w.minutes)}
            r={3}
            fill={COLOR_LINE}
          />
        ))}

        {/* X labels */}
        {xTickValues.map((d, i) => (
          <SvgText
            key={`xt-${i}`}
            x={xScale(d.getTime())}
            y={CHART_HEIGHT - 6}
            fill={COLOR_AXIS}
            fontSize={10}
            textAnchor={i === 0 ? "start" : i === xTickValues.length - 1 ? "end" : "middle"}
          >
            {formatTickDate(d)}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

// --- aggregation --------------------------------------------------

type Summary = {
  totalMinutes: number;
  sessionCount: number;
  openWorkouts: number;
  weeks: WeekPoint[];
};

function summarize(workouts: Workout[], days: number): Summary {
  // Build the set of Monday-anchored weeks the window covers so weeks
  // with zero training still appear as zero-points on the chart.
  // Without this, a lifter who took two weeks off would see two
  // adjacent points connected by a misleading "smooth" line.
  const until = new Date();
  const since = new Date(until.getTime() - days * 86_400_000);
  const weekKeys: string[] = [];
  const weeksByKey = new Map<string, WeekPoint>();
  for (
    let cursor = startOfWeekMonday(since);
    cursor.getTime() <= startOfWeekMonday(until).getTime();
    cursor = addDays(cursor, 7)
  ) {
    const key = isoDateKey(cursor);
    weekKeys.push(key);
    weeksByKey.set(key, { weekStart: new Date(cursor), minutes: 0 });
  }

  let totalMinutes = 0;
  let sessionCount = 0;
  let openWorkouts = 0;
  for (const w of workouts) {
    sessionCount++;
    const performedAt = new Date(w.performed_at);
    const weekKey = isoDateKey(startOfWeekMonday(performedAt));
    const bucket = weeksByKey.get(weekKey);
    if (!w.ended_at) {
      openWorkouts++;
      continue;
    }
    const durationMs =
      new Date(w.ended_at).getTime() - performedAt.getTime();
    if (!Number.isFinite(durationMs) || durationMs <= 0) continue;
    const minutes = durationMs / 60_000;
    totalMinutes += minutes;
    if (bucket) bucket.minutes += minutes;
  }

  return {
    totalMinutes,
    sessionCount,
    openWorkouts,
    weeks: weekKeys.map((k) => weeksByKey.get(k)!),
  };
}

// --- helpers ------------------------------------------------------

function startOfWeekMonday(d: Date): Date {
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const lead = (local.getDay() + 6) % 7; // Mon=0...Sun=6
  local.setDate(local.getDate() - lead);
  return local;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function isoDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatHours(minutes: number): string {
  if (minutes <= 0) return "0h";
  const totalMinutes = Math.round(minutes);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function formatTickMinutes(m: number): string {
  if (m <= 0) return "0";
  if (m >= 60) {
    const h = m / 60;
    return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
  }
  return `${Math.round(m)}m`;
}

function formatTickDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function niceYTop(peak: number): number {
  // Snap the labeled top to a clean increment so the Y-axis legend
  // reads "30m / 60m / 2h" rather than odd fractional minutes.
  const candidates = [15, 30, 60, 90, 120, 180, 240, 300, 360, 480, 600, 900, 1200, 1800];
  for (const c of candidates) {
    if (c >= peak) return c;
  }
  return Math.ceil(peak / 60) * 60;
}
