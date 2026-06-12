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
//   - Dashed trendline through the regression endpoints
//   - One <Circle> per data point, colored per exercise
//
// Web's recharts uses hover tooltips; touch doesn't have hover, so we
// surface a tap target — `onSelectPoint` fires with the tapped point
// and the parent renders the details panel below the chart.
import { useMemo, useState } from "react";
import { View } from "react-native";
import Svg, { Circle, G, Line, Rect, Text as SvgText } from "react-native-svg";
import type { ExerciseBaseline, MuscleGroupProgressionPoint, Trendline } from "@/lib/api";

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
const COLOR_TREND = "#3b82f6";
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
  trendline,
  baselines,
  selectedPointKey,
  onSelectPoint,
  height = DEFAULT_HEIGHT,
}: {
  points: MuscleGroupProgressionPoint[];
  trendline: Trendline | null;
  baselines: ExerciseBaseline[];
  selectedPointKey: string | null;
  onSelectPoint: (p: MuscleGroupProgressionPoint | null) => void;
  height?: number;
}) {
  const [width, setWidth] = useState(0);

  const colorMap = useMemo(() => exerciseColorMap(baselines), [baselines]);

  // Time domain spans the points + trendline endpoints so the regression
  // line never extends past the X axis.
  const xDomain = useMemo<[number, number] | null>(() => {
    if (points.length === 0) return null;
    const xs = points.map((p) => new Date(p.performed_at).getTime());
    if (trendline) {
      xs.push(new Date(trendline.start_at).getTime());
      xs.push(new Date(trendline.end_at).getTime());
    }
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    // Guard the all-same-day case so we still draw something.
    if (min === max) return [min - 86_400_000, max + 86_400_000];
    return [min, max];
  }, [points, trendline]);

  // Y domain: include all normalized values + the trendline endpoints
  // + 1.0 (so the baseline reference line is always visible), pad by
  // 15% so dots at the extremes aren't clipped.
  const yDomain = useMemo<[number, number]>(() => {
    const vals: number[] = points.map((p) => p.normalized_max);
    if (trendline) vals.push(trendline.start_value, trendline.end_value);
    vals.push(1.0);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = Math.max(0.05, (max - min) * 0.15);
    return [Math.max(0, min - pad), max + pad];
  }, [points, trendline]);

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
  const yTicks = niceYTicks(yMin, yMax, 4);
  // X-axis ticks — 3 evenly-spaced timestamps.
  const xTicks = niceXTicks(xMin, xMax, 3);

  const refY = yScale(1.0);
  const trendStartX = trendline ? xScale(new Date(trendline.start_at).getTime()) : null;
  const trendEndX = trendline ? xScale(new Date(trendline.end_at).getTime()) : null;
  const trendStartY = trendline ? yScale(trendline.start_value) : null;
  const trendEndY = trendline ? yScale(trendline.end_value) : null;

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

        {/* Trendline */}
        {trendStartX !== null &&
          trendEndX !== null &&
          trendStartY !== null &&
          trendEndY !== null && (
            <Line
              x1={trendStartX}
              y1={trendStartY}
              x2={trendEndX}
              y2={trendEndY}
              stroke={COLOR_TREND}
              strokeWidth={2}
              strokeDasharray="5 4"
            />
          )}

        {/* Data points — drawn after the trendline so dots sit on top */}
        {points.map((p) => {
          const key = `${p.workout_id}:${p.exercise_id}`;
          const cx = xScale(new Date(p.performed_at).getTime());
          const cy = yScale(p.normalized_max);
          const color = colorMap.get(p.exercise_id) ?? COLOR_TREND;
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

function niceYTicks(min: number, max: number, count: number): number[] {
  if (max <= min) return [min];
  const step = (max - min) / (count - 1);
  // Snap step to a nearby 5%/10%/25% increment so the labels read clean.
  const snap = [0.05, 0.1, 0.15, 0.2, 0.25, 0.5].reduce(
    (best, s) => (Math.abs(s - step) < Math.abs(best - step) ? s : best),
    0.25,
  );
  const start = Math.floor(min / snap) * snap;
  const ticks: number[] = [];
  for (let v = start; v <= max + 1e-9; v += snap) {
    if (v >= min - 1e-9) ticks.push(Math.round(v * 100) / 100);
  }
  return ticks;
}

function niceXTicks(min: number, max: number, count: number): number[] {
  if (max <= min) return [min];
  if (count <= 1) return [min];
  const step = (max - min) / (count - 1);
  const ticks: number[] = [];
  for (let i = 0; i < count; i++) ticks.push(min + step * i);
  return ticks;
}

function formatTickDate(t: number): string {
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
