// Two-option unit selector rendered as joined buttons (lb|kg, mi|km).
// A radio group on web; on mobile a segmented pair is the idiom and
// keeps each target comfortably above 44pt.
import { Pressable, Text, View } from "react-native";

export function UnitToggle<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <View className="flex-row overflow-hidden rounded-md border border-border">
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            disabled={disabled || active}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            className={`min-h-11 flex-1 items-center justify-center px-4 py-2 ${
              active ? "bg-accent" : "bg-surface active:opacity-80"
            } ${i > 0 ? "border-l border-border" : ""}`}
          >
            <Text
              className={`text-sm font-medium ${
                active ? "text-accent-fg" : "text-foreground"
              }`}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
