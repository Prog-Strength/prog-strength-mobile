// Bodyweight view inside the Nutrition tab. Multi-per-day-aware
// layout: time-range tabs (30/60/90/All), separator, 2×2 stat tiles
// (avg/min/max/delta/goal), daily-average trend chart with same-day
// scatter + optional goal reference line, the log form (unchanged),
// and a paginated card list with Edit + Delete row actions.
// See prog-strength-docs/sows/bodyweight-multi-per-day.md.
//
// Single GET /bodyweight + GET /me/bodyweight-goal on mount. All
// filtering / aggregation / pagination happens client-side.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
  getBodyweightGoal,
  listBodyweight,
  putBodyweightGoal,
  updateBodyweightEntry,
  type BodyweightEntry,
  type BodyweightGoal,
} from "@/lib/api";
import {
  BodyweightChart,
  computeStats,
  type BodyweightStats,
} from "@/components/nutrition/bodyweight-chart";
import { useProfile } from "@/lib/profile-context";
import { convertWeight, formatWeight } from "@/lib/units";

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
  const { profile } = useProfile();
  const preferred: Unit = profile?.weight_unit ?? "lb";
  const [entries, setEntries] = useState<BodyweightEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weight, setWeight] = useState("");
  const [unit, setUnit] = useState<Unit>("lb");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowBusyID, setRowBusyID] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("30");
  const [page, setPage] = useState(1);

  // Goal state
  const [goal, setGoal] = useState<BodyweightGoal | null>(null);
  const [showGoalSheet, setShowGoalSheet] = useState(false);

  // Entry edit state
  const [editingEntry, setEditingEntry] = useState<BodyweightEntry | null>(null);

  const entriesInRange = useMemo(() => {
    if (!entries) return [];
    const sorted = [...entries].sort(
      (a, b) => new Date(b.measured_at).getTime() - new Date(a.measured_at).getTime(),
    );
    const rangeDef = RANGES.find((r) => r.key === range);
    if (!rangeDef || rangeDef.days === null) return sorted;
    const cutoffMs = Date.now() - rangeDef.days * 86_400_000;
    return sorted.filter((e) => new Date(e.measured_at).getTime() >= cutoffMs);
  }, [entries, range]);

  const stats: BodyweightStats | null = useMemo(
    () => computeStats(entriesInRange, preferred),
    [entriesInRange, preferred],
  );

  const totalPages = Math.max(1, Math.ceil(entriesInRange.length / PAGE_SIZE));
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

  const refetchGoal = useCallback(() => {
    Promise.resolve(getToken())
      .then(async (t) => {
        if (!t) return;
        const g = await getBodyweightGoal(t);
        setGoal(g);
      })
      .catch(() => {
        // Goal fetch failure is non-fatal — the view still works without it.
      });
  }, []);

  useEffect(() => {
    refetch();
    refetchGoal();
  }, [refetch, refetchGoal]);

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

  async function handleEditSubmit(
    id: string,
    payload: { weight: number; unit: Unit },
  ): Promise<void> {
    const t = await getToken();
    if (!t) throw new Error("not signed in");
    await updateBodyweightEntry(t, id, payload);
    setEditingEntry(null);
    refetch();
  }

  // A goal counts as "set" only when it has a positive weight and a
  // server-assigned created_at — the empty-state (weight 0 / null
  // timestamps) means "no goal yet". Mirrors web's hasGoal check.
  const hasGoal = goal !== null && goal.weight > 0 && goal.created_at !== null;

  // Goal converted to the chart's display unit for passing into the chart.
  const goalInPreferred =
    hasGoal && goal ? convertWeight(goal.weight, goal.unit, preferred) : undefined;

  if (entries === null) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <>
      <ScrollView className="flex-1" contentContainerClassName="gap-3 px-4 pb-8 pt-1">
        {error && (
          <View className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
            <Text className="text-xs text-danger">{error}</Text>
          </View>
        )}

        <RangeTabs value={range} onChange={setRange} />

        <StatTilesGrid stats={stats} goal={hasGoal ? goal : null} preferred={preferred} />

        <BodyweightChart
          entries={entriesInRange}
          unit={preferred}
          goalY={goalInPreferred}
          goalLabel={
            goalInPreferred !== undefined
              ? `${formatNumber(goalInPreferred)} ${preferred}`
              : undefined
          }
        />

        {/* Goal affordance — mirrors web's GoalAffordance toolbar button */}
        <Pressable
          onPress={() => setShowGoalSheet(true)}
          accessibilityRole="button"
          accessibilityLabel={
            hasGoal && goal
              ? `Goal ${formatNumber(convertWeight(goal.weight, goal.unit, preferred))} ${preferred} — tap to edit`
              : "Set goal weight"
          }
          className="flex-row items-center gap-2 self-end rounded-md border border-border bg-surface px-3 py-2 active:opacity-80"
        >
          <Text className="text-xs font-semibold text-muted">Goal</Text>
          {hasGoal && goal ? (
            <Text className="text-xs font-semibold tabular-nums text-[#10b981]">
              {formatNumber(convertWeight(goal.weight, goal.unit, preferred))} {preferred}
            </Text>
          ) : (
            <Text className="text-xs italic text-muted">Not set</Text>
          )}
        </Pressable>

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
          {formError && <Text className="text-xs text-danger">{formError}</Text>}
        </View>

        <Text className="mt-1 text-sm font-semibold text-foreground">Entries</Text>

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
                  preferred={preferred}
                  busy={rowBusyID === e.id}
                  onEdit={() => setEditingEntry(e)}
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

      {/* Goal sheet */}
      <BodyweightGoalSheet
        open={showGoalSheet}
        goal={hasGoal ? goal : null}
        preferred={preferred}
        onSaved={(saved) => {
          setGoal(saved);
          setShowGoalSheet(false);
        }}
        onClose={() => setShowGoalSheet(false)}
      />

      {/* Entry edit sheet */}
      {editingEntry && (
        <BodyweightEditSheet
          entry={editingEntry}
          preferred={preferred}
          onSaved={async (payload) => {
            await handleEditSubmit(editingEntry.id, payload);
          }}
          onClose={() => setEditingEntry(null)}
        />
      )}
    </>
  );
}

// --- Range tabs --------------------------------------------------

function RangeTabs({ value, onChange }: { value: RangeKey; onChange: (v: RangeKey) => void }) {
  // Border-b on the parent doubles as the SOW's "white separator"
  // between toolbar and content — same pattern the web side uses.
  return (
    <View className="flex-row items-center gap-2 border-b border-border pb-3">
      {RANGES.map((r) => {
        const selected = r.key === value;
        const bgClass = selected ? "bg-accent" : "bg-surface border border-border";
        const textClass = selected ? "text-accent-fg" : "text-foreground";
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
            <Text className={`text-xs font-medium ${textClass}`}>{r.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// --- Stat tile 2x2 grid -------------------------------------------

function StatTilesGrid({
  stats,
  goal,
  preferred,
}: {
  stats: BodyweightStats | null;
  goal: BodyweightGoal | null;
  preferred: Unit;
}) {
  // Goal in the chart's display unit for the tile value.
  const goalValue =
    goal !== null && goal.weight > 0 ? convertWeight(goal.weight, goal.unit, preferred) : null;

  // "|goal − avg| to go" sublabel when both exist.
  const goalSublabel =
    goalValue !== null && stats !== null
      ? `${formatNumber(Math.abs(goalValue - stats.avg))} ${preferred} to go`
      : goal === null
        ? "Not set"
        : undefined;

  // 2×2 grid (not 4-wide) so each tile gets enough phone-width room
  // for the larger number + sublabel to read cleanly.
  return (
    <View className="flex-row flex-wrap gap-2">
      <StatTile
        label="Avg"
        value={stats ? formatNumber(stats.avg) : "—"}
        unit={stats?.unit}
        sublabel={stats ? `${stats.count} reading${stats.count === 1 ? "" : "s"}` : "No data"}
      />
      <StatTile
        label="Goal"
        value={goalValue !== null ? formatNumber(goalValue) : "—"}
        unit={goalValue !== null ? preferred : undefined}
        sublabel={goalSublabel ?? "Not set"}
        accentColor="#10b981"
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
  accentColor,
}: {
  label: string;
  value: string;
  unit?: Unit;
  sublabel: string;
  /** Optional color for the value text (e.g. goal tile uses green). */
  accentColor?: string;
}) {
  return (
    <View className="min-w-[45%] flex-1 rounded-lg border border-border bg-surface p-3">
      <Text
        className="text-lg font-semibold tabular-nums text-foreground"
        style={accentColor ? { color: accentColor } : undefined}
      >
        {value}
        {unit && (
          <Text className="text-sm font-normal text-muted" style={undefined}>
            {" "}
            {unit}
          </Text>
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
  preferred,
  busy,
  onEdit,
  onDelete,
}: {
  entry: BodyweightEntry;
  preferred: Unit;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  function showActions() {
    Alert.alert(
      formatWeight(entry.weight, entry.unit, preferred),
      formatLocalDateTime(entry.measured_at),
      [
        { text: "Edit", onPress: onEdit },
        {
          text: "Delete",
          style: "destructive",
          onPress: onDelete,
        },
        { text: "Cancel", style: "cancel" },
      ],
    );
  }

  return (
    <Pressable
      onPress={showActions}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={`${formatWeight(entry.weight, entry.unit, preferred)} — tap to edit or delete`}
      className="flex-row items-center justify-between rounded-lg border border-border bg-surface p-3 active:opacity-80 disabled:opacity-50"
    >
      <View className="flex-1">
        <Text className="text-sm font-medium text-foreground tabular-nums">
          {formatWeight(entry.weight, entry.unit, preferred)}
        </Text>
        <Text className="mt-0.5 text-xs text-muted">{formatLocalDateTime(entry.measured_at)}</Text>
      </View>
      {busy ? (
        <ActivityIndicator color="#a1a1aa" />
      ) : (
        <Text className="text-xs text-muted">•••</Text>
      )}
    </Pressable>
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
        <PageBtn label="‹" disabled={page === 1} onPress={() => onPageChange(page - 1)} />
        <PageBtn label="›" disabled={page === totalPages} onPress={() => onPageChange(page + 1)} />
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
            <Text className={`text-xs font-medium ${active ? "text-accent-fg" : "text-muted"}`}>
              {u}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// --- Goal sheet --------------------------------------------------

/**
 * Modal sheet for setting / editing the bodyweight goal. Mirrors the
 * macro-goals-sheet shell: pageSheet Modal + KeyboardAvoidingView +
 * header / scroll / footer. Weight input + lb/kg toggle; seeded from
 * the existing goal if set, otherwise falls back to the profile's
 * preferred unit.
 */
function BodyweightGoalSheet({
  open,
  goal,
  preferred,
  onSaved,
  onClose,
}: {
  open: boolean;
  goal: BodyweightGoal | null;
  preferred: Unit;
  onSaved: (saved: BodyweightGoal) => void;
  onClose: () => void;
}) {
  const [weightStr, setWeightStr] = useState(() =>
    goal && goal.weight > 0 ? String(goal.weight) : "",
  );
  const [unit, setUnit] = useState<Unit>(() => (goal ? goal.unit : preferred));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when the sheet reopens.
  useEffect(() => {
    if (!open) return;
    setWeightStr(goal && goal.weight > 0 ? String(goal.weight) : "");
    setUnit(goal ? goal.unit : preferred);
    setError(null);
  }, [open, goal, preferred]);

  async function save() {
    setError(null);
    const w = Number(weightStr);
    if (!Number.isFinite(w) || w <= 0) {
      setError("Goal weight must be a positive number.");
      return;
    }
    setSaving(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("not signed in");
      const saved = await putBodyweightGoal(token, { weight: w, unit });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const title = goal && goal.weight > 0 ? "Edit goal weight" : "Set goal weight";

  return (
    <Modal
      visible={open}
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      animationType="slide"
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 bg-background"
      >
        <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
          <View className="flex-1">
            <Text className="text-base font-semibold text-foreground">{title}</Text>
            <Text className="text-xs text-muted">Shows as a reference line on the chart.</Text>
          </View>
          <Pressable
            onPress={onClose}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={8}
            className="rounded p-1 active:opacity-80 disabled:opacity-50"
          >
            <Text className="text-base text-muted">✕</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerClassName="gap-4 px-4 py-4">
          <View className="gap-1">
            <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Goal weight
            </Text>
            <View className="flex-row items-center gap-2">
              <TextInput
                value={weightStr}
                onChangeText={setWeightStr}
                keyboardType="decimal-pad"
                placeholder="175"
                placeholderTextColor="#71717a"
                editable={!saving}
                autoFocus
                className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm tabular-nums text-foreground"
              />
              <UnitToggle value={unit} onChange={setUnit} disabled={saving} />
            </View>
          </View>

          {error && (
            <View className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
              <Text className="text-xs text-danger">{error}</Text>
            </View>
          )}
        </ScrollView>

        <View className="flex-row items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Pressable
            onPress={onClose}
            disabled={saving}
            accessibilityRole="button"
            className="rounded-md border border-border bg-surface px-3 py-2 active:opacity-80 disabled:opacity-50"
          >
            <Text className="text-sm text-foreground">Cancel</Text>
          </Pressable>
          <Pressable
            onPress={save}
            disabled={saving}
            accessibilityRole="button"
            className="rounded-md bg-accent px-4 py-2 active:opacity-80 disabled:opacity-50"
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-sm font-medium text-accent-fg">Save</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// --- Entry edit sheet --------------------------------------------

/**
 * Modal sheet for editing an existing bodyweight reading. Edits
 * weight + unit only (pure-JS, OTA-safe). measured_at editing is
 * deferred — it would require a native date-time picker to match the
 * web's datetime-local input, and adding a native module would break
 * the OTA-only constraint. The plan doc explicitly notes this as an
 * acceptable deferral.
 */
function BodyweightEditSheet({
  entry,
  preferred,
  onSaved,
  onClose,
}: {
  entry: BodyweightEntry;
  preferred: Unit;
  onSaved: (payload: { weight: number; unit: Unit }) => Promise<void>;
  onClose: () => void;
}) {
  const [weightStr, setWeightStr] = useState(() => String(entry.weight));
  const [unit, setUnit] = useState<Unit>(entry.unit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form if a different entry is selected.
  useEffect(() => {
    setWeightStr(String(entry.weight));
    setUnit(entry.unit);
    setError(null);
  }, [entry]);

  async function save() {
    setError(null);
    const w = Number(weightStr);
    if (!Number.isFinite(w) || w <= 0) {
      setError("Weight must be a positive number.");
      return;
    }
    setSaving(true);
    try {
      await onSaved({ weight: w, unit });
      // Success unmounts this sheet (parent clears editingEntry), so we
      // deliberately don't touch state here — only the error path, which
      // keeps the sheet open, resets the saving flag.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <Modal visible onRequestClose={onClose} presentationStyle="pageSheet" animationType="slide">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 bg-background"
      >
        <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
          <View className="flex-1">
            <Text className="text-base font-semibold text-foreground">Edit reading</Text>
            <Text className="text-xs text-muted">
              Fix weight or unit — the chart updates on save.
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={8}
            className="rounded p-1 active:opacity-80 disabled:opacity-50"
          >
            <Text className="text-base text-muted">✕</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerClassName="gap-4 px-4 py-4">
          <View className="gap-1">
            <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Weight
            </Text>
            <View className="flex-row items-center gap-2">
              <TextInput
                value={weightStr}
                onChangeText={setWeightStr}
                keyboardType="decimal-pad"
                placeholderTextColor="#71717a"
                editable={!saving}
                autoFocus
                className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm tabular-nums text-foreground"
              />
              <UnitToggle value={unit} onChange={setUnit} disabled={saving} />
            </View>
          </View>

          <View className="rounded-md border border-border bg-surface px-3 py-2">
            <Text className="text-[10px] text-muted">
              Logged: {formatLocalDateTime(entry.measured_at)}
            </Text>
            <Text className="mt-0.5 text-[10px] text-muted">
              measured_at editing deferred (requires native date picker — OTA-safe deferral per
              plan).
            </Text>
          </View>

          {error && (
            <View className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
              <Text className="text-xs text-danger">{error}</Text>
            </View>
          )}
        </ScrollView>

        <View className="flex-row items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Pressable
            onPress={onClose}
            disabled={saving}
            accessibilityRole="button"
            className="rounded-md border border-border bg-surface px-3 py-2 active:opacity-80 disabled:opacity-50"
          >
            <Text className="text-sm text-foreground">Cancel</Text>
          </Pressable>
          <Pressable
            onPress={save}
            disabled={saving}
            accessibilityRole="button"
            className="rounded-md bg-accent px-4 py-2 active:opacity-80 disabled:opacity-50"
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-sm font-medium text-accent-fg">Save</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
