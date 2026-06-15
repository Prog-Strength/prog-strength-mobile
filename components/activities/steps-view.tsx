// Steps segment of the Activities hub. Shows a stat-tile grid (avg /
// total / best day / goal attainment) above a daily-bar chart and a
// flat list of per-day step counts, all scoped to the active timeframe.
// Mirrors running-view.tsx's RN patterns (useFocusEffect, RefreshControl,
// danger-box error, ListEmptyComponent) and bodyweight-view.tsx's
// goal-setting + edit sheets.
//
// Steps are date-keyed (one row per calendar day): the chart + stats use
// the timeframe range fetch (since/until as YYYY-MM-DD); the list pages
// further via keyset (limit + before) when next_before is non-null.
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { clearToken, getToken } from "@/lib/auth";
import {
  deleteStepsForDate,
  getStepsGoal,
  listSteps,
  putStepsGoal,
  upsertStepsForDate,
  type StepsEntry,
  type StepsGoal,
} from "@/lib/api";
import {
  StepsChart,
  computeStepsStats,
  type StepsStats,
} from "@/components/activities/steps-chart";
import { type Timeframe, timeframeBounds } from "./timeframe-pills";

const PAGE_SIZE = 30;
const MAX_STEPS = 200_000;

// --- component -------------------------------------------------------

export function StepsView({ timeframe }: { timeframe: Timeframe }) {
  const router = useRouter();

  // Window (range-fetched) entries drive the chart + stats; the same
  // list seeds pagination, then keyset-loads older days on end-reached.
  const [entries, setEntries] = useState<StepsEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [goal, setGoal] = useState<StepsGoal | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowBusyDate, setRowBusyDate] = useState<string | null>(null);

  const [showGoalSheet, setShowGoalSheet] = useState(false);
  // null = closed; { date: null } = log a new day; { date } = edit a day.
  const [editing, setEditing] = useState<{ entry: StepsEntry | null } | null>(null);

  const load = useCallback(
    async (opts: { refreshing?: boolean } = {}) => {
      if (opts.refreshing) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) {
          router.replace("/login");
          return;
        }
        const bounds = timeframeBounds(timeframe);
        const range = { since: toDateString(bounds.since), until: toDateString(bounds.until) };
        const [page, g] = await Promise.all([
          listSteps(token, { ...range, limit: PAGE_SIZE }),
          getStepsGoal(token),
        ]);
        // API returns newest-first; sort defensively so the list is
        // always newest-first regardless of API changes.
        const sorted = [...page.steps].sort((a, b) => b.date.localeCompare(a.date));
        setEntries(sorted);
        setNextBefore(page.next_before);
        setGoal(g);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes("401")) {
          await clearToken();
          router.replace("/login");
          return;
        }
        setError(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router, timeframe],
  );

  const loadMore = useCallback(async () => {
    if (loadingMore || nextBefore === null) return;
    setLoadingMore(true);
    try {
      const token = await getToken();
      if (!token) return;
      const page = await listSteps(token, { limit: PAGE_SIZE, before: nextBefore });
      setEntries((prev) => {
        // Dedupe by date in case the cursor boundary overlaps.
        const seen = new Set(prev.map((e) => e.date));
        const merged = [...prev, ...page.steps.filter((e) => !seen.has(e.date))];
        return merged.sort((a, b) => b.date.localeCompare(a.date));
      });
      setNextBefore(page.next_before);
    } catch {
      // Non-fatal: a failed "load more" leaves the current page intact.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextBefore]);

  // useFocusEffect covers initial load + refetch-on-tab-return.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function handleDelete(date: string) {
    setRowBusyDate(date);
    try {
      const token = await getToken();
      if (!token) throw new Error("not signed in");
      await deleteStepsForDate(token, date);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRowBusyDate(null);
    }
  }

  const goalValue = goal && goal.goal > 0 ? goal.goal : undefined;
  const stats: StepsStats | null = computeStepsStats(entries, goalValue ?? 0);

  if (loading && entries.length === 0 && !error) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#fafafa" />
      </View>
    );
  }

  return (
    <>
      <FlatList
        className="flex-1 bg-background"
        contentContainerClassName="px-4 pb-6 gap-3"
        data={entries}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load({ refreshing: true })}
            tintColor="#fafafa"
          />
        }
        ItemSeparatorComponent={() => <View className="h-2" />}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (nextBefore !== null) void loadMore();
        }}
        ListHeaderComponent={
          <Header
            stats={stats}
            goalValue={goalValue}
            entries={entries}
            error={error}
            onSetGoal={() => setShowGoalSheet(true)}
            onLogDay={() => setEditing({ entry: null })}
          />
        }
        ListEmptyComponent={
          error ? null : (
            <View className="rounded-lg border border-border bg-surface px-4 py-6">
              <Text className="text-center text-sm font-medium text-foreground">
                No steps in this window.
              </Text>
              <Text className="mt-1 text-center text-xs text-muted">Log a day to get started.</Text>
            </View>
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <View className="py-3">
              <ActivityIndicator color="#fafafa" />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <StepsRow
            entry={item}
            busy={rowBusyDate === item.date}
            goalValue={goalValue}
            onEdit={() => setEditing({ entry: item })}
            onDelete={() => handleDelete(item.date)}
          />
        )}
      />

      {/* Goal sheet */}
      <StepsGoalSheet
        open={showGoalSheet}
        goal={goalValue !== undefined ? (goal as StepsGoal) : null}
        onSaved={(saved) => {
          setGoal(saved);
          setShowGoalSheet(false);
        }}
        onClose={() => setShowGoalSheet(false)}
      />

      {/* Log / edit a day */}
      {editing && (
        <StepsEntrySheet
          entry={editing.entry}
          onSaved={() => {
            setEditing(null);
            load();
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

// --- Header (stat tiles + chart + affordances) -----------------------

function Header({
  stats,
  goalValue,
  entries,
  error,
  onSetGoal,
  onLogDay,
}: {
  stats: StepsStats | null;
  goalValue: number | undefined;
  entries: StepsEntry[];
  error: string | null;
  onSetGoal: () => void;
  onLogDay: () => void;
}) {
  const attainmentPct =
    stats && stats.goalAttainment !== null ? Math.round(stats.goalAttainment * 100) : null;

  return (
    <View className="gap-3 py-3">
      {/* Log-a-day button */}
      <Pressable
        onPress={onLogDay}
        accessibilityRole="button"
        accessibilityLabel="Log steps for a day"
        style={{ minHeight: 44 }}
        className="flex-row items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 active:opacity-80"
      >
        <Ionicons name="add-circle-outline" size={18} color="#fafafa" />
        <Text className="text-sm font-medium text-foreground">Log steps</Text>
      </Pressable>

      {error && (
        <View className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2">
          <Text className="text-sm text-danger">{error}</Text>
        </View>
      )}

      {/* Stat tiles 2×2 */}
      <View className="flex-row flex-wrap gap-3">
        <StatTile
          label="Avg daily"
          value={stats ? formatSteps(Math.round(stats.avg)) : "—"}
          sublabel={stats ? `${stats.count} day${stats.count === 1 ? "" : "s"}` : "No data"}
        />
        <StatTile
          label="Total"
          value={stats ? formatSteps(stats.total) : "—"}
          sublabel="In range"
        />
        <StatTile
          label="Best day"
          value={stats ? formatSteps(stats.best) : "—"}
          sublabel="In range"
        />
        <StatTile
          label="Goal"
          value={goalValue !== undefined ? formatSteps(goalValue) : "—"}
          sublabel={
            attainmentPct !== null
              ? `${attainmentPct}% of goal`
              : goalValue === undefined
                ? "Not set"
                : "No data"
          }
          accentColor="#10b981"
        />
      </View>

      {/* Chart */}
      <StepsChart
        entries={entries}
        goalY={goalValue}
        goalLabel={goalValue !== undefined ? formatSteps(goalValue) : undefined}
      />

      {/* Goal affordance */}
      <Pressable
        onPress={onSetGoal}
        accessibilityRole="button"
        accessibilityLabel={
          goalValue !== undefined ? `Goal ${goalValue} steps — tap to edit` : "Set steps goal"
        }
        className="flex-row items-center gap-2 self-end rounded-md border border-border bg-surface px-3 py-2 active:opacity-80"
      >
        <Text className="text-xs font-semibold text-muted">Goal</Text>
        {goalValue !== undefined ? (
          <Text className="text-xs font-semibold tabular-nums text-[#10b981]">
            {formatSteps(goalValue)}
          </Text>
        ) : (
          <Text className="text-xs italic text-muted">Not set</Text>
        )}
      </Pressable>

      <Text className="mt-1 text-sm font-semibold text-foreground">Daily log</Text>
    </View>
  );
}

// Each tile takes ~47% of the row → 2×2 grid (mirrors running-view MetricTile).
function StatTile({
  label,
  value,
  sublabel,
  accentColor,
}: {
  label: string;
  value: string;
  sublabel: string;
  accentColor?: string;
}) {
  return (
    <View
      style={{ flexBasis: "47%" }}
      className="rounded-lg border border-border bg-surface px-3 py-3"
    >
      <Text
        className="text-base font-semibold tabular-nums text-foreground"
        numberOfLines={1}
        style={accentColor ? { color: accentColor } : undefined}
      >
        {value}
      </Text>
      <Text
        className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted"
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text className="mt-0.5 text-[10px] text-muted" numberOfLines={1}>
        {sublabel}
      </Text>
    </View>
  );
}

// --- StepsRow --------------------------------------------------------

function StepsRow({
  entry,
  busy,
  goalValue,
  onEdit,
  onDelete,
}: {
  entry: StepsEntry;
  busy: boolean;
  goalValue: number | undefined;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hitGoal = goalValue !== undefined && entry.steps >= goalValue;

  function showActions() {
    Alert.alert(formatSteps(entry.steps), formatDayLabel(entry.date), [
      { text: "Edit", onPress: onEdit },
      { text: "Delete", style: "destructive", onPress: onDelete },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  return (
    <Pressable
      onPress={showActions}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={`${formatSteps(entry.steps)} steps on ${formatDayLabel(entry.date)} — tap to edit or delete`}
      style={{ minHeight: 44 }}
      className="flex-row items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 active:opacity-80 disabled:opacity-50"
    >
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-baseline justify-between gap-2">
          <Text className="text-base font-medium tabular-nums text-foreground">
            {formatSteps(entry.steps)}
          </Text>
          <Text className="text-xs text-muted">{formatDayLabel(entry.date)}</Text>
        </View>
        {hitGoal && <Text className="text-xs text-[#10b981]">Goal reached</Text>}
      </View>
      {busy ? (
        <ActivityIndicator color="#a1a1aa" />
      ) : (
        <Text className="text-xs text-muted">•••</Text>
      )}
    </Pressable>
  );
}

// --- Goal sheet ------------------------------------------------------

function StepsGoalSheet({
  open,
  goal,
  onSaved,
  onClose,
}: {
  open: boolean;
  goal: StepsGoal | null;
  onSaved: (saved: StepsGoal) => void;
  onClose: () => void;
}) {
  const [goalStr, setGoalStr] = useState(() => (goal && goal.goal > 0 ? String(goal.goal) : ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setGoalStr(goal && goal.goal > 0 ? String(goal.goal) : "");
    setError(null);
  }, [open, goal]);

  async function save() {
    setError(null);
    const g = Number(goalStr);
    if (!Number.isInteger(g) || g <= 0 || g > MAX_STEPS) {
      setError(`Goal must be a whole number between 1 and ${formatSteps(MAX_STEPS)}.`);
      return;
    }
    setSaving(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("not signed in");
      const saved = await putStepsGoal(token, { goal: g });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const title = goal && goal.goal > 0 ? "Edit daily steps goal" : "Set daily steps goal";

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
        <SheetHeader
          title={title}
          subtitle="Shows as a reference line on the chart."
          disabled={saving}
          onClose={onClose}
        />

        <ScrollView contentContainerClassName="gap-4 px-4 py-4">
          <View className="gap-1">
            <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Daily goal (steps)
            </Text>
            <TextInput
              value={goalStr}
              onChangeText={setGoalStr}
              keyboardType="number-pad"
              placeholder="10000"
              placeholderTextColor="#71717a"
              editable={!saving}
              autoFocus
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm tabular-nums text-foreground"
            />
          </View>

          {error && (
            <View className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
              <Text className="text-xs text-danger">{error}</Text>
            </View>
          )}
        </ScrollView>

        <SheetFooter saving={saving} onClose={onClose} onSave={save} />
      </KeyboardAvoidingView>
    </Modal>
  );
}

// --- Entry log / edit sheet ------------------------------------------

function StepsEntrySheet({
  entry,
  onSaved,
  onClose,
}: {
  /** null → logging a new day (date editable); set → editing that day. */
  entry: StepsEntry | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [dateStr, setDateStr] = useState(() => entry?.date ?? todayDateString());
  const [stepsStr, setStepsStr] = useState(() => (entry ? String(entry.steps) : ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editingExisting = entry !== null;

  async function save() {
    setError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || Number.isNaN(Date.parse(dateStr))) {
      setError("Date must be a valid YYYY-MM-DD.");
      return;
    }
    const s = Number(stepsStr);
    if (!Number.isInteger(s) || s < 0 || s > MAX_STEPS) {
      setError(`Steps must be a whole number between 0 and ${formatSteps(MAX_STEPS)}.`);
      return;
    }
    setSaving(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("not signed in");
      await upsertStepsForDate(token, dateStr, s);
      onSaved();
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
        <SheetHeader
          title={editingExisting ? "Edit steps" : "Log steps"}
          subtitle={editingExisting ? formatDayLabel(entry.date) : "Enter the count for a day."}
          disabled={saving}
          onClose={onClose}
        />

        <ScrollView contentContainerClassName="gap-4 px-4 py-4">
          <View className="gap-1">
            <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Date
            </Text>
            <TextInput
              value={dateStr}
              onChangeText={setDateStr}
              placeholder="2026-06-15"
              placeholderTextColor="#71717a"
              editable={!saving && !editingExisting}
              autoCapitalize="none"
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm tabular-nums text-foreground disabled:opacity-60"
            />
            {editingExisting && (
              <Text className="text-[10px] text-muted">
                Date is the key for a day and can&apos;t be changed — delete and re-log to move it.
              </Text>
            )}
          </View>

          <View className="gap-1">
            <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Steps
            </Text>
            <TextInput
              value={stepsStr}
              onChangeText={setStepsStr}
              keyboardType="number-pad"
              placeholder="8000"
              placeholderTextColor="#71717a"
              editable={!saving}
              autoFocus
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm tabular-nums text-foreground"
            />
          </View>

          {error && (
            <View className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
              <Text className="text-xs text-danger">{error}</Text>
            </View>
          )}
        </ScrollView>

        <SheetFooter saving={saving} onClose={onClose} onSave={save} />
      </KeyboardAvoidingView>
    </Modal>
  );
}

// --- shared sheet chrome ---------------------------------------------

function SheetHeader({
  title,
  subtitle,
  disabled,
  onClose,
}: {
  title: string;
  subtitle: string;
  disabled: boolean;
  onClose: () => void;
}) {
  return (
    <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
      <View className="flex-1">
        <Text className="text-base font-semibold text-foreground">{title}</Text>
        <Text className="text-xs text-muted">{subtitle}</Text>
      </View>
      <Pressable
        onPress={onClose}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Close"
        hitSlop={8}
        className="rounded p-1 active:opacity-80 disabled:opacity-50"
      >
        <Text className="text-base text-muted">✕</Text>
      </Pressable>
    </View>
  );
}

function SheetFooter({
  saving,
  onClose,
  onSave,
}: {
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
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
        onPress={onSave}
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
  );
}

// --- helpers ---------------------------------------------------------

/** RFC3339 timestamp (or undefined) → YYYY-MM-DD (local), or undefined. */
function toDateString(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return localDateString(d);
}

function todayDateString(): string {
  return localDateString(new Date());
}

function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatSteps(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** YYYY-MM-DD → "Thu, Jun 11" (parsed as a local date, no TZ shift). */
function formatDayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
