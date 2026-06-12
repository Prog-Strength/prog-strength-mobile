// Parameterized SVG line chart for the run detail screen. One component
// used three times (pace, heart rate, elevation). Follows the pattern
// established in components/nutrition/bodyweight-chart.tsx:
//   - width measured via onLayout (renders a placeholder View first)
//   - PADDING constants + xScale/yScale closures
//   - niceYTicks(yMin, yMax, 4) for grid lines
//   - niceXTicks for 2–3 x labels
//   - single <Polyline> for the series
//
// Deliberate mobile v1 deviations from the web chart:
//   - No cursor/tooltip (the web's synced cross-hair is a desktop
//     hover affordance; mobile touch targets on a tiny chart would be
//     unusable and weren't worth the complexity for v1).
//
// The parent pre-filters points (no nulls) and converts x to the
// display-unit distance before passing them in.
import { useMemo, useState } from "react";
import { View } from "react-native";
import Svg, { G, Line, Polyline, Text as SvgText } from "react-native-svg";
import { niceXTicks, niceYTicks } from "@/components/charts/ticks";

const PADDING_LEFT = 40;
const PADDING_RIGHT = 12;
const PADDING_TOP = 12;
const PADDING_BOTTOM = 22;

const COLOR_GRID = "#27272a";
const COLOR_AXIS = "#a1a1aa";
const COLOR_BG = "#18181b";

// 8% domain padding on both sides so the line doesn't hug the chart
// edges. Matches bodyweight-chart's 20% convention but tighter since
// run data usually spans a wide y range naturally.
const DEFAULT_Y_DOMAIN_PADDING = 0.08;

export interface RunMetricChartProps {
  /** Pre-filtered points: x = distance in display unit, y = metric value. */
  points: { x: number; y: number }[];
  height?: number;
  /** Line color (hex). */
  color: string;
  /** Axis tick label formatter. */
  yFormat: (y: number) => string;
  /** Unit caption below the x axis ("mi" | "km"). */
  xLabel: string;
  yDomainPadding?: number;
  /** Optional dashed horizontal reference line (e.g. average HR). */
  referenceY?: number;
  referenceLabel?: string;
  /**
   * Pace inversion: when true, smaller y values map to the TOP of the
   * chart (lower pace = faster = visually "higher"). Standard charts
   * have larger values at the top.
   *
   * invertY=false: yScale(v) = PADDING_TOP + (1 - norm) * plotH  [large → top]
   * invertY=true:  yScale(v) = PADDING_TOP + norm * plotH         [small → top]
   */
  invertY?: boolean;
}

export function RunMetricChart({
  points,
  height = 160,
  color,
  yFormat,
  xLabel,
  yDomainPadding = DEFAULT_Y_DOMAIN_PADDING,
  referenceY,
  referenceLabel,
  invertY = false,
}: RunMetricChartProps) {
  const [width, setWidth] = useState(0);

  // Compute domains from the (pre-filtered) points.
  const xDomain = useMemo<[number, number] | null>(() => {
    if (points.length === 0) return null;
    const xs = points.map((p) => p.x);
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    // Single-point guard: give it a 1-unit window.
    if (min === max) return [Math.max(0, min - 0.5), max + 0.5];
    return [min, max];
  }, [points]);

  const yDomain = useMemo<[number, number] | null>(() => {
    if (points.length === 0) return null;
    const ys = points.map((p) => p.y);
    const rawMin = Math.min(...ys);
    const rawMax = Math.max(...ys);
    if (rawMin === rawMax) {
      // Single distinct value — pad by max(1, 5% of value).
      const pad = Math.max(1, Math.abs(rawMin) * 0.05);
      return [rawMin - pad, rawMax + pad];
    }
    const range = rawMax - rawMin;
    const pad = range * yDomainPadding;
    return [rawMin - pad, rawMax + pad];
  }, [points, yDomainPadding]);

  // Render a same-sized placeholder while width is unknown.
  if (width === 0) {
    return (
      <View
        style={{ height, backgroundColor: COLOR_BG, borderRadius: 8 }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      />
    );
  }

  // Empty / insufficient data — parent should show a placeholder
  // instead, but handle gracefully here too.
  if (xDomain === null || yDomain === null || points.length < 2) {
    return (
      <View
        style={{ height, backgroundColor: COLOR_BG, borderRadius: 8 }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      />
    );
  }

  const plotW = width - PADDING_LEFT - PADDING_RIGHT;
  const plotH = height - PADDING_TOP - PADDING_BOTTOM;
  const [xMin, xMax] = xDomain;
  const [yMin, yMax] = yDomain;

  const xScale = (v: number) =>
    PADDING_LEFT + ((v - xMin) / (xMax - xMin)) * plotW;

  // invertY=true → smaller values at top (pace: faster = top).
  // invertY=false → larger values at top (standard chart convention).
  const yScale = (v: number) => {
    const norm = (v - yMin) / (yMax - yMin);
    return invertY
      ? PADDING_TOP + norm * plotH
      : PADDING_TOP + (1 - norm) * plotH;
  };

  const yTicks = niceYTicks(yMin, yMax, 4);
  const xTicks = niceXTicks(xMin, xMax, Math.min(3, points.length));

  const polyPoints = points
    .map((p) => `${xScale(p.x)},${yScale(p.y)}`)
    .join(" ");

  return (
    <View
      style={{ height, backgroundColor: COLOR_BG, borderRadius: 8 }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      <Svg width={width} height={height}>
        {/* Y grid lines + labels */}
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
                x={PADDING_LEFT - 5}
                y={y + 3}
                fill={COLOR_AXIS}
                fontSize={10}
                textAnchor="end"
              >
                {yFormat(t)}
              </SvgText>
            </G>
          );
        })}

        {/* X labels + unit caption */}
        {xTicks.map((t, i) => (
          <SvgText
            key={`xt-${i}`}
            x={xScale(t)}
            y={height - 6}
            fill={COLOR_AXIS}
            fontSize={10}
            textAnchor="middle"
          >
            {t.toFixed(1)} {xLabel}
          </SvgText>
        ))}

        {/* Optional reference line (e.g. average HR) — dashed. Skipped
            when the value falls outside the padded y-domain (possible
            when a session aggregate disagrees with trackpoint extremes)
            so it never draws outside the plot area. */}
        {referenceY !== undefined && referenceY >= yMin && referenceY <= yMax && (
          <>
            <Line
              x1={PADDING_LEFT}
              y1={yScale(referenceY)}
              x2={width - PADDING_RIGHT}
              y2={yScale(referenceY)}
              stroke={color}
              strokeWidth={1}
              strokeDasharray="5 4"
              strokeOpacity={0.6}
            />
            {referenceLabel && (
              <SvgText
                x={width - PADDING_RIGHT - 2}
                y={yScale(referenceY) - 4}
                fill={color}
                fontSize={9}
                textAnchor="end"
                fillOpacity={0.85}
              >
                {referenceLabel}
              </SvgText>
            )}
          </>
        )}

        {/* Data series */}
        <Polyline
          points={polyPoints}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}
