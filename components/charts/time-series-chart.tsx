// Date-x-axis line chart for 1RM history, best-effort history, and any
// other time-series that needs a simple "line + dots" rendering.
//
// Follows run-metric-chart.tsx's structure exactly:
//   - onLayout width measurement → placeholder View until width known
//   - PADDING constants + xScale/yScale closures
//   - niceYTicks(yMin, yMax, 4) for Y grid (with ~8% domain padding)
//   - niceXTicks for 2–3 x labels, formatted as "Apr 18"
//   - Polyline series + Circle dots
//
// Edge cases (matching web behavior):
//   - width === 0       → placeholder View of the same height
//   - points.length === 0 → "No data" muted text, no SVG
//   - points.length === 1 → single-value callout + "Not enough data yet"
//                           instead of an SVG (web behavior for single-point
//                           history)
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import Svg, { Circle, G, Line, Polyline, Text as SvgText } from "react-native-svg";
import { niceXTicks, niceYTicks } from "@/components/charts/ticks";

const PADDING_LEFT = 40;
const PADDING_RIGHT = 12;
const PADDING_TOP = 12;
const PADDING_BOTTOM = 22;

const COLOR_GRID = "#27272a";
const COLOR_AXIS = "#a1a1aa";
const COLOR_BG = "#18181b";

// 8% domain padding so the line and dots don't hug the chart edges.
const Y_DOMAIN_PADDING = 0.08;

export function TimeSeriesChart({
  points,
  height = 140,
  color = "#60a5fa",
  yFormat,
  caption,
}: {
  points: { t: number; y: number }[];
  height?: number;
  color?: string;
  yFormat: (y: number) => string;
  caption?: string;
}) {
  const [width, setWidth] = useState(0);

  const xDomain = useMemo<[number, number] | null>(() => {
    if (points.length < 2) return null;
    const ts = points.map((p) => p.t);
    const min = Math.min(...ts);
    const max = Math.max(...ts);
    if (min === max) return [min - 86_400_000, max + 86_400_000];
    return [min, max];
  }, [points]);

  const yDomain = useMemo<[number, number] | null>(() => {
    if (points.length < 2) return null;
    const ys = points.map((p) => p.y);
    const rawMin = Math.min(...ys);
    const rawMax = Math.max(...ys);
    if (rawMin === rawMax) {
      const pad = Math.max(1, Math.abs(rawMin) * 0.05);
      return [rawMin - pad, rawMax + pad];
    }
    const range = rawMax - rawMin;
    const pad = range * Y_DOMAIN_PADDING;
    return [rawMin - pad, rawMax + pad];
  }, [points]);

  // --- width not yet known → same-height placeholder ---
  if (width === 0) {
    return (
      <View
        style={{ height, backgroundColor: COLOR_BG, borderRadius: 8 }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      />
    );
  }

  // --- no points → "No data" ---
  if (points.length === 0) {
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

  // --- single point → value callout, no SVG (web behavior) ---
  if (points.length === 1) {
    const p = points[0];
    return (
      <View
        style={{
          height,
          backgroundColor: COLOR_BG,
          borderRadius: 8,
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
        }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        <Text style={{ color, fontSize: 22, fontWeight: "600" }}>{yFormat(p.y)}</Text>
        <Text style={{ color: COLOR_AXIS, fontSize: 12 }}>
          {new Date(p.t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </Text>
        <Text style={{ color: COLOR_AXIS, fontSize: 12 }}>Not enough data yet</Text>
      </View>
    );
  }

  // --- full chart: points.length >= 2 and xDomain/yDomain are non-null ---
  const [xMin, xMax] = xDomain!;
  const [yMin, yMax] = yDomain!;

  const plotW = width - PADDING_LEFT - PADDING_RIGHT;
  const plotH = height - PADDING_TOP - PADDING_BOTTOM;

  const xScale = (t: number) => PADDING_LEFT + ((t - xMin) / (xMax - xMin)) * plotW;
  const yScale = (v: number) => PADDING_TOP + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const yTicks = niceYTicks(yMin, yMax, 4);
  const xTicks = niceXTicks(xMin, xMax, Math.min(3, points.length));

  const polyPoints = points.map((p) => `${xScale(p.t)},${yScale(p.y)}`).join(" ");

  return (
    <View style={{ gap: 2 }}>
      {caption != null && (
        <Text style={{ color: COLOR_AXIS, fontSize: 11, textAlign: "center" }}>{caption}</Text>
      )}
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
                  {yFormat(tick)}
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
              {new Date(tick).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </SvgText>
          ))}

          {/* Data series */}
          <Polyline
            points={polyPoints}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Dots at each point */}
          {points.map((p, i) => (
            <Circle
              key={`dot-${i}`}
              cx={xScale(p.t)}
              cy={yScale(p.y)}
              r={3}
              fill={color}
              stroke={color}
              strokeWidth={1}
            />
          ))}
        </Svg>
      </View>
    </View>
  );
}
