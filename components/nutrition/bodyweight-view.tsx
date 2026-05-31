// Bodyweight view inside the Nutrition tab. Add-entry form, trend
// chart with simple stats (avg / min / max), then history list. The
// chart and stats are scoped to a time-window selector (7D/30D/90D/All)
// so the view answers "how am I trending lately" without forcing the
// user to scroll the full history.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { clearToken, getToken } from "@/lib/auth";
import {
  createBodyweightEntry,
  deleteBodyweightEntry,
  listBodyweight,
  type BodyweightEntry,
} from "@/lib/api";
import {
  BodyweightChart,
  computeStats,
} from "@/components/nutrition/bodyweight-chart";
import { SegmentedControl, type Segment } from "@/components/segmented-control";

type Unit = "lb" | "kg";

type RangeKey = "7d" | "30d" | "90d" | "all";

const RANGE_SEGMENTS: readonly Segment<RangeKey>[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "all", label: "All" },
];

const RANGE_DAYS: Record<RangeKey, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

export function BodyweightView() {
  const router = useRouter();
  const [entries, setEntries] = useState<BodyweightEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weight, setWeight] = useState("");
  const [unit, setUnit] = useState<Unit>("lb");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowBusyID, setRowBusyID] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("30d");

  const windowEntries = useMemo(() => {
    if (!entries) return [];
    const days = RANGE_DAYS[range];
    if (days === null) return entries;
    const cutoff = Date.now() - days * 86_400_000;
    return entries.filter((e) => {
      const t = new Date(e.measured_at).getTime();
      return Number.isFinite(t) && t >= cutoff;
    });
  }, [entries, range]);

  const stats = useMemo(
    () => computeStats(windowEntries, unit),
    [windowEntries, unit],
  );

  const refetch = useCallback(() => {
    setError(null);
    Promise.resolve(getToken())
      .then(async (t) => {
        if (!t) {
          router.replace("/login");
          return;
        }
        const list = await listBodyweight(t);
        setEntries(list);
        // Seed the unit toggle from the most recent reading so the
        // user doesn't keep flipping back to their preferred unit.
        if (list.length > 0) setUnit(list[0].unit);
      })
      .catch((err: Error) => {
        if (err.message.toLowerCase().includes("401")) {
          clearToken();
          router.replace("/login");
          return;
        }
        setError(err.message);
      });
  }, [router]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function handleSubmit() {
    setFormError(null);
    const w = Number(weight);
    if (!Number.isFinite(w) || w <= 0) {
      setFormError("Enter a weight greater than zero.");
      return;
    }
    setBusy(true);
    try {
      const t = await getToken();
      if (!t) throw new Error("not signed in");
      await createBodyweightEntry(t, { weight: w, unit });
      setWeight("");
      refetch();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setRowBusyID(id);
    try {
      const t = await getToken();
      if (!t) throw new Error("not signed in");
      await deleteBodyweightEntry(t, id);
      refetch();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRowBusyID(null);
    }
  }

  if (entries === null) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      data={entries}
      keyExtractor={(e) => e.id}
      contentContainerClassName="gap-2 px-4 pb-8"
      ListHeaderComponent={
        <View className="gap-3 pt-1">
          {error && (
            <View className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
              <Text className="text-xs text-danger">{error}</Text>
            </View>
          )}
          <View className="gap-2 rounded-lg border border-border bg-surface p-3">
            <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Log a reading
            </Text>
            <View className="flex-row items-center gap-2">
              <TextInput
                value={weight}
                onChangeText={setWeight}
                placeholder="0"
                placeholderTextColor="#71717a"
                keyboardType="decimal-pad"
                editable={!busy}
                className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              />
              <UnitToggle value={unit} onChange={setUnit} disabled={busy} />
              <Pressable
                onPress={handleSubmit}
                disabled={busy}
                accessibilityRole="button"
                className="rounded-md bg-accent px-3 py-1.5 active:opacity-80 disabled:opacity-50"
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-xs font-medium text-accent-fg">
                    Log
                  </Text>
                )}
              </Pressable>
            </View>
            {formError && (
              <Text className="text-xs text-danger">{formError}</Text>
            )}
          </View>
          <View className="gap-3 rounded-lg border border-border bg-surface p-3">
            <View className="flex-row items-center justify-between gap-2">
              <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                Trend
              </Text>
              <View className="min-w-[180px]">
                <SegmentedControl
                  value={range}
                  onChange={setRange}
                  segments={RANGE_SEGMENTS}
                  ariaLabel="Time range"
                />
              </View>
            </View>
            {stats ? (
              <>
                <BodyweightChart entries={windowEntries} unit={unit} />
                <View className="flex-row gap-2">
                  <StatTile label="Avg" value={stats.avg} unit={stats.unit} />
                  <StatTile label="Min" value={stats.min} unit={stats.unit} />
                  <StatTile label="Max" value={stats.max} unit={stats.unit} />
                </View>
              </>
            ) : (
              <View className="items-center justify-center py-6">
                <Text className="text-xs text-muted">
                  No readings in this range.
                </Text>
              </View>
            )}
          </View>
          <Text className="text-lg font-semibold text-foreground">
            History ({entries.length})
          </Text>
        </View>
      }
      ListEmptyComponent={
        <View className="rounded-lg border border-border bg-surface px-4 py-8">
          <Text className="text-center text-sm text-muted">
            No bodyweight readings yet.
          </Text>
        </View>
      }
      renderItem={({ item, index }) => {
        const prev = entries[index + 1];
        const delta =
          prev && prev.unit === item.unit ? item.weight - prev.weight : null;
        return (
          <View className="flex-row items-center justify-between rounded-lg border border-border bg-surface p-3">
            <View className="flex-1">
              <Text className="text-sm font-medium text-foreground tabular-nums">
                {formatNumber(item.weight)} {item.unit}
                {delta !== null && (
                  <Text
                    className={`text-xs ${
                      delta > 0
                        ? "text-danger"
                        : delta < 0
                          ? "text-accent"
                          : "text-muted"
                    }`}
                  >
                    {"  "}
                    {delta > 0 ? "+" : ""}
                    {formatNumber(delta)}
                  </Text>
                )}
              </Text>
              <Text className="mt-0.5 text-xs text-muted">
                {formatLocalDateTime(item.measured_at)}
              </Text>
            </View>
            <Pressable
              onPress={() => handleDelete(item.id)}
              disabled={rowBusyID === item.id}
              accessibilityRole="button"
              accessibilityLabel="Delete reading"
              hitSlop={8}
              className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 active:opacity-80 disabled:opacity-50"
            >
              {rowBusyID === item.id ? (
                <ActivityIndicator color="#ef4444" />
              ) : (
                <Text className="text-xs text-danger">Delete</Text>
              )}
            </Pressable>
          </View>
        );
      }}
    />
  );
}

function StatTile({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit: Unit;
}) {
  return (
    <View className="flex-1 rounded-md border border-border bg-background p-2">
      <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </Text>
      <Text className="mt-0.5 text-sm font-semibold text-foreground tabular-nums">
        {formatNumber(value)}{" "}
        <Text className="text-xs font-normal text-muted">{unit}</Text>
      </Text>
    </View>
  );
}

function UnitToggle({
  value,
  onChange,
  disabled,
}: {
  value: Unit;
  onChange: (next: Unit) => void;
  disabled?: boolean;
}) {
  return (
    <View className="flex-row rounded-md border border-border bg-background p-0.5">
      {(["lb", "kg"] as const).map((u) => {
        const active = u === value;
        return (
          <Pressable
            key={u}
            onPress={() => onChange(u)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            className={`rounded-sm px-2 py-1 ${
              active ? "bg-accent" : ""
            } active:opacity-80 disabled:opacity-50`}
          >
            <Text
              className={`text-xs font-medium ${
                active ? "text-accent-fg" : "text-muted"
              }`}
            >
              {u}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatLocalDateTime(rfc3339: string): string {
  const d = new Date(rfc3339);
  if (Number.isNaN(d.getTime())) return rfc3339;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
