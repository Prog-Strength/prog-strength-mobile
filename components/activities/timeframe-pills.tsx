// 7d/30d/90d/All pills shared by Overview + Running. Timeframe →
// half-open [since, until) RFC3339 bounds, matching the web hub.
import { Pressable, Text, View } from "react-native";

export type Timeframe = "7d" | "30d" | "90d" | "all";

const OPTIONS: readonly { value: Timeframe; label: string; days: number | null }[] = [
  { value: "7d", label: "7d", days: 7 },
  { value: "30d", label: "30d", days: 30 },
  { value: "90d", label: "90d", days: 90 },
  { value: "all", label: "All", days: null },
];

/** Bounds for API calls; both undefined for "all". */
export function timeframeBounds(tf: Timeframe): { since?: string; until?: string } {
  const days = OPTIONS.find((o) => o.value === tf)?.days ?? null;
  if (days === null) return {};
  return {
    since: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
    until: new Date().toISOString(),
  };
}

export function TimeframePills({
  value,
  onChange,
}: {
  value: Timeframe;
  onChange: (v: Timeframe) => void;
}) {
  return (
    <View className="flex-row gap-2">
      {OPTIONS.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            disabled={active}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            // py-2.5 + text-xs ≈ 36pt rendered; hitSlop tops it past the
            // SOW's 44pt touch-target floor.
            hitSlop={8}
            className={`rounded-full border px-3.5 py-2.5 ${
              active ? "border-accent bg-accent/15" : "border-border bg-surface active:opacity-80"
            }`}
          >
            <Text className={`text-xs font-medium ${active ? "text-accent" : "text-muted"}`}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
