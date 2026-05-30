// Reusable horizontal segmented control. Used by the Nutrition tab
// (Today | Pantry | Bodyweight) and the Progress tab (Progress | PRs)
// to keep nested destinations one tap apart inside their parent tab.
//
// The control is intentionally thin — a pill-shaped row of equal-width
// Pressables that swap a class-based "active" style. It does not own
// any state; the caller passes `value` + `onChange` and decides which
// component to render below the bar.
import { Pressable, Text, View } from "react-native";

export type Segment<Value extends string> = {
  value: Value;
  label: string;
};

export function SegmentedControl<Value extends string>({
  value,
  onChange,
  segments,
  ariaLabel,
}: {
  value: Value;
  onChange: (next: Value) => void;
  segments: readonly Segment<Value>[];
  ariaLabel?: string;
}) {
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={ariaLabel}
      className="flex-row rounded-full border border-border bg-surface p-0.5"
    >
      {segments.map((s) => {
        const active = s.value === value;
        return (
          <Pressable
            key={s.value}
            onPress={() => onChange(s.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            className={`flex-1 items-center justify-center rounded-full px-3 py-1.5 ${
              active ? "bg-accent" : ""
            } active:opacity-80`}
          >
            <Text
              className={`text-xs font-medium ${
                active ? "text-accent-fg" : "text-muted"
              }`}
              numberOfLines={1}
            >
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
