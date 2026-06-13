// Quick-add sheet — the inline log form that used to live inside
// today-view.tsx is now opened via the "Quick add" button. Matches
// the macro-goals-sheet pattern: RN's built-in Modal with
// presentationStyle="pageSheet" so iOS gives us the standard
// slide-up card.
//
// The sheet has two tabs (SegmentedControl): "Saved" (existing
// pantry/recipe picker) and "Custom" (free-form name + macros).
// Web reference: components/quick-add-modal.tsx (3-tab: Pantry /
// Recipes / Custom). Mobile combines Pantry + Recipes into a single
// "Saved" picker so two tabs are the right mobile equivalent.
//
// onLog returns a Promise so the sheet can close itself on success
// (the new entry appears in the meal sections behind the now-
// dismissed sheet). On failure the sheet stays open and surfaces the
// error from the parent via the `error` prop.

import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import type { MealType, PantryItem, Recipe } from "@/lib/api";
import { SegmentedControl, type Segment } from "@/components/segmented-control";

const MEAL_SEGMENTS: readonly Segment<MealType>[] = [
  { value: "breakfast", label: "B" },
  { value: "lunch", label: "L" },
  { value: "dinner", label: "D" },
  { value: "snack", label: "S" },
];

type SourceTab = "saved" | "custom";
const SOURCE_SEGMENTS: readonly Segment<SourceTab>[] = [
  { value: "saved", label: "Saved" },
  { value: "custom", label: "Custom" },
];

export function QuickAddSheet({
  open,
  pantry,
  recipes,
  date,
  busy,
  error,
  onLog,
  onLogCustom,
  onClose,
}: {
  open: boolean;
  pantry: PantryItem[];
  recipes: Recipe[];
  /** Currently-selected calendar day. Drives consumed_at: now if today, else noon of that day. */
  date: Date;
  busy: boolean;
  error: string | null;
  onLog: (
    source: { kind: "pantry" | "recipe"; id: string },
    quantity: number,
    meal: MealType,
  ) => Promise<void>;
  onLogCustom: (
    payload: {
      name: string;
      calories: number;
      protein_g: number;
      fat_g: number;
      carbs_g: number;
    },
    meal: MealType,
    consumedAt: string,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [sourceTab, setSourceTab] = useState<SourceTab>("saved");
  const [meal, setMeal] = useState<MealType>(() => defaultMealForLocalHour(new Date()));
  const [selection, setSelection] = useState<{
    kind: "pantry" | "recipe";
    id: string;
    label: string;
  } | null>(null);
  const [quantity, setQuantity] = useState<string>("1");
  const [pickerOpen, setPickerOpen] = useState(false);

  // Custom-tab state — string-backed so the user can clear a field
  // without it snapping to 0 mid-edit (mirrors macro-goals-sheet).
  const [customName, setCustomName] = useState<string>("");
  const [customCalories, setCustomCalories] = useState<string>("");
  const [customProtein, setCustomProtein] = useState<string>("");
  const [customFat, setCustomFat] = useState<string>("");
  const [customCarbs, setCustomCarbs] = useState<string>("");
  const [localError, setLocalError] = useState<string | null>(null);

  // When the sheet opens fresh, reset the form to sensible defaults
  // so a stale prior selection doesn't carry over from a dismissed
  // session. The meal re-inferences on open since the user is
  // starting a new log action.
  useEffect(() => {
    if (!open) return;
    setSourceTab("saved");
    setSelection(null);
    setQuantity("1");
    setMeal(defaultMealForLocalHour(new Date()));
    setPickerOpen(false);
    setCustomName("");
    setCustomCalories("");
    setCustomProtein("");
    setCustomFat("");
    setCustomCarbs("");
    setLocalError(null);
  }, [open]);

  // Clear inline validation when the user switches tabs.
  function selectSourceTab(next: SourceTab) {
    setSourceTab(next);
    setLocalError(null);
  }

  // consumed_at: now if logging to today, else noon of the selected
  // day — same derivation the web QuickAddModal uses.
  function computeConsumedAt(): string {
    const isToday = sameLocalDay(date, new Date());
    return (isToday ? new Date() : new Date(date.getTime() + 12 * 60 * 60 * 1000)).toISOString();
  }

  async function submitSaved() {
    const q = Number(quantity);
    if (!selection || !Number.isFinite(q) || q <= 0) return;
    try {
      await onLog({ kind: selection.kind, id: selection.id }, q, meal);
      onClose();
    } catch {
      // Error surfaces via the `error` prop; sheet stays open so
      // the user can adjust + retry.
    }
  }

  async function submitCustom() {
    setLocalError(null);
    const name = customName.trim();
    if (!name) {
      setLocalError("Name is required.");
      return;
    }
    const cal = Number(customCalories || "0");
    const p = Number(customProtein || "0");
    const f = Number(customFat || "0");
    const c = Number(customCarbs || "0");
    if (![cal, p, f, c].every(Number.isFinite)) {
      setLocalError("Macros must be numbers.");
      return;
    }
    if (cal < 0 || p < 0 || f < 0 || c < 0) {
      setLocalError("Macros must be non-negative.");
      return;
    }
    try {
      await onLogCustom(
        { name, calories: cal, protein_g: p, fat_g: f, carbs_g: c },
        meal,
        computeConsumedAt(),
      );
      onClose();
    } catch {
      // Error surfaces via the `error` prop.
    }
  }

  const emptyState = pantry.length === 0 && recipes.length === 0;
  const displayedError = error ?? localError;

  // Submit-button disabled state depends on the active tab.
  const submitDisabled =
    busy ||
    (sourceTab === "saved" && (!selection || Number(quantity) <= 0)) ||
    (sourceTab === "custom" && !customName.trim());

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
            <Text className="text-base font-semibold text-foreground">Quick add</Text>
            <Text className="text-xs text-muted">
              Log a pantry item, recipe, or a one-off meal.
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={8}
            className="rounded p-1 active:opacity-80 disabled:opacity-50"
          >
            <Text className="text-base text-muted">✕</Text>
          </Pressable>
        </View>

        {emptyState && sourceTab === "saved" ? (
          <View className="items-center px-4 py-8">
            <Text className="text-center text-sm font-medium text-foreground">
              Add a pantry item first
            </Text>
            <Text className="mt-1 text-center text-xs text-muted">
              The Pantry tab lets you save foods you eat often, or use the{" "}
              <Text
                className="text-accent"
                onPress={() => selectSourceTab("custom")}
                accessibilityRole="button"
              >
                Custom tab
              </Text>{" "}
              to log a one-off meal.
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerClassName="gap-4 px-4 py-4"
            keyboardShouldPersistTaps="handled"
          >
            {/* Source tab: Saved | Custom */}
            <SegmentedControl
              value={sourceTab}
              onChange={selectSourceTab}
              segments={SOURCE_SEGMENTS}
              ariaLabel="Source"
            />

            {sourceTab === "saved" && !emptyState && (
              <>
                <Pressable
                  onPress={() => setPickerOpen((o) => !o)}
                  accessibilityRole="button"
                  className="rounded-md border border-border bg-surface px-3 py-3 active:opacity-80"
                >
                  <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                    Item or recipe
                  </Text>
                  <Text className="mt-1 text-sm text-foreground">
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

                <View className="flex-row items-center gap-3">
                  <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                    Servings
                  </Text>
                  <TextInput
                    value={quantity}
                    onChangeText={setQuantity}
                    keyboardType="decimal-pad"
                    editable={!busy}
                    className="w-24 rounded-md border border-border bg-surface px-3 py-2 text-sm tabular-nums text-foreground"
                  />
                </View>
              </>
            )}

            {sourceTab === "custom" && (
              <>
                <View className="gap-1">
                  <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                    Name
                  </Text>
                  <TextInput
                    value={customName}
                    onChangeText={setCustomName}
                    placeholder="Chipotle chicken bowl"
                    placeholderTextColor="#71717a"
                    editable={!busy}
                    className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
                  />
                </View>
                <MacroField
                  label="Calories"
                  value={customCalories}
                  onChange={setCustomCalories}
                  disabled={busy}
                />
                <MacroField
                  label="Protein (g)"
                  value={customProtein}
                  onChange={setCustomProtein}
                  disabled={busy}
                />
                <MacroField
                  label="Fat (g)"
                  value={customFat}
                  onChange={setCustomFat}
                  disabled={busy}
                />
                <MacroField
                  label="Carbs (g)"
                  value={customCarbs}
                  onChange={setCustomCarbs}
                  disabled={busy}
                />
              </>
            )}

            {/* Shared: meal-type picker */}
            <View className="flex-row items-center gap-2">
              <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                Meal
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

            {displayedError && (
              <View className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
                <Text className="text-xs text-danger">{displayedError}</Text>
              </View>
            )}
          </ScrollView>
        )}

        {(sourceTab === "custom" || !emptyState) && (
          <View className="flex-row items-center justify-end gap-2 border-t border-border px-4 py-3">
            <Pressable
              onPress={onClose}
              disabled={busy}
              accessibilityRole="button"
              className="rounded-md border border-border bg-surface px-3 py-2 active:opacity-80 disabled:opacity-50"
            >
              <Text className="text-sm text-foreground">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={sourceTab === "saved" ? submitSaved : submitCustom}
              disabled={submitDisabled}
              accessibilityRole="button"
              className="rounded-md bg-accent px-4 py-2 active:opacity-80 disabled:opacity-50"
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-sm font-medium text-accent-fg">Log</Text>
              )}
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

// --- Picker -------------------------------------------------------

function Picker({
  pantry,
  recipes,
  onPick,
  onClose,
}: {
  pantry: PantryItem[];
  recipes: Recipe[];
  onPick: (s: { kind: "pantry" | "recipe"; id: string; label: string }) => void;
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
    | { key: string; pick: () => void; label: string; sub: string }
    | { key: string; header: string };
  const rows: Row[] = [];
  if (filteredRecipes.length > 0) {
    rows.push({ key: "h-recipes", header: "Recipes" });
    for (const r of filteredRecipes) {
      rows.push({
        key: `recipe:${r.id}`,
        pick: () => onPick({ kind: "recipe", id: r.id, label: `${r.name} (recipe)` }),
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
        pick: () => onPick({ kind: "pantry", id: p.id, label: p.name }),
        label: p.name,
        sub: `${formatNumber(p.calories)} cal / ${formatNumber(p.serving_size)} ${p.serving_unit}`,
      });
    }
  }
  return (
    <View className="max-h-64 rounded-md border border-border bg-surface">
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search…"
        placeholderTextColor="#71717a"
        autoFocus
        className="border-b border-border px-3 py-2 text-sm text-foreground"
      />
      {/*
        ScrollView (not FlatList) on purpose: nesting a virtualized
        list inside a parent ScrollView triggers RN's windowing
        warning, and the row counts here are at most a few dozen.
      */}
      <ScrollView keyboardShouldPersistTaps="handled">
        {rows.length === 0 ? (
          <Text className="px-3 py-3 text-center text-xs text-muted">No matches.</Text>
        ) : (
          rows.map((item) => {
            if ("header" in item) {
              return (
                <Text
                  key={item.key}
                  className="bg-surface px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted"
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
        className="border-t border-border bg-background px-3 py-2 active:opacity-80"
      >
        <Text className="text-center text-xs text-muted">Close</Text>
      </Pressable>
    </View>
  );
}

// --- MacroField ---------------------------------------------------

function MacroField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <View className="gap-1">
      <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="number-pad"
        editable={!disabled}
        placeholder="0"
        placeholderTextColor="#71717a"
        className="rounded-md border border-border bg-surface px-3 py-2 text-sm tabular-nums text-foreground"
      />
    </View>
  );
}

// --- helpers ------------------------------------------------------

function defaultMealForLocalHour(d: Date): MealType {
  const h = d.getHours();
  if (h >= 4 && h < 11) return "breakfast";
  if (h >= 11 && h < 15) return "lunch";
  if (h >= 17 && h < 22) return "dinner";
  return "snack";
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
