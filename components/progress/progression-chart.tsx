// Hand-rolled SVG line+scatter chart for the muscle-group progression
// view. We don't pull in a charting library (no recharts equivalent
// for React Native that's worth the dep weight); the data shape here
// is small and the visual is simple enough that the math fits in one
// file.
//
// What's drawn:
//   - Horizontal grid lines tied to the Y-axis ticks
//   - Y-axis percent labels (25%, 50%, 75%, …)
//   - X-axis date labels at evenly-spaced positions
//   - Dashed reference line at y=1.0 ("current baseline")
//   - One dashed trendline per exercise (where slope data exists),
//     each colored to match its exercise's scatter points
//   - One <Circle> per data point, colored per exercise
//
// Web's recharts uses hover tooltips; touch doesn't have hover, so we
// surface a tap target — `onSelectPoint` fires with the tapped point
// and the parent renders the details panel below the chart.
import { useMemo, useState } from "react";
import { View } from "react-native";
import Svg, { Circle, G, Line, Rect, Text as SvgText } from "react-native-svg";
import type { ExerciseBaseline, MuscleGroupProgressionPoint, PerExerciseTrend } from "@/lib/api";
import { niceXTicks, niceYTicksPercent } from "@/components/charts/ticks";

const DEFAULT_HEIGHT = 240;
const PADDING_LEFT = 36;
const PADDING_RIGHT = 12;
const PADDING_TOP = 12;
const PADDING_BOTTOM = 22;
const DOT_RADIUS = 4;
const TAP_RADIUS = 12; // invisible larger hit target

const COLOR_GRID = "#27272a";
const COLOR_AXIS = "#a1a1aa";
const COLOR_REF = "#71717a";
const COLOR_BG = "#18181b";

// Same palette as the web Progress page so a user toggling between
// platforms doesn't see exercises shuffle colors.
const EXERCISE_COLORS = [
  "#3b82f6",
  "#f59e0b",
  "#10b981",
  "#ec4899",
  "#8b5cf6",
  "#ef4444",
  "#06b6d4",
  "#84cc16",
];

export function exerciseColorMap(baselines: ExerciseBaseline[]): Map<string, string> {
  const m = new Map<string, string>();
  baselines.forEach((b, i) => {
    m.set(b.exercise_id, EXERCISE_COLORS[i % EXERCISE_COLORS.length]);
  });
  return m;
}

export function ProgressionChart({
  points,
  trends,
  baselines,
  selectedPointKey,
  onSelectPoint,
  height = DEFAULT_HEIGHT,
}: {
  points: MuscleGroupProgressionPoint[];
  trends: PerExerciseTrend[];
  baselines: ExerciseBaseline[];
  selectedPointKey: string | null;
  onSelectPoint: (p: MuscleGroupProgressionPoint | null) => void;
  height?: number;
}) {
  const [width, setWidth] = useState(0);

  const colorMap = useMemo(() => exerciseColorMap(baselines), [baselines]);

  // Collect all trendlines that have endpoint data so we can fold
  // them into domain math and rendering.
  const activeTrends = useMemo(() => trends.filter((t) => t.trendline !== null), [trends]);

  // Time domain spans the points + all trendline endpoints so no
  // regression line extends past the X axis.
  const xDomain = useMemo<[number, number] | null>(() => {
    if (points.length === 0) return null;
    const xs = points.map((p) => new Date(p.performed_at).getTime());
    for (const t of activeTrends) {
      if (t.trendline) {
        xs.push(new Date(t.trendline.start_at).getTime());
        xs.push(new Date(t.trendline.end_at).getTime());
      }
    }
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    // Guard the all-same-day case so we still draw something.
    if (min === max) return [min - 86_400_000, max + 86_400_000];
    return [min, max];
  }, [points, activeTrends]);

  // Y domain: include all normalized values + all trendline endpoints
  // + 1.0 (so the baseline reference line is always visible), pad by
  // 15% so dots at the extremes aren't clipped.
  const yDomain = useMemo<[number, number]>(() => {
    const vals: number[] = points.map((p) => p.normalized_max);
    for (const t of activeTrends) {
      if (t.trendline) {
        vals.push(t.trendline.start_value, t.trendline.end_value);
      }
    }
    vals.push(1.0);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = Math.max(0.05, (max - min) * 0.15);
    return [Math.max(0, min - pad), max + pad];
  }, [points, activeTrends]);

  if (width === 0) {
    return (
      <View
        style={{ height, backgroundColor: COLOR_BG, borderRadius: 8 }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      />
    );
  }
  if (xDomain === null) return null;

  const plotW = width - PADDING_LEFT - PADDING_RIGHT;
  const plotH = height - PADDING_TOP - PADDING_BOTTOM;
  const [xMin, xMax] = xDomain;
  const [yMin, yMax] = yDomain;

  const xScale = (t: number) => PADDING_LEFT + ((t - xMin) / (xMax - xMin)) * plotW;
  const yScale = (v: number) => PADDING_TOP + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  // Y-axis ticks — 4 evenly-spaced values across the domain. Rounded
  // to nice percentages where possible.
  const yTicks = niceYTicksPercent(yMin, yMax, 4);
  // X-axis ticks — 3 evenly-spaced timestamps.
  const xTicks = niceXTicks(xMin, xMax, 3);

  const refY = yScale(1.0);

  return (
    <View
      style={{ height, backgroundColor: COLOR_BG, borderRadius: 8 }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      <Svg width={width} height={height}>
        {/* Background tap-anywhere-to-deselect */}
        <Rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill={COLOR_BG}
          onPress={() => onSelectPoint(null)}
        />

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
                {Math.round(t * 100)}%
              </SvgText>
            </G>
          );
        })}

        {/* X labels */}
        {xTicks.map((t) => {
          const x = xScale(t);
          return (
            <SvgText
              key={`xt-${t}`}
              x={x}
              y={height - 6}
              fill={COLOR_AXIS}
              fontSize={10}
              textAnchor="middle"
            >
              {formatTickDate(t)}
            </SvgText>
          );
        })}

        {/* Reference line at 1.0 = current baseline */}
        <Line
          x1={PADDING_LEFT}
          y1={refY}
          x2={width - PADDING_RIGHT}
          y2={refY}
          stroke={COLOR_REF}
          strokeWidth={1}
          strokeDasharray="2 4"
        />

        {/* Per-exercise dashed trendlines — one per trend where trendline
            is non-null; stroke = that exercise's color from colorMap */}
        {activeTrends.map((t) => {
          if (!t.trendline) return null;
          const color = colorMap.get(t.exercise_id) ?? "#3b82f6";
          const x1 = xScale(new Date(t.trendline.start_at).getTime());
          const y1 = yScale(t.trendline.start_value);
          const x2 = xScale(new Date(t.trendline.end_at).getTime());
          const y2 = yScale(t.trendline.end_value);
          return (
            <Line
              key={`trend-${t.exercise_id}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={color}
              strokeWidth={2}
              strokeDasharray="5 4"
            />
          );
        })}

        {/* Data points — drawn after the trendlines so dots sit on top */}
        {points.map((p) => {
          const key = `${p.workout_id}:${p.exercise_id}`;
          const cx = xScale(new Date(p.performed_at).getTime());
          const cy = yScale(p.normalized_max);
          const color = colorMap.get(p.exercise_id) ?? "#3b82f6";
          const selected = key === selectedPointKey;
          return (
            <G key={key}>
              {/* Invisible large hit-target so the user can actually
                  tap a 4px dot on a touchscreen. */}
              <Circle
                cx={cx}
                cy={cy}
                r={TAP_RADIUS}
                fill="transparent"
                onPress={() => onSelectPoint(p)}
              />
              <Circle
                cx={cx}
                cy={cy}
                r={selected ? DOT_RADIUS + 2 : DOT_RADIUS}
                fill={color}
                stroke={selected ? "#ffffff" : color}
                strokeWidth={selected ? 2 : 1}
              />
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

// --- helpers ------------------------------------------------------

function formatTickDate(t: number): string {
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
