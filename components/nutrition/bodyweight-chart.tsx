// Hand-rolled SVG line chart for the Bodyweight view. Pattern mirrors
// components/progress/progression-chart.tsx so the two trend visuals
// feel coherent — no extra charting dep, math fits in one file.
//
// The view passes in already-filtered entries (a time window) and the
// display unit. We convert any rows logged in the other unit so the
// line stays continuous when a user switched their preferred unit
// part-way through their history.
import { useMemo, useState } from "react";
import { View } from "react-native";
import Svg, {
  Circle,
  G,
  Line,
  Polyline,
  Text as SvgText,
} from "react-native-svg";
import type { BodyweightEntry } from "@/lib/api";

const DEFAULT_HEIGHT = 200;
const PADDING_LEFT = 36;
const PADDING_RIGHT = 12;
const PADDING_TOP = 12;
const PADDING_BOTTOM = 22;
const DOT_RADIUS = 3;

const COLOR_GRID = "#27272a";
const COLOR_AXIS = "#a1a1aa";
const COLOR_AVG = "#71717a";
const COLOR_LINE = "#3b82f6";
const COLOR_BG = "#18181b";

const LB_PER_KG = 2.2046226218;

export type Unit = "lb" | "kg";

export function convertWeight(weight: number, from: Unit, to: Unit): number {
  if (from === to) return weight;
  return from === "kg" ? weight * LB_PER_KG : weight / LB_PER_KG;
}

export type BodyweightStats = {
  count: number;
  avg: number;
  min: number;
  max: number;
  unit: Unit;
};

export function computeStats(
  entries: BodyweightEntry[],
  unit: Unit,
): BodyweightStats | null {
  if (entries.length === 0) return null;
  const values = entries.map((e) => convertWeight(e.weight, e.unit, unit));
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    count: values.length,
    avg: sum / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    unit,
  };
}

export function BodyweightChart({
  entries,
  unit,
  height = DEFAULT_HEIGHT,
}: {
  entries: BodyweightEntry[];
  unit: Unit;
  height?: number;
}) {
  const [width, setWidth] = useState(0);

  // Oldest → newest, weights normalized to the display unit.
  const points = useMemo(() => {
    return entries
      .map((e) => ({
        t: new Date(e.measured_at).getTime(),
        v: convertWeight(e.weight, e.unit, unit),
      }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
      .sort((a, b) => a.t - b.t);
  }, [entries, unit]);

  const xDomain = useMemo<[number, number] | null>(() => {
    if (points.length === 0) return null;
    const min = points[0].t;
    const max = points[points.length - 1].t;
    if (min === max) return [min - 86_400_000, max + 86_400_000];
    return [min, max];
  }, [points]);

  const yDomain = useMemo<[number, number] | null>(() => {
    if (points.length === 0) return null;
    const vals = points.map((p) => p.v);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    if (min === max) {
      // All readings identical — pad so the line sits mid-chart.
      const pad = Math.max(1, min * 0.02);
      return [min - pad, max + pad];
    }
    const pad = (max - min) * 0.2;
    return [min - pad, max + pad];
  }, [points]);

  const avg = useMemo(() => {
    if (points.length === 0) return null;
    return points.reduce((s, p) => s + p.v, 0) / points.length;
  }, [points]);

  if (width === 0) {
    return (
      <View
        style={{ height, backgroundColor: COLOR_BG, borderRadius: 8 }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      />
    );
  }
  if (xDomain === null || yDomain === null || avg === null) return null;

  const plotW = width - PADDING_LEFT - PADDING_RIGHT;
  const plotH = height - PADDING_TOP - PADDING_BOTTOM;
  const [xMin, xMax] = xDomain;
  const [yMin, yMax] = yDomain;

  const xScale = (t: number) =>
    PADDING_LEFT + ((t - xMin) / (xMax - xMin)) * plotW;
  const yScale = (v: number) =>
    PADDING_TOP + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const yTicks = niceYTicks(yMin, yMax, 4);
  const xTicks = niceXTicks(xMin, xMax, Math.min(3, points.length));

  const polyPoints = points.map((p) => `${xScale(p.t)},${yScale(p.v)}`).join(" ");
  const avgY = yScale(avg);

  return (
    <View
      style={{ height, backgroundColor: COLOR_BG, borderRadius: 8 }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      <Svg width={width} height={height}>
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

        {/* Average reference line */}
        <Line
          x1={PADDING_LEFT}
          y1={avgY}
          x2={width - PADDING_RIGHT}
          y2={avgY}
          stroke={COLOR_AVG}
          strokeWidth={1}
          strokeDasharray="4 4"
        />

        {/* Weight line + dots */}
        {points.length > 1 && (
          <Polyline
            points={polyPoints}
            fill="none"
            stroke={COLOR_LINE}
            strokeWidth={2}
          />
        )}
        {points.map((p, i) => (
          <Circle
            key={`p-${i}`}
            cx={xScale(p.t)}
            cy={yScale(p.v)}
            r={DOT_RADIUS}
            fill={COLOR_LINE}
          />
        ))}
      </Svg>
    </View>
  );
}

// --- helpers ------------------------------------------------------

function niceYTicks(min: number, max: number, count: number): number[] {
  if (max <= min) return [min];
  const rawStep = (max - min) / (count - 1);
  // Snap to a 1 / 2 / 5 × 10^n step so the labels read clean.
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const snap = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  const step = snap * mag;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + 1e-9; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return ticks;
}

function niceXTicks(min: number, max: number, count: number): number[] {
  if (max <= min || count <= 1) return [min];
  const step = (max - min) / (count - 1);
  const ticks: number[] = [];
  for (let i = 0; i < count; i++) ticks.push(min + step * i);
  return ticks;
}

function formatTickValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function formatTickDate(t: number): string {
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
