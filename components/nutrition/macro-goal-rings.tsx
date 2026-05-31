// Mobile ring chart row, mirror of the web's MacroGoalRings. Four
// SVG donuts (react-native-svg) — one per macro — showing today's
// intake as an arc filling 0–100% of the user's goal. Empty state
// renders an outline-only ring with no arc; the intake number still
// shows underneath so users without goals still see what they ate.
// Over-goal: the arc caps at 100% but the text label below reads the
// true percentage in amber, per the SOW's lean on Q1.
//
// Tap on any ring opens the Set Goals sheet (the parent owns that
// state). The sheet is shared between the "Set goals" CTA and the
// per-ring tap target.

import { Pressable, Text, View } from "react-native";
import Svg, { Circle, Text as SvgText } from "react-native-svg";
import type { MacroGoals } from "@/lib/api";

// Per-macro accent colors lifted from the legacy MacroSummary tiles
// (Tailwind palette hex values, inlined). react-native-svg attributes
// can't accept Tailwind class names, so the colors live here as
// literal strings shared by the arc stroke and the inner percent text.
// Calories keeps the neutral foreground white that the old tile used.
const COLORS = {
  protein: "#6ee7b7", // emerald-300
  carbs: "#fcd34d", // amber-300
  fat: "#f9a8d4", // pink-300
  calories: "#fafafa", // foreground
} as const;

export function MacroGoalRings({
  totals,
  goals,
  onSetGoals,
}: {
  totals: {
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    calories: number;
  };
  goals: MacroGoals;
  onSetGoals: () => void;
}) {
  const goalsAreSet = goals.created_at !== null;

  return (
    <View className="rounded-lg border border-border bg-surface px-3 py-3">
      <View className="mb-2 flex-row items-center justify-between gap-3">
        <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Today
        </Text>
        <Pressable
          onPress={onSetGoals}
          accessibilityRole="button"
          className="rounded-md border border-border bg-background px-3 py-1 active:opacity-80"
        >
          <Text className="text-xs font-medium text-foreground">
            {goalsAreSet ? "Edit" : "Set goals"}
          </Text>
        </Pressable>
      </View>

      {!goalsAreSet && (
        <Text className="mb-2 text-xs text-muted">
          Set targets to see how close today is.
        </Text>
      )}

      <View className="flex-row flex-wrap gap-2">
        <RingCell
          label="Calories"
          unit="kcal"
          intake={totals.calories}
          goal={goals.calories}
          color={COLORS.calories}
          onPress={onSetGoals}
        />
        <RingCell
          label="Protein"
          unit="g"
          intake={totals.protein_g}
          goal={goals.protein_g}
          color={COLORS.protein}
          onPress={onSetGoals}
        />
        <RingCell
          label="Carbs"
          unit="g"
          intake={totals.carbs_g}
          goal={goals.carbs_g}
          color={COLORS.carbs}
          onPress={onSetGoals}
        />
        <RingCell
          label="Fat"
          unit="g"
          intake={totals.fat_g}
          goal={goals.fat_g}
          color={COLORS.fat}
          onPress={onSetGoals}
        />
      </View>
    </View>
  );
}

function RingCell({
  label,
  unit,
  intake,
  goal,
  color,
  onPress,
}: {
  label: string;
  unit: string;
  intake: number;
  goal: number;
  // Hex string. Drives both the SVG arc stroke and the inner percent
  // text fill; the macro label below the ring stays muted regardless.
  color: string;
  onPress: () => void;
}) {
  // Same geometry as web: 56-radius circle on a 128-square canvas
  // with a 14-stroke ring. Picked once for visual parity across
  // platforms; both clients use it.
  const size = 112;
  const radius = 48;
  const stroke = 12;
  const circumference = 2 * Math.PI * radius;

  const ratio = goal > 0 ? intake / goal : 0;
  const filled = Math.min(ratio, 1);
  const over = ratio > 1;
  const pctText = goal > 0 ? `${Math.round(ratio * 100)}%` : "—";

  const intakeText =
    unit === "g"
      ? `${formatGrams(intake)} g`
      : `${Math.round(intake)} kcal`;
  const goalText =
    goal > 0 ? (unit === "g" ? `${goal} g` : `${goal} kcal`) : "—";

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${intakeText} of ${goalText}. Tap to edit goals.`}
      className="min-w-[46%] flex-1 items-center rounded-md border border-border/60 bg-background px-2 py-2 active:opacity-80"
    >
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Track — same color as the arc, dimmed via stroke-opacity
            so the unfilled portion still carries the macro's
            identity instead of reading as inert grey. */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeOpacity={0.2}
          strokeWidth={stroke}
        />
        {goal > 0 && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${filled * circumference},${circumference}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
        <SvgText
          x={size / 2}
          y={size / 2}
          // Color matches the arc when a goal is set; falls back to
          // muted grey for the "—" empty state so the dash doesn't
          // shout a category color it can't act on.
          fill={goal > 0 ? color : "#71717a"}
          fontSize={16}
          fontWeight={600}
          textAnchor="middle"
          // dy nudges the baseline so the number sits visually
          // centered inside the donut hole — RN's SVG text doesn't
          // honor dominantBaseline reliably across iOS/Android.
          dy={5}
        >
          {pctText}
        </SvgText>
      </Svg>
      <Text className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </Text>
      <Text className="text-xs tabular-nums text-foreground">
        {intakeText} <Text className="text-muted">/ {goalText}</Text>
      </Text>
      {over && (
        <Text className="text-[10px] font-semibold text-amber-300 tabular-nums">
          {Math.round(ratio * 100)}% of goal
        </Text>
      )}
    </Pressable>
  );
}

function formatGrams(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
