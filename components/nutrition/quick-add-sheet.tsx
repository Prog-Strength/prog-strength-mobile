// Quick-add sheet — the inline log form that used to live inside
// today-view.tsx is now opened via the "Quick add" button. Matches
// the macro-goals-sheet pattern: RN's built-in Modal with
// presentationStyle="pageSheet" so iOS gives us the standard
// slide-up card.
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

export function QuickAddSheet({
  open,
  pantry,
  recipes,
  busy,
  error,
  onLog,
  onClose,
}: {
  open: boolean;
  pantry: PantryItem[];
  recipes: Recipe[];
  busy: boolean;
  error: string | null;
  onLog: (
    source: { kind: "pantry" | "recipe"; id: string },
    quantity: number,
    meal: MealType,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [meal, setMeal] = useState<MealType>(() => defaultMealForLocalHour(new Date()));
  const [selection, setSelection] = useState<{
    kind: "pantry" | "recipe";
    id: string;
    label: string;
  } | null>(null);
  const [quantity, setQuantity] = useState<string>("1");
  const [pickerOpen, setPickerOpen] = useState(false);

  // When the sheet opens fresh, reset the form to sensible defaults
  // so a stale prior selection doesn't carry over from a dismissed
  // session. The meal re-inferences on open since the user is
  // starting a new log action.
  useEffect(() => {
    if (!open) return;
    setSelection(null);
    setQuantity("1");
    setMeal(defaultMealForLocalHour(new Date()));
    setPickerOpen(false);
  }, [open]);

  async function submit() {
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

  const emptyState = pantry.length === 0 && recipes.length === 0;

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
            <Text className="text-xs text-muted">Log a pantry item or recipe to today.</Text>
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

        {emptyState ? (
          <View className="items-center px-4 py-8">
            <Text className="text-center text-sm font-medium text-foreground">
              Add a pantry item first
            </Text>
            <Text className="mt-1 text-center text-xs text-muted">
              The Pantry tab lets you save foods you eat often.
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerClassName="gap-4 px-4 py-4">
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

            {error && (
              <View className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
                <Text className="text-xs text-danger">{error}</Text>
              </View>
            )}
          </ScrollView>
        )}

        {!emptyState && (
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
              onPress={submit}
              disabled={busy || !selection}
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

// --- helpers ------------------------------------------------------

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
