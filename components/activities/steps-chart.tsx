// Hand-rolled SVG bar chart for the Activities → Steps view. Pattern
// mirrors components/nutrition/bodyweight-chart.tsx so the two trend
// visuals feel coherent — no extra charting dep, math fits in one file.
//
// Steps are date-keyed (one row per calendar day), so rather than a
// scatter+trend line we draw one vertical bar per day across the
// window. A dashed-green (#10b981) horizontal reference line marks the
// daily goal — drawn only when the goal falls within the padded
// y-domain (mirrors bodyweight-chart's in-domain guard so it can never
// draw off-plot). The y-domain is extended to include the goal value
// when set, so the line stays visible near the data edge.
import { useMemo, useState } from "react";
import { View } from "react-native";
import Svg, { G, Line, Rect, Text as SvgText } from "react-native-svg";
import type { StepsEntry } from "@/lib/api";
import { niceXTicks, niceYTicks } from "@/components/charts/ticks";

const DEFAULT_HEIGHT = 200;
const PADDING_LEFT = 40;
const PADDING_RIGHT = 12;
const PADDING_TOP = 12;
const PADDING_BOTTOM = 22;
const MIN_BAR_WIDTH = 2;
const MAX_BAR_WIDTH = 18;

const COLOR_GRID = "#27272a";
const COLOR_AXIS = "#a1a1aa";
const COLOR_BAR = "#3b82f6";
const COLOR_BG = "#18181b";
const COLOR_GOAL = "#10b981";

export type StepsStats = {
  count: number; // number of days with a logged step count
  total: number;
  avg: number;
  best: number;
  // Goal attainment: fraction of avg-vs-goal (0..1+), or null when no
  // goal is set or there's no data. Mirrors the web's attainment math.
  goalAttainment: number | null;
};

/**
 * Aggregate step stats over the fetched window. `goal` is the daily
 * target (0 = unset). Pure — extracted so it can be reasoned about and
 * unit-tested independently of the SVG render path.
 */
export function computeStepsStats(entries: StepsEntry[], goal: number): StepsStats | null {
  if (entries.length === 0) return null;
  const counts = entries.map((e) => e.steps).filter((n) => Number.isFinite(n));
  if (counts.length === 0) return null;
  const total = counts.reduce((a, b) => a + b, 0);
  const avg = total / counts.length;
  const best = Math.max(...counts);
  const goalAttainment = goal > 0 ? avg / goal : null;
  return { count: counts.length, total, avg, best, goalAttainment };
}

/**
 * Padded y-domain [min, max] for the bar chart. Bars start at 0, so the
 * floor is pinned to 0; the top is the larger of the best day and the
 * goal (when set), padded 15% so the tallest bar / goal line isn't
 * flush with the top edge. Returns null when there's nothing to plot.
 */
export function stepsYDomain(values: number[], goal?: number): [number, number] | null {
  if (values.length === 0) return null;
  const dataMax = Math.max(...values, 0);
  const effectiveMax = goal !== undefined && goal > 0 ? Math.max(dataMax, goal) : dataMax;
  if (effectiveMax <= 0) return [0, 1];
  return [0, effectiveMax * 1.15];
}

export function StepsChart({
  entries,
  height = DEFAULT_HEIGHT,
  goalY,
  goalLabel,
}: {
  entries: StepsEntry[];
  height?: number;
  /** Daily goal value. When > 0 the y-domain is extended to include it
   * and a dashed green reference line is drawn (in-domain guard matches
   * bodyweight-chart). */
  goalY?: number;
  /** Label shown next to the goal reference line. */
  goalLabel?: string;
}) {
  const [width, setWidth] = useState(0);

  // One point per day, chronological (oldest → newest) so bars read
  // left-to-right like a calendar.
  const points = useMemo(() => {
    return entries
      .map((e) => ({ t: dateToMs(e.date), v: e.steps }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
      .sort((a, b) => a.t - b.t);
  }, [entries]);

  const xDomain = useMemo<[number, number] | null>(() => {
    if (points.length === 0) return null;
    const min = points[0].t;
    const max = points[points.length - 1].t;
    if (min === max) return [min - 86_400_000, max + 86_400_000];
    return [min, max];
  }, [points]);

  const yDomain = useMemo<[number, number] | null>(() => {
    return stepsYDomain(
      points.map((p) => p.v),
      goalY,
    );
  }, [points, goalY]);

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

  const xScale = (t: number) =>
    xMax === xMin ? PADDING_LEFT + plotW / 2 : PADDING_LEFT + ((t - xMin) / (xMax - xMin)) * plotW;
  const yScale = (v: number) => PADDING_TOP + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const yTicks = niceYTicks(yMin, yMax, 4);
  const xTicks = niceXTicks(xMin, xMax, Math.min(3, points.length));

  // Bar width: share the plot among days, clamped to a readable range.
  const barW = Math.max(
    MIN_BAR_WIDTH,
    Math.min(MAX_BAR_WIDTH, plotW / Math.max(points.length, 1) - 2),
  );
  const yZero = yScale(0);

  return (
    <View
      style={{ height, backgroundColor: COLOR_BG, borderRadius: 8 }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      <Svg width={width} height={height}>
        {/* Y-axis label */}
        <SvgText
          x={PADDING_LEFT - 6}
          y={PADDING_TOP - 2}
          fill={COLOR_AXIS}
          fontSize={9}
          textAnchor="end"
        >
          steps
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

        {/* Daily bars */}
        {points.map((p, i) => {
          const x = xScale(p.t) - barW / 2;
          const yTop = yScale(p.v);
          const h = Math.max(0, yZero - yTop);
          return (
            <Rect
              key={`b-${i}`}
              x={x}
              y={yTop}
              width={barW}
              height={h}
              rx={1}
              fill={COLOR_BAR}
              fillOpacity={0.85}
            />
          );
        })}

        {/* Goal reference line — dashed green #10b981, only when in-domain. */}
        {goalY !== undefined && goalY > 0 && goalY >= yMin && goalY <= yMax && (
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

/** YYYY-MM-DD → local-noon ms (noon avoids DST edge flips at midnight). */
function dateToMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return NaN;
  return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
}

function formatTickValue(v: number): string {
  if (v >= 1000) {
    const k = v / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return String(Math.round(v));
}

function formatTickDate(t: number): string {
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
