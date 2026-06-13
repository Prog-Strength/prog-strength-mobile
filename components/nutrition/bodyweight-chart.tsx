// Hand-rolled SVG chart for the Bodyweight view. Pattern mirrors
// components/progress/progression-chart.tsx so the two trend visuals
// feel coherent — no extra charting dep, math fits in one file.
//
// As of the multi-per-day rebuild: the line traces the *daily
// average*, not the raw scatter. Raw measurements still render as
// dots (lower opacity) so the morning + evening spread on a single
// day is visible context for the trend line rather than competing
// with it. See prog-strength-docs/sows/bodyweight-multi-per-day.md.
//
// The `unit` prop is the *display* unit (the user's preference,
// resolved by the parent). Each entry's weight is converted from its
// as-logged unit into `unit` before charting — stored values are
// never rewritten.
//
// goalY (optional): the goal weight already converted to the chart's
// display unit. When provided the y-domain is extended to include it
// (so the line is always visible near the data edge) and a dashed
// green (#10b981) reference line is drawn — but only when goalY falls
// within the padded y-domain (mirrors run-metric-chart's in-domain
// guard so it can never draw off-plot). goalLabel is the text to
// show next to the line.
import { useMemo, useState } from "react";
import { View } from "react-native";
import Svg, { Circle, G, Line, Polyline, Text as SvgText } from "react-native-svg";
import type { BodyweightEntry } from "@/lib/api";
import { convertWeight } from "@/lib/units";
import { niceXTicks, niceYTicks } from "@/components/charts/ticks";

const DEFAULT_HEIGHT = 200;
const PADDING_LEFT = 36;
const PADDING_RIGHT = 12;
const PADDING_TOP = 12;
const PADDING_BOTTOM = 22;
const DOT_RADIUS = 3;
const RAW_DOT_RADIUS = 2.5;

const COLOR_GRID = "#27272a";
const COLOR_AXIS = "#a1a1aa";
const COLOR_LINE = "#3b82f6";
const COLOR_BG = "#18181b";
const COLOR_GOAL = "#10b981";

export type Unit = "lb" | "kg";

export type BodyweightStats = {
  count: number;
  avg: number;
  min: number;
  max: number;
  // Delta uses first-day-average vs last-day-average rather than
  // first-vs-last raw reading — matches the chart's trend line and
  // isn't pulled around by a single bad scale read at either endpoint.
  // null when the window has fewer than 2 distinct days.
  delta: number | null;
  deltaPercent: number | null;
  unit: Unit;
};

export function computeStats(entries: BodyweightEntry[], unit: Unit): BodyweightStats | null {
  if (entries.length === 0) return null;
  const values = entries.map((e) => ({
    v: convertWeight(e.weight, e.unit, unit),
    t: new Date(e.measured_at).getTime(),
  }));
  const sum = values.reduce((a, b) => a + b.v, 0);
  const avg = sum / values.length;
  const min = Math.min(...values.map((x) => x.v));
  const max = Math.max(...values.map((x) => x.v));

  // Group by local-day, mean within day, compare first vs last day.
  const byDay = new Map<number, number[]>();
  for (const x of values) {
    const d = new Date(x.t);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const arr = byDay.get(dayStart) ?? [];
    arr.push(x.v);
    byDay.set(dayStart, arr);
  }
  const dayStartTimes = [...byDay.keys()].sort((a, b) => a - b);
  let delta: number | null = null;
  let deltaPercent: number | null = null;
  if (dayStartTimes.length >= 2) {
    const firstAvg = mean(byDay.get(dayStartTimes[0]) ?? []);
    const lastAvg = mean(byDay.get(dayStartTimes[dayStartTimes.length - 1]) ?? []);
    delta = lastAvg - firstAvg;
    deltaPercent = firstAvg > 0 ? (delta / firstAvg) * 100 : null;
  }

  return { count: values.length, avg, min, max, delta, deltaPercent, unit };
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function BodyweightChart({
  entries,
  unit,
  height = DEFAULT_HEIGHT,
  goalY,
  goalLabel,
}: {
  entries: BodyweightEntry[];
  unit: Unit;
  height?: number;
  /** Goal weight already converted to `unit`. When provided the y-domain
   * is extended to include it and a dashed green reference line is drawn
   * (in-domain guard matches run-metric-chart). */
  goalY?: number;
  /** Label shown next to the goal reference line. */
  goalLabel?: string;
}) {
  const [width, setWidth] = useState(0);

  // Raw points (every measurement) in chronological order.
  const rawPoints = useMemo(() => {
    return entries
      .map((e) => ({
        t: new Date(e.measured_at).getTime(),
        v: convertWeight(e.weight, e.unit, unit),
      }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
      .sort((a, b) => a.t - b.t);
  }, [entries, unit]);

  // Daily averages: group by local-day, mean within day, plot at noon
  // of that day so the line sits visually centered through the
  // morning + evening scatter points.
  const avgPoints = useMemo(() => {
    if (rawPoints.length === 0) return [] as { t: number; v: number }[];
    const byDay = new Map<number, number[]>();
    for (const p of rawPoints) {
      const d = new Date(p.t);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const arr = byDay.get(dayStart) ?? [];
      arr.push(p.v);
      byDay.set(dayStart, arr);
    }
    const result: { t: number; v: number }[] = [];
    for (const [dayStart, weights] of byDay) {
      const m = weights.reduce((a, b) => a + b, 0) / weights.length;
      result.push({ t: dayStart + 12 * 60 * 60 * 1000, v: m });
    }
    return result.sort((a, b) => a.t - b.t);
  }, [rawPoints]);

  const xDomain = useMemo<[number, number] | null>(() => {
    if (rawPoints.length === 0) return null;
    const min = rawPoints[0].t;
    const max = rawPoints[rawPoints.length - 1].t;
    if (min === max) return [min - 86_400_000, max + 86_400_000];
    return [min, max];
  }, [rawPoints]);

  const yDomain = useMemo<[number, number] | null>(() => {
    if (rawPoints.length === 0) return null;
    const vals = rawPoints.map((p) => p.v);
    const dataMin = Math.min(...vals);
    const dataMax = Math.max(...vals);
    // Extend to include the goal weight so the reference line is always
    // visible when the goal is near the data edge (matches web's YAxis
    // domain extension — min(data, goal) - 2 / max(data, goal) + 2).
    const effectiveMin = goalY !== undefined ? Math.min(dataMin, goalY) : dataMin;
    const effectiveMax = goalY !== undefined ? Math.max(dataMax, goalY) : dataMax;
    if (effectiveMin === effectiveMax) {
      const pad = Math.max(1, effectiveMin * 0.02);
      return [effectiveMin - pad, effectiveMax + pad];
    }
    const pad = (effectiveMax - effectiveMin) * 0.2;
    return [effectiveMin - pad, effectiveMax + pad];
  }, [rawPoints, goalY]);

  if (width === 0) {
    return (
      <View
        style={{ height, backgroundColor: COLOR_BG, borderRadius: 8 }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      />
    );
  }
  if (xDomain === null || yDomain === null) return null;

  const plotW = width - PADDING_LEFT - PADDING_RIGHT;
  const plotH = height - PADDING_TOP - PADDING_BOTTOM;
  const [xMin, xMax] = xDomain;
  const [yMin, yMax] = yDomain;

  const xScale = (t: number) => PADDING_LEFT + ((t - xMin) / (xMax - xMin)) * plotW;
  const yScale = (v: number) => PADDING_TOP + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const yTicks = niceYTicks(yMin, yMax, 4);
  const xTicks = niceXTicks(xMin, xMax, Math.min(3, rawPoints.length));

  const avgPoly = avgPoints.map((p) => `${xScale(p.t)},${yScale(p.v)}`).join(" ");

  return (
    <View
      style={{ height, backgroundColor: COLOR_BG, borderRadius: 8 }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      <Svg width={width} height={height}>
        {/* Y-axis unit label — shows the preferred display unit so
            the reader knows the scale without inspecting stat tiles. */}
        <SvgText
          x={PADDING_LEFT - 6}
          y={PADDING_TOP - 2}
          fill={COLOR_AXIS}
          fontSize={9}
          textAnchor="end"
        >
          {unit}
        </SvgText>

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
                {formatTickValue(t)}
              </SvgText>
            </G>
          );
        })}

        {/* X labels */}
        {xTicks.map((t, i) => (
          <SvgText
            key={`xt-${i}`}
            x={xScale(t)}
            y={height - 6}
            fill={COLOR_AXIS}
            fontSize={10}
            textAnchor="middle"
          >
            {formatTickDate(t)}
          </SvgText>
        ))}

        {/* Raw measurements — every entry as a faint dot so same-day
            spread reads as context for the trend line, not noise. */}
        {rawPoints.map((p, i) => (
          <Circle
            key={`r-${i}`}
            cx={xScale(p.t)}
            cy={yScale(p.v)}
            r={RAW_DOT_RADIUS}
            fill={COLOR_LINE}
            fillOpacity={0.35}
          />
        ))}

        {/* Daily-average trend line + dots */}
        {avgPoints.length > 1 && (
          <Polyline points={avgPoly} fill="none" stroke={COLOR_LINE} strokeWidth={2} />
        )}
        {avgPoints.map((p, i) => (
          <Circle
            key={`a-${i}`}
            cx={xScale(p.t)}
            cy={yScale(p.v)}
            r={DOT_RADIUS}
            fill={COLOR_LINE}
          />
        ))}

        {/* Goal reference line — dashed green #10b981. Only drawn when
            goalY falls within the padded y-domain so it can never draw
            off-plot (mirrors run-metric-chart's in-domain guard:
            referenceY >= yMin && referenceY <= yMax). The y-domain is
            already extended to include goalY above, so this guard is
            normally satisfied; it's a safety net for floating-point edge
            cases. */}
        {goalY !== undefined && goalY >= yMin && goalY <= yMax && (
          <>
            <Line
              x1={PADDING_LEFT}
              y1={yScale(goalY)}
              x2={width - PADDING_RIGHT}
              y2={yScale(goalY)}
              stroke={COLOR_GOAL}
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
            {goalLabel !== undefined && (
              <SvgText
                x={width - PADDING_RIGHT - 2}
                y={yScale(goalY) - 4}
                fill={COLOR_GOAL}
                fontSize={9}
                textAnchor="end"
              >
                {goalLabel}
              </SvgText>
            )}
          </>
        )}
      </Svg>
    </View>
  );
}

// --- helpers ------------------------------------------------------

function formatTickValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function formatTickDate(t: number): string {
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
