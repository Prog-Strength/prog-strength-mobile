// Today view inside the Nutrition tab. Date-navigable per-meal log
// matching the web /nutrition page. Date math is local-time (the
// SOW's TZ decision); the API call uses UTC bounds derived from the
// local-day boundaries.
//
// UX adaptations from web → mobile:
//   - No native date-picker for v1 (would need an extra dep). Prev /
//     next / Today buttons plus a clear date label cover it.
//   - Macro tiles are 2×2 on phone widths instead of 4-up.
//   - Quick-add is a single bottom-sticky row: meal pills + item
//     picker (collapsible list) + servings + Log button.
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
  createNutritionLogEntry,
  deleteNutritionLogEntry,
  listNutritionLog,
  listPantryItems,
  listRecipes,
  type MealType,
  type NutritionLogEntry,
  type PantryItem,
  type Recipe,
} from "@/lib/api";
import { SegmentedControl, type Segment } from "@/components/segmented-control";

// Pin the meal section order regardless of API response ordering.
// What users mentally expect a day to read like.
const MEAL_ORDER: MealType[] = ["breakfast", "lunch", "dinner", "snack"];
const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snacks",
};
const MEAL_SEGMENTS: readonly Segment<MealType>[] = [
  { value: "breakfast", label: "B" },
  { value: "lunch", label: "L" },
  { value: "dinner", label: "D" },
  { value: "snack", label: "S" },
];

export function TodayView() {
  const router = useRouter();
  const [date, setDate] = useState<Date>(() => startOfLocalDay(new Date()));
  const [entries, setEntries] = useState<NutritionLogEntry[] | null>(null);
  const [pantry, setPantry] = useState<PantryItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
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
          const [log, p, r] = await Promise.all([
            listNutritionLog(t, { since, until }),
            listPantryItems(t),
            listRecipes(t),
          ]);
          setEntries(log);
          setPantry(p);
          setRecipes(r);
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

  function handleLog(
    source: { kind: "pantry" | "recipe"; id: string },
    quantity: number,
    meal: MealType,
  ) {
    const isToday = sameLocalDay(date, new Date());
    const consumedAt = isToday
      ? new Date()
      : new Date(date.getTime() + 12 * 60 * 60 * 1000);
    setLogBusy(true);
    setLogError(null);
    Promise.resolve(getToken())
      .then(async (t) => {
        if (!t) {
          router.replace("/login");
          return;
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
      .catch((err: Error) => setLogError(err.message))
      .finally(() => setLogBusy(false));
  }

  function handleDelete(id: string) {
    setRowBusyID(id);
    Promise.resolve(getToken())
      .then(async (t) => {
        if (!t) return;
        await deleteNutritionLogEntry(t, id);
        setEntries((prev) => (prev ? prev.filter((e) => e.id !== id) : prev));
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
        <MacroSummary totals={totals} entryCount={entries?.length ?? 0} />

        <QuickAdd
          pantry={pantry}
          recipes={recipes}
          busy={logBusy}
          error={logError}
          onLog={handleLog}
        />

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

// --- Macro tiles --------------------------------------------------

function MacroSummary({
  totals,
  entryCount,
}: {
  totals: { calories: number; protein_g: number; fat_g: number; carbs_g: number };
  entryCount: number;
}) {
  // % of macro-calories per the 4/4/9 per-gram math.
  const proteinCal = totals.protein_g * 4;
  const carbCal = totals.carbs_g * 4;
  const fatCal = totals.fat_g * 9;
  const totalMacroCal = proteinCal + carbCal + fatCal;
  const pct = (n: number) =>
    totalMacroCal > 0 ? Math.round((n / totalMacroCal) * 100) : 0;
  return (
    <View className="flex-row flex-wrap gap-2">
      <Tile
        flex
        label="Calories"
        value={formatNumber(totals.calories)}
        sub={`${entryCount} ${entryCount === 1 ? "entry" : "entries"}`}
      />
      <Tile
        flex
        label="Protein"
        value={`${formatNumber(totals.protein_g)} g`}
        sub={`${pct(proteinCal)}% of macros`}
        accent="text-emerald-300"
      />
      <Tile
        flex
        label="Carbs"
        value={`${formatNumber(totals.carbs_g)} g`}
        sub={`${pct(carbCal)}% of macros`}
        accent="text-amber-300"
      />
      <Tile
        flex
        label="Fat"
        value={`${formatNumber(totals.fat_g)} g`}
        sub={`${pct(fatCal)}% of macros`}
        accent="text-pink-300"
      />
    </View>
  );
}

function Tile({
  label,
  value,
  sub,
  accent,
  flex,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: string;
  flex?: boolean;
}) {
  return (
    <View
      className={`rounded-lg border border-border bg-surface px-3 py-2 ${
        flex ? "min-w-[45%] flex-1" : ""
      }`}
    >
      <Text
        className={`text-lg font-semibold tabular-nums ${accent ?? "text-foreground"}`}
      >
        {value}
      </Text>
      <Text className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </Text>
      <Text className="mt-0.5 text-[10px] text-muted">{sub}</Text>
    </View>
  );
}

// --- Quick-add ----------------------------------------------------

function QuickAdd({
  pantry,
  recipes,
  busy,
  error,
  onLog,
}: {
  pantry: PantryItem[];
  recipes: Recipe[];
  busy: boolean;
  error: string | null;
  onLog: (
    source: { kind: "pantry" | "recipe"; id: string },
    quantity: number,
    meal: MealType,
  ) => void;
}) {
  const [meal, setMeal] = useState<MealType>(() =>
    defaultMealForLocalHour(new Date()),
  );
  const [selection, setSelection] = useState<{
    kind: "pantry" | "recipe";
    id: string;
    label: string;
  } | null>(null);
  const [quantity, setQuantity] = useState<string>("1");
  const [pickerOpen, setPickerOpen] = useState(false);

  if (pantry.length === 0 && recipes.length === 0) {
    return (
      <View className="rounded-lg border border-border bg-surface px-4 py-6">
        <Text className="text-center text-sm font-medium text-foreground">
          Add a pantry item first
        </Text>
        <Text className="mt-1 text-center text-xs text-muted">
          The Pantry tab lets you save foods you eat often.
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-2 rounded-lg border border-border bg-surface p-3">
      <View className="flex-row items-center gap-2">
        <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Quick-add
        </Text>
        <View className="flex-1" />
        <View className="w-44">
          <SegmentedControl
            value={meal}
            onChange={setMeal}
            segments={MEAL_SEGMENTS}
            ariaLabel="Meal"
          />
        </View>
      </View>

      <Pressable
        onPress={() => setPickerOpen((o) => !o)}
        accessibilityRole="button"
        className="rounded-md border border-border bg-background px-3 py-2 active:opacity-80"
      >
        <Text className="text-sm text-foreground">
          {selection ? selection.label : "Pick item or recipe…"}
        </Text>
      </Pressable>

      {pickerOpen && (
        <Picker
          pantry={pantry}
          recipes={recipes}
          onPick={(s) => {
            setSelection(s);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <View className="flex-row items-center gap-2">
        <Text className="text-xs text-muted">Servings</Text>
        <TextInput
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="decimal-pad"
          editable={!busy}
          className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-sm tabular-nums text-foreground"
        />
        <View className="flex-1" />
        <Pressable
          onPress={() => {
            const q = Number(quantity);
            if (!selection || !Number.isFinite(q) || q <= 0) return;
            onLog({ kind: selection.kind, id: selection.id }, q, meal);
            setQuantity("1");
          }}
          disabled={busy || !selection}
          accessibilityRole="button"
          className="rounded-md bg-accent px-4 py-1.5 active:opacity-80 disabled:opacity-50"
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-xs font-medium text-accent-fg">Log</Text>
          )}
        </Pressable>
      </View>

      {error && <Text className="text-xs text-danger">{error}</Text>}
    </View>
  );
}

function Picker({
  pantry,
  recipes,
  onPick,
  onClose,
}: {
  pantry: PantryItem[];
  recipes: Recipe[];
  onPick: (s: {
    kind: "pantry" | "recipe";
    id: string;
    label: string;
  }) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const filteredRecipes = needle
    ? recipes.filter((r) => r.name.toLowerCase().includes(needle))
    : recipes;
  const filteredPantry = needle
    ? pantry.filter((p) => p.name.toLowerCase().includes(needle))
    : pantry;
  type Row =
    | { key: string; section: string; pick: () => void; label: string; sub: string }
    | { key: string; header: string };
  const rows: Row[] = [];
  if (filteredRecipes.length > 0) {
    rows.push({ key: "h-recipes", header: "Recipes" });
    for (const r of filteredRecipes) {
      rows.push({
        key: `recipe:${r.id}`,
        section: "Recipe",
        pick: () =>
          onPick({ kind: "recipe", id: r.id, label: `${r.name} (recipe)` }),
        label: r.name,
        sub: `${formatNumber(r.macros.calories)} cal / batch`,
      });
    }
  }
  if (filteredPantry.length > 0) {
    rows.push({ key: "h-pantry", header: "Pantry" });
    for (const p of filteredPantry) {
      rows.push({
        key: `pantry:${p.id}`,
        section: "Pantry",
        pick: () =>
          onPick({ kind: "pantry", id: p.id, label: p.name }),
        label: p.name,
        sub: `${formatNumber(p.calories)} cal / ${formatNumber(p.serving_size)} ${p.serving_unit}`,
      });
    }
  }
  return (
    <View className="max-h-64 rounded-md border border-border bg-background">
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search…"
        placeholderTextColor="#71717a"
        autoFocus
        className="border-b border-border px-3 py-2 text-sm text-foreground"
      />
      {/*
        ScrollView (not FlatList) on purpose: this picker sits inside
        the parent TodayView's vertical ScrollView, and a nested
        VirtualizedList in the same orientation triggers RN's
        windowing warning. Virtualization gives nothing useful here
        anyway — at most a few dozen rows, all inside a max-h-64 box.
      */}
      <ScrollView keyboardShouldPersistTaps="handled">
        {rows.length === 0 ? (
          <Text className="px-3 py-3 text-center text-xs text-muted">
            No matches.
          </Text>
        ) : (
          rows.map((item) => {
            if ("header" in item) {
              return (
                <Text
                  key={item.key}
                  className="bg-background px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted"
                >
                  {item.header}
                </Text>
              );
            }
            return (
              <Pressable
                key={item.key}
                onPress={item.pick}
                accessibilityRole="button"
                className="border-b border-border/60 px-3 py-2 active:opacity-80"
              >
                <Text className="text-sm text-foreground" numberOfLines={1}>
                  {item.label}
                </Text>
                <Text className="mt-0.5 text-xs text-muted" numberOfLines={1}>
                  {item.sub}
                </Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        className="border-t border-border bg-surface px-3 py-2 active:opacity-80"
      >
        <Text className="text-center text-xs text-muted">Close</Text>
      </Pressable>
    </View>
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
  onDelete: (id: string) => void;
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
  onDelete: (id: string) => void;
}) {
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
      {entries.map((e) => {
        const name = e.pantry_item_id
          ? (pantryByID.get(e.pantry_item_id)?.name ?? "Unknown item")
          : e.recipe_id
            ? (recipeByID.get(e.recipe_id)?.name ?? "Unknown recipe")
            : "Untitled entry";
        return (
          <EntryRow
            key={e.id}
            entry={e}
            name={name}
            isRecipe={!!e.recipe_id}
            busy={rowBusyID === e.id}
            onDelete={() => onDelete(e.id)}
          />
        );
      })}
    </View>
  );
}

function EntryRow({
  entry,
  name,
  isRecipe,
  busy,
  onDelete,
}: {
  entry: NutritionLogEntry;
  name: string;
  isRecipe: boolean;
  busy: boolean;
  onDelete: () => void;
}) {
  return (
    <View className="flex-row items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2">
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
          {name}{" "}
          <Text className="text-xs tabular-nums text-muted">
            × {formatNumber(entry.quantity)}
          </Text>
          {isRecipe && (
            <Text className="ml-1 text-[10px] uppercase tracking-wider text-muted">
              {" "}
              recipe
            </Text>
          )}
        </Text>
        <Text className="text-xs tabular-nums text-muted">
          {formatNumber(entry.calories)} cal · P {formatNumber(entry.protein_g)}g
          · F {formatNumber(entry.fat_g)}g · C {formatNumber(entry.carbs_g)}g
        </Text>
      </View>
      <Pressable
        onPress={onDelete}
        disabled={busy}
        accessibilityRole="button"
        className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 active:opacity-80 disabled:opacity-50"
      >
        <Text className="text-xs text-danger">Delete</Text>
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

function defaultMealForLocalHour(d: Date): MealType {
  const h = d.getHours();
  if (h >= 4 && h < 11) return "breakfast";
  if (h >= 11 && h < 15) return "lunch";
  if (h >= 17 && h < 22) return "dinner";
  return "snack";
}

function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
