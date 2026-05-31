// Today view inside the Nutrition tab. Date-navigable per-meal log
// matching the web /nutrition page. Date math is local-time (the
// SOW's TZ decision); the API call uses UTC bounds derived from the
// local-day boundaries.
//
// UX adaptations from web → mobile:
//   - No native date-picker for v1 (would need an extra dep). Prev /
//     next / Today buttons plus a clear date label cover it.
//   - Quick-add is a single bottom-sticky row: meal pills + item
//     picker (collapsible list) + servings + Log button.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { clearToken, getToken } from "@/lib/auth";
import {
  createNutritionLogEntry,
  deleteNutritionLogEntry,
  getMacroGoals,
  listNutritionLog,
  listPantryItems,
  listRecipes,
  type MacroGoals,
  type MealType,
  type NutritionLogEntry,
  type PantryItem,
  type Recipe,
} from "@/lib/api";
import { MacroGoalRings } from "@/components/nutrition/macro-goal-rings";
import { MacroGoalsSheet } from "@/components/nutrition/macro-goals-sheet";
import { QuickAddSheet } from "@/components/nutrition/quick-add-sheet";

// Pin the meal section order regardless of API response ordering.
// What users mentally expect a day to read like.
const MEAL_ORDER: MealType[] = ["breakfast", "lunch", "dinner", "snack"];
const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snacks",
};

export function TodayView() {
  const router = useRouter();
  const [date, setDate] = useState<Date>(() => startOfLocalDay(new Date()));
  const [entries, setEntries] = useState<NutritionLogEntry[] | null>(null);
  const [pantry, setPantry] = useState<PantryItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [goals, setGoals] = useState<MacroGoals | null>(null);
  const [showGoalsSheet, setShowGoalsSheet] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logBusy, setLogBusy] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [rowBusyID, setRowBusyID] = useState<string | null>(null);

  const refetch = useCallback(
    (d: Date) => {
      const token = getToken();
      Promise.resolve(token)
        .then(async (t) => {
          if (!t) {
            router.replace("/login");
            return;
          }
          const since = d.toISOString();
          const until = endOfLocalDay(d).toISOString();
          const [log, p, r, mg] = await Promise.all([
            listNutritionLog(t, { since, until }),
            listPantryItems(t),
            listRecipes(t),
            getMacroGoals(t),
          ]);
          setEntries(log);
          setPantry(p);
          setRecipes(r);
          setGoals(mg);
        })
        .catch((err: Error) => {
          if (err.message.toLowerCase().includes("401")) {
            clearToken();
            router.replace("/login");
            return;
          }
          setError(err.message);
        });
    },
    [router],
  );

  useEffect(() => {
    refetch(date);
  }, [date, refetch]);

  const pantryByID = useMemo(() => {
    const m = new Map<string, PantryItem>();
    for (const p of pantry) m.set(p.id, p);
    return m;
  }, [pantry]);
  const recipeByID = useMemo(() => {
    const m = new Map<string, Recipe>();
    for (const r of recipes) m.set(r.id, r);
    return m;
  }, [recipes]);

  const totals = useMemo(() => {
    const out = { calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0 };
    for (const e of entries ?? []) {
      out.calories += e.calories;
      out.protein_g += e.protein_g;
      out.fat_g += e.fat_g;
      out.carbs_g += e.carbs_g;
    }
    return out;
  }, [entries]);

  // Returns a Promise so the QuickAddSheet can close itself on
  // success: the sheet awaits this; on resolve it dismisses, on
  // reject it stays open and reads the error from `logError`. The
  // catch sets `logError` before re-throwing so the sheet sees the
  // latest message.
  function handleLog(
    source: { kind: "pantry" | "recipe"; id: string },
    quantity: number,
    meal: MealType,
  ): Promise<void> {
    const isToday = sameLocalDay(date, new Date());
    const consumedAt = isToday
      ? new Date()
      : new Date(date.getTime() + 12 * 60 * 60 * 1000);
    setLogBusy(true);
    setLogError(null);
    return Promise.resolve(getToken())
      .then(async (t) => {
        if (!t) {
          router.replace("/login");
          throw new Error("not signed in");
        }
        const entry = await createNutritionLogEntry(t, {
          ...(source.kind === "pantry"
            ? { pantry_item_id: source.id }
            : { recipe_id: source.id }),
          quantity,
          meal,
          consumed_at: consumedAt.toISOString(),
        });
        setEntries((prev) => (prev ? [entry, ...prev] : [entry]));
      })
      .catch((err: Error) => {
        setLogError(err.message);
        throw err;
      })
      .finally(() => setLogBusy(false));
  }

  function handleDelete(ids: string[]) {
    if (ids.length === 0) return;
    const groupKey = ids.join(",");
    setRowBusyID(groupKey);
    Promise.resolve(getToken())
      .then(async (t) => {
        if (!t) return;
        await Promise.all(ids.map((id) => deleteNutritionLogEntry(t, id)));
        const removed = new Set(ids);
        setEntries((prev) =>
          prev ? prev.filter((e) => !removed.has(e.id)) : prev,
        );
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setRowBusyID(null));
  }

  return (
    <View className="flex-1">
      <DateNav value={date} onChange={setDate} />

      {error && (
        <View className="mx-4 mb-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
          <Text className="text-xs text-danger">{error}</Text>
        </View>
      )}

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-4 gap-4"
      >
        {goals && (
          <MacroGoalRings
            totals={totals}
            goals={goals}
            onSetGoals={() => setShowGoalsSheet(true)}
          />
        )}

        <Pressable
          onPress={() => setShowQuickAdd(true)}
          accessibilityRole="button"
          accessibilityLabel="Quick add"
          className="items-center self-end rounded-md bg-accent px-4 py-2 active:opacity-80"
        >
          <Text className="text-sm font-medium text-accent-fg">+ Quick add</Text>
        </Pressable>

        {entries === null ? (
          <View className="items-center py-6">
            <ActivityIndicator color="#fafafa" />
          </View>
        ) : (
          <MealSections
            entries={entries}
            pantryByID={pantryByID}
            recipeByID={recipeByID}
            rowBusyID={rowBusyID}
            onDelete={handleDelete}
          />
        )}
      </ScrollView>

      {goals && (
        <MacroGoalsSheet
          open={showGoalsSheet}
          initial={goals}
          onSaved={(saved) => {
            setGoals(saved);
            setShowGoalsSheet(false);
          }}
          onClose={() => setShowGoalsSheet(false)}
        />
      )}

      <QuickAddSheet
        open={showQuickAdd}
        pantry={pantry}
        recipes={recipes}
        busy={logBusy}
        error={logError}
        onLog={handleLog}
        onClose={() => setShowQuickAdd(false)}
      />
    </View>
  );
}

// --- Date nav -----------------------------------------------------

function DateNav({
  value,
  onChange,
}: {
  value: Date;
  onChange: (d: Date) => void;
}) {
  const isToday = sameLocalDay(value, new Date());
  const label = value.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return (
    <View className="flex-row items-center justify-between gap-3 px-4 pb-3">
      <View className="flex-row items-center gap-2">
        <NavBtn label="‹" onPress={() => onChange(addDays(value, -1))} />
        <Text className="text-sm font-medium text-foreground">{label}</Text>
        <NavBtn label="›" onPress={() => onChange(addDays(value, 1))} />
      </View>
      {!isToday && (
        <Pressable
          onPress={() => onChange(startOfLocalDay(new Date()))}
          accessibilityRole="button"
          className="rounded-full border border-border bg-surface px-3 py-1 active:opacity-80"
        >
          <Text className="text-xs font-medium text-foreground">Today</Text>
        </Pressable>
      )}
    </View>
  );
}

function NavBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="h-7 w-7 items-center justify-center rounded-full border border-border bg-surface active:opacity-80"
    >
      <Text className="text-base font-semibold text-foreground">{label}</Text>
    </Pressable>
  );
}


// --- Meal sections ------------------------------------------------

function MealSections({
  entries,
  pantryByID,
  recipeByID,
  rowBusyID,
  onDelete,
}: {
  entries: NutritionLogEntry[];
  pantryByID: Map<string, PantryItem>;
  recipeByID: Map<string, Recipe>;
  rowBusyID: string | null;
  onDelete: (ids: string[]) => void;
}) {
  const byMeal = useMemo(() => {
    const m: Record<MealType, NutritionLogEntry[]> = {
      breakfast: [],
      lunch: [],
      dinner: [],
      snack: [],
    };
    for (const e of entries) m[e.meal].push(e);
    return m;
  }, [entries]);
  if (entries.length === 0) {
    return (
      <View className="rounded-lg border border-border bg-surface px-4 py-6">
        <Text className="text-center text-sm font-medium text-foreground">
          Nothing logged on this day yet
        </Text>
        <Text className="mt-1 text-center text-xs text-muted">
          Use Quick-add above, or chat the agent.
        </Text>
      </View>
    );
  }
  return (
    <View className="gap-3">
      {MEAL_ORDER.map((m) => (
        <MealSection
          key={m}
          meal={m}
          entries={byMeal[m]}
          pantryByID={pantryByID}
          recipeByID={recipeByID}
          rowBusyID={rowBusyID}
          onDelete={onDelete}
        />
      ))}
    </View>
  );
}

type EntryGroup = {
  key: string;
  name: string;
  isRecipe: boolean;
  quantity: number;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  entryIDs: string[];
};

function MealSection({
  meal,
  entries,
  pantryByID,
  recipeByID,
  rowBusyID,
  onDelete,
}: {
  meal: MealType;
  entries: NutritionLogEntry[];
  pantryByID: Map<string, PantryItem>;
  recipeByID: Map<string, Recipe>;
  rowBusyID: string | null;
  onDelete: (ids: string[]) => void;
}) {
  // Collapse multiple logs of the same pantry item / recipe inside a
  // single meal into one row so a snack of "Apple × 3" reads as one
  // line instead of three duplicates. Quantity and macros sum across
  // the group.
  const groups = useMemo<EntryGroup[]>(() => {
    const map = new Map<string, EntryGroup>();
    const order: string[] = [];
    for (const e of entries) {
      const name = e.pantry_item_id
        ? (pantryByID.get(e.pantry_item_id)?.name ?? "Unknown item")
        : e.recipe_id
          ? (recipeByID.get(e.recipe_id)?.name ?? "Unknown recipe")
          : "Untitled entry";
      const key = e.pantry_item_id
        ? `pantry:${e.pantry_item_id}`
        : e.recipe_id
          ? `recipe:${e.recipe_id}`
          : `name:${name}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          name,
          isRecipe: !!e.recipe_id,
          quantity: 0,
          calories: 0,
          protein_g: 0,
          fat_g: 0,
          carbs_g: 0,
          entryIDs: [],
        };
        map.set(key, g);
        order.push(key);
      }
      g.quantity += e.quantity;
      g.calories += e.calories;
      g.protein_g += e.protein_g;
      g.fat_g += e.fat_g;
      g.carbs_g += e.carbs_g;
      g.entryIDs.push(e.id);
    }
    return order.map((k) => map.get(k) as EntryGroup);
  }, [entries, pantryByID, recipeByID]);

  const subtotal = useMemo(() => {
    const t = { calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0 };
    for (const e of entries) {
      t.calories += e.calories;
      t.protein_g += e.protein_g;
      t.fat_g += e.fat_g;
      t.carbs_g += e.carbs_g;
    }
    return t;
  }, [entries]);
  return (
    <View className="gap-2">
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="text-sm font-semibold text-foreground">
          {MEAL_LABELS[meal]}
        </Text>
        <Text className="text-xs tabular-nums text-muted">
          {entries.length === 0
            ? "No entries"
            : `${formatNumber(subtotal.calories)} cal · P ${formatNumber(
                subtotal.protein_g,
              )}g · F ${formatNumber(subtotal.fat_g)}g · C ${formatNumber(
                subtotal.carbs_g,
              )}g`}
        </Text>
      </View>
      {groups.map((g) => {
        const busyKey = g.entryIDs.join(",");
        return (
          <EntryGroupRow
            key={g.key}
            group={g}
            busy={rowBusyID === busyKey}
            onDelete={() => onDelete(g.entryIDs)}
          />
        );
      })}
    </View>
  );
}

function EntryGroupRow({
  group,
  busy,
  onDelete,
}: {
  group: EntryGroup;
  busy: boolean;
  onDelete: () => void;
}) {
  const logCount = group.entryIDs.length;
  return (
    <View className="flex-row items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2">
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
          {group.name}{" "}
          <Text className="text-xs tabular-nums text-muted">
            × {formatNumber(group.quantity)}
          </Text>
          {group.isRecipe && (
            <Text className="ml-1 text-[10px] uppercase tracking-wider text-muted">
              {" "}
              recipe
            </Text>
          )}
          {logCount > 1 && (
            <Text className="text-[10px] uppercase tracking-wider text-muted">
              {"  "}
              {logCount} logs
            </Text>
          )}
        </Text>
        <Text className="text-xs tabular-nums text-muted">
          {formatNumber(group.calories)} cal · P {formatNumber(group.protein_g)}g
          · F {formatNumber(group.fat_g)}g · C {formatNumber(group.carbs_g)}g
        </Text>
      </View>
      <Pressable
        onPress={onDelete}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={
          logCount > 1 ? `Delete all ${logCount} logs` : "Delete"
        }
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

// --- helpers ------------------------------------------------------

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return startOfLocalDay(out);
}

function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
