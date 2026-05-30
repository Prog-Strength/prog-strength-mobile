// Recipe form. Mirrors web's recipe builder but trimmed for phone:
// no drag-and-drop reorder (rare action, finicky on mobile); use the
// remove button + re-add if the user really needs to move a row.
//
// Driven by the parent (PantryView) — `pantry` is the catalog the
// component picker draws from. The form shows a live macro preview
// computed client-side from the components × pantry-item macros so
// the user sees what they're saving before save.
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import type { PantryItem, Recipe, RecipePayload } from "@/lib/api";

const MAX_COMPONENTS = 20;

type Draft = {
  // Stable client-side row key for React's reconciliation; the saved
  // server ID is irrelevant since the SOW's set-replacement pattern
  // writes brand-new component rows on every update.
  key: string;
  pantry_item_id: string;
  quantity: number;
};

export function RecipeForm({
  initial,
  pantry,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: Recipe;
  pantry: PantryItem[];
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (payload: RecipePayload) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [components, setComponents] = useState<Draft[]>(
    initial?.components.map((c, i) => ({
      key: `c-${i}-${c.pantry_item_id}`,
      pantry_item_id: c.pantry_item_id,
      quantity: c.quantity,
    })) ?? [],
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const pantryByID = useMemo(() => {
    const m = new Map<string, PantryItem>();
    for (const p of pantry) m.set(p.id, p);
    return m;
  }, [pantry]);

  const macros = useMemo(() => {
    let calories = 0;
    let protein = 0;
    let fat = 0;
    let carbs = 0;
    for (const c of components) {
      const p = pantryByID.get(c.pantry_item_id);
      if (!p || !Number.isFinite(c.quantity)) continue;
      calories += c.quantity * p.calories;
      protein += c.quantity * p.protein_g;
      fat += c.quantity * p.fat_g;
      carbs += c.quantity * p.carbs_g;
    }
    return { calories, protein, fat, carbs };
  }, [components, pantryByID]);

  const atCap = components.length >= MAX_COMPONENTS;
  const takenIds = useMemo(
    () => new Set(components.map((c) => c.pantry_item_id)),
    [components],
  );

  function addComponent(pantry_item_id: string) {
    if (atCap) return;
    setComponents((prev) => [
      ...prev,
      {
        key: `c-${Date.now()}-${pantry_item_id}`,
        pantry_item_id,
        quantity: 1,
      },
    ]);
  }
  function updateQty(key: string, q: number) {
    setComponents((prev) =>
      prev.map((c) => (c.key === key ? { ...c, quantity: q } : c)),
    );
  }
  function removeComponent(key: string) {
    setComponents((prev) => prev.filter((c) => c.key !== key));
  }

  function submit() {
    setLocalError(null);
    if (!name.trim()) {
      setLocalError("Recipe name is required.");
      return;
    }
    if (components.length === 0) {
      setLocalError("At least one component is required.");
      return;
    }
    for (const c of components) {
      if (!Number.isFinite(c.quantity) || c.quantity <= 0) {
        setLocalError("Component quantity must be greater than zero.");
        return;
      }
    }
    onSubmit({
      name: name.trim(),
      components: components.map((c) => ({
        pantry_item_id: c.pantry_item_id,
        quantity: c.quantity,
      })),
    });
  }

  const shownError = error ?? localError;

  if (pantry.length === 0) {
    return (
      <View className="rounded-lg border border-border bg-surface px-4 py-6">
        <Text className="text-center text-sm font-medium text-foreground">
          Add a pantry item first
        </Text>
        <Text className="mt-1 text-center text-xs text-muted">
          Recipes are built from items you&apos;ve already saved.
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-2 rounded-lg border border-border bg-surface p-3">
      <View className="gap-1">
        <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Name
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Standard Breakfast"
          placeholderTextColor="#71717a"
          editable={!busy}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
        />
      </View>

      <MacroPreview macros={macros} />

      <View className="gap-2">
        <View className="flex-row items-center justify-between">
          <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Components ({components.length}/{MAX_COMPONENTS})
          </Text>
          <Pressable
            onPress={() => setPickerOpen((o) => !o)}
            disabled={busy || atCap}
            accessibilityRole="button"
            className="rounded-md border border-border bg-background px-2 py-1 active:opacity-80 disabled:opacity-50"
          >
            <Text className="text-xs font-medium text-foreground">
              {pickerOpen ? "Close" : "+ Add"}
            </Text>
          </Pressable>
        </View>

        {pickerOpen && (
          <ComponentPicker
            pantry={pantry}
            takenIds={takenIds}
            onPick={(id) => {
              addComponent(id);
              setPickerOpen(false);
            }}
          />
        )}

        {components.length === 0 ? (
          <Text className="text-center text-xs text-muted">
            No components yet — add one to start.
          </Text>
        ) : (
          <View className="gap-2">
            {components.map((c) => {
              const item = pantryByID.get(c.pantry_item_id);
              return (
                <View
                  key={c.key}
                  className="flex-row items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5"
                >
                  <Text
                    className="flex-1 text-sm text-foreground"
                    numberOfLines={1}
                  >
                    {item?.name ?? "Unknown item"}
                  </Text>
                  <TextInput
                    value={String(c.quantity)}
                    onChangeText={(v) => updateQty(c.key, Number(v))}
                    keyboardType="decimal-pad"
                    editable={!busy}
                    className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-sm tabular-nums text-foreground"
                  />
                  <Pressable
                    onPress={() => removeComponent(c.key)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel="Remove component"
                    className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 active:opacity-80 disabled:opacity-50"
                  >
                    <Text className="text-xs text-danger">✕</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {shownError && <Text className="text-xs text-danger">{shownError}</Text>}

      <View className="flex-row items-center justify-end gap-2">
        {onCancel && (
          <Pressable
            onPress={onCancel}
            disabled={busy}
            accessibilityRole="button"
            className="rounded-md border border-border bg-surface px-3 py-1.5 active:opacity-80 disabled:opacity-50"
          >
            <Text className="text-xs font-medium text-foreground">Cancel</Text>
          </Pressable>
        )}
        <Pressable
          onPress={submit}
          disabled={busy}
          accessibilityRole="button"
          className="rounded-md bg-accent px-3 py-1.5 active:opacity-80 disabled:opacity-50"
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-xs font-medium text-accent-fg">
              {submitLabel}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function ComponentPicker({
  pantry,
  takenIds,
  onPick,
}: {
  pantry: PantryItem[];
  takenIds: Set<string>;
  onPick: (pantry_item_id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const filtered = pantry.filter(
    (p) =>
      !takenIds.has(p.id) &&
      (!needle || p.name.toLowerCase().includes(needle)),
  );
  return (
    <View className="max-h-56 rounded-md border border-border bg-background">
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search pantry…"
        placeholderTextColor="#71717a"
        autoFocus
        className="border-b border-border px-3 py-2 text-sm text-foreground"
      />
      <FlatList
        data={filtered}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onPick(item.id)}
            accessibilityRole="button"
            className="border-b border-border/60 px-3 py-2 active:opacity-80"
          >
            <Text className="text-sm text-foreground" numberOfLines={1}>
              {item.name}
            </Text>
            <Text className="mt-0.5 text-xs text-muted" numberOfLines={1}>
              {formatNumber(item.calories)} cal / {formatNumber(item.serving_size)} {item.serving_unit}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <Text className="px-3 py-3 text-center text-xs text-muted">
            {takenIds.size === pantry.length
              ? "Every pantry item is already in this recipe."
              : "No matches."}
          </Text>
        }
      />
    </View>
  );
}

function MacroPreview({
  macros,
}: {
  macros: { calories: number; protein: number; fat: number; carbs: number };
}) {
  return (
    <View className="flex-row gap-2 rounded-md border border-border bg-background p-2">
      <Tile label="Cal" value={formatNumber(macros.calories)} />
      <Tile label="P" value={`${formatNumber(macros.protein)}g`} />
      <Tile label="F" value={`${formatNumber(macros.fat)}g`} />
      <Tile label="C" value={`${formatNumber(macros.carbs)}g`} />
    </View>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 items-center">
      <Text className="text-sm font-semibold tabular-nums text-foreground">
        {value}
      </Text>
      <Text className="text-[10px] uppercase tracking-wider text-muted">
        {label}
      </Text>
    </View>
  );
}

function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
