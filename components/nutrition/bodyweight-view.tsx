// Bodyweight view inside the Nutrition tab. Multi-per-day-aware
// layout: time-range tabs (30/60/90/All), separator, 2×2 stat tiles
// (avg/min/max/delta), daily-average trend chart with same-day
// scatter, the log form (unchanged), and a paginated card list
// replacing the prior flat scrolled history. See
// prog-strength-docs/sows/bodyweight-multi-per-day.md.
//
// Single GET /bodyweight on mount. All filtering / aggregation /
// pagination happens client-side off the one fetched list.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
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
  type BodyweightStats,
} from "@/components/nutrition/bodyweight-chart";

type Unit = "lb" | "kg";

type RangeKey = "30" | "60" | "90" | "all";
const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: "30", label: "30D", days: 30 },
  { key: "60", label: "60D", days: 60 },
  { key: "90", label: "90D", days: 90 },
  { key: "all", label: "All", days: null },
];

const PAGE_SIZE = 20;

export function BodyweightView() {
  const router = useRouter();
  const [entries, setEntries] = useState<BodyweightEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weight, setWeight] = useState("");
  const [unit, setUnit] = useState<Unit>("lb");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowBusyID, setRowBusyID] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("30");
  const [page, setPage] = useState(1);

  const entriesInRange = useMemo(() => {
    if (!entries) return [];
    const sorted = [...entries].sort(
      (a, b) =>
        new Date(b.measured_at).getTime() - new Date(a.measured_at).getTime(),
    );
    const rangeDef = RANGES.find((r) => r.key === range);
    if (!rangeDef || rangeDef.days === null) return sorted;
    const cutoffMs = Date.now() - rangeDef.days * 86_400_000;
    return sorted.filter(
      (e) => new Date(e.measured_at).getTime() >= cutoffMs,
    );
  }, [entries, range]);

  const stats: BodyweightStats | null = useMemo(
    () => computeStats(entriesInRange, unit),
    [entriesInRange, unit],
  );

  const totalPages = Math.max(
    1,
    Math.ceil(entriesInRange.length / PAGE_SIZE),
  );
  const pageEntries = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return entriesInRange.slice(start, start + PAGE_SIZE);
  }, [entriesInRange, page]);

  // Reset to page 1 when the range changes so the user doesn't land
  // on an empty page after narrowing the window.
  useEffect(() => {
    setPage(1);
  }, [range]);

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
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-3 px-4 pb-8 pt-1"
    >
      {error && (
        <View className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
          <Text className="text-xs text-danger">{error}</Text>
        </View>
      )}

      <RangeTabs value={range} onChange={setRange} />

      <StatTilesGrid stats={stats} />

      <BodyweightChart entries={entriesInRange} unit={unit} />

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
              <Text className="text-xs font-medium text-accent-fg">Log</Text>
            )}
          </Pressable>
        </View>
        {formError && (
          <Text className="text-xs text-danger">{formError}</Text>
        )}
      </View>

      <Text className="mt-1 text-sm font-semibold text-foreground">
        Entries
      </Text>

      {entriesInRange.length === 0 ? (
        <View className="rounded-lg border border-border bg-surface px-4 py-8">
          <Text className="text-center text-sm text-muted">
            {entries.length === 0
              ? "No bodyweight readings yet."
              : "No readings in this range — try widening the time range above."}
          </Text>
        </View>
      ) : (
        <>
          <View className="gap-2">
            {pageEntries.map((e) => (
              <EntryCard
                key={e.id}
                entry={e}
                busy={rowBusyID === e.id}
                onDelete={() => handleDelete(e.id)}
              />
            ))}
          </View>
          {totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              totalCount={entriesInRange.length}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </ScrollView>
  );
}

// --- Range tabs --------------------------------------------------

function RangeTabs({
  value,
  onChange,
}: {
  value: RangeKey;
  onChange: (v: RangeKey) => void;
}) {
  // Border-b on the parent doubles as the SOW's "white separator"
  // between toolbar and content — same pattern the web side uses.
  return (
    <View className="flex-row items-center gap-2 border-b border-border pb-3">
      {RANGES.map((r) => {
        const selected = r.key === value;
        const bgClass = selected
          ? "bg-accent"
          : "bg-surface border border-border";
        const textClass = selected
          ? "text-accent-fg"
          : "text-foreground";
        return (
          <Pressable
            key={r.key}
            onPress={() => onChange(r.key)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            // translate-y-px on the selected tab gives the
            // "pressed in" feel the SOW asked for. The web side
            // adds an inset shadow too; on RN inset shadows aren't
            // a thing without third-party deps, so the translate +
            // accent fill is the visual stand-in.
            style={selected ? { transform: [{ translateY: 1 }] } : undefined}
            className={`rounded-md px-3 py-1.5 ${bgClass} active:opacity-80`}
          >
            <Text className={`text-xs font-medium ${textClass}`}>
              {r.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// --- Stat tile 2x2 grid -------------------------------------------

function StatTilesGrid({ stats }: { stats: BodyweightStats | null }) {
  // 2×2 grid (not 4-wide) so each tile gets enough phone-width room
  // for the larger number + sublabel to read cleanly.
  return (
    <View className="flex-row flex-wrap gap-2">
      <StatTile
        label="Avg"
        value={stats ? formatNumber(stats.avg) : "—"}
        unit={stats?.unit}
        sublabel={
          stats
            ? `${stats.count} reading${stats.count === 1 ? "" : "s"}`
            : "No data"
        }
      />
      <StatTile
        label="Min"
        value={stats ? formatNumber(stats.min) : "—"}
        unit={stats?.unit}
        sublabel="In range"
      />
      <StatTile
        label="Max"
        value={stats ? formatNumber(stats.max) : "—"}
        unit={stats?.unit}
        sublabel="In range"
      />
      <StatTile
        label="Delta"
        value={
          stats && stats.delta !== null
            ? `${stats.delta >= 0 ? "+" : ""}${formatNumber(stats.delta)}`
            : "—"
        }
        unit={stats?.unit}
        sublabel={
          stats && stats.deltaPercent !== null
            ? `${stats.deltaPercent >= 0 ? "+" : ""}${formatNumber(stats.deltaPercent)}%`
            : "Need 2+ days"
        }
      />
    </View>
  );
}

function StatTile({
  label,
  value,
  unit,
  sublabel,
}: {
  label: string;
  value: string;
  unit?: Unit;
  sublabel: string;
}) {
  return (
    <View className="min-w-[45%] flex-1 rounded-lg border border-border bg-surface p-3">
      <Text className="text-lg font-semibold tabular-nums text-foreground">
        {value}
        {unit && (
          <Text className="text-sm font-normal text-muted"> {unit}</Text>
        )}
      </Text>
      <Text className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </Text>
      <Text className="mt-0.5 text-[10px] text-muted">{sublabel}</Text>
    </View>
  );
}

// --- Entry card --------------------------------------------------

function EntryCard({
  entry,
  busy,
  onDelete,
}: {
  entry: BodyweightEntry;
  busy: boolean;
  onDelete: () => void;
}) {
  return (
    <View className="flex-row items-center justify-between rounded-lg border border-border bg-surface p-3">
      <View className="flex-1">
        <Text className="text-sm font-medium text-foreground tabular-nums">
          {formatNumber(entry.weight)}{" "}
          <Text className="text-xs font-normal text-muted">{entry.unit}</Text>
        </Text>
        <Text className="mt-0.5 text-xs text-muted">
          {formatLocalDateTime(entry.measured_at)}
        </Text>
      </View>
      <Pressable
        onPress={onDelete}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Delete reading"
        hitSlop={8}
        className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 active:opacity-80 disabled:opacity-50"
      >
        {busy ? (
          <ActivityIndicator color="#ef4444" />
        ) : (
          <Text className="text-xs text-danger">Delete</Text>
        )}
      </Pressable>
    </View>
  );
}

// --- Pagination --------------------------------------------------

function Pagination({
  page,
  totalPages,
  totalCount,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalCount: number;
  onPageChange: (p: number) => void;
}) {
  return (
    <View className="mt-1 flex-row items-center justify-between rounded-md border border-border bg-surface px-3 py-2">
      <Text className="text-xs tabular-nums text-muted">
        Page {page}/{totalPages} · {totalCount} total
      </Text>
      <View className="flex-row gap-1">
        <PageBtn
          label="‹"
          disabled={page === 1}
          onPress={() => onPageChange(page - 1)}
        />
        <PageBtn
          label="›"
          disabled={page === totalPages}
          onPress={() => onPageChange(page + 1)}
        />
      </View>
    </View>
  );
}

function PageBtn({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      className="h-7 w-7 items-center justify-center rounded-md border border-border bg-background active:opacity-80 disabled:opacity-30"
    >
      <Text className="text-sm font-semibold text-foreground">{label}</Text>
    </Pressable>
  );
}

// --- Unit toggle (unchanged) -------------------------------------

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

// --- helpers -----------------------------------------------------

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
