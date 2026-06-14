// Edit-log-entry sheet. Mirrors the web log-entry-edit-modal.tsx on
// the mobile Modal shell pattern from macro-goals-sheet.tsx.
//
// Two shapes branched on entry kind:
//   - Custom entry (custom_meal_name present, no pantry_item_id /
//     recipe_id): edits name + four macros + meal.
//   - Pantry / recipe entry: edits quantity (servings, > 0) + meal.
//
// consumed_at time-of-day editing is DEFERRED — a native date/time
// picker would be required to match web's time input, and this phase
// must stay pure-JS for OTA compatibility. The entry's consumed_at is
// left unchanged; only quantity/meal (or name/macros/meal) are written.
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
import { getToken } from "@/lib/auth";
import { updateNutritionLogEntry, type MealType, type NutritionLogEntry } from "@/lib/api";

const MEAL_ORDER: MealType[] = ["breakfast", "lunch", "dinner", "snack"];
const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snacks",
};

export function LogEntryEditSheet({
  open,
  entry,
  itemName,
  onSaved,
  onClose,
}: {
  open: boolean;
  entry: NutritionLogEntry;
  itemName: string;
  onSaved: (updated: NutritionLogEntry) => void;
  onClose: () => void;
}) {
  const isCustom = entry.custom_meal_name != null;

  // String-backed inputs — same pattern as macro-goals-sheet so the
  // user can clear a field mid-edit without it snapping to 0.
  const [meal, setMeal] = useState<MealType>(entry.meal);
  const [quantity, setQuantity] = useState<string>(String(entry.quantity));

  // Custom-entry state, seeded from the stored name + macros.
  const [customName, setCustomName] = useState<string>(entry.custom_meal_name ?? "");
  const [calories, setCalories] = useState<string>(String(entry.calories));
  const [proteinG, setProteinG] = useState<string>(String(entry.protein_g));
  const [fatG, setFatG] = useState<string>(String(entry.fat_g));
  const [carbsG, setCarbsG] = useState<string>(String(entry.carbs_g));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form whenever the sheet reopens for a (potentially different)
  // entry, matching macro-goals-sheet's open-guard useEffect.
  useEffect(() => {
    if (!open) return;
    setMeal(entry.meal);
    setQuantity(String(entry.quantity));
    setCustomName(entry.custom_meal_name ?? "");
    setCalories(String(entry.calories));
    setProteinG(String(entry.protein_g));
    setFatG(String(entry.fat_g));
    setCarbsG(String(entry.carbs_g));
    setError(null);
  }, [open, entry]);

  async function save() {
    setError(null);

    if (isCustom) {
      const name = customName.trim();
      if (!name) {
        setError("Name is required.");
        return;
      }
      const cal = Number(calories || "0");
      const p = Number(proteinG || "0");
      const f = Number(fatG || "0");
      const c = Number(carbsG || "0");
      if (![cal, p, f, c].every(Number.isFinite)) {
        setError("Macros must be numbers.");
        return;
      }
      if (cal < 0 || p < 0 || f < 0 || c < 0) {
        setError("Macros must be non-negative.");
        return;
      }

      setSaving(true);
      try {
        const token = await getToken();
        if (!token) throw new Error("not signed in");
        const updated = await updateNutritionLogEntry(token, entry.id, {
          meal,
          name,
          calories: cal,
          protein_g: p,
          fat_g: f,
          carbs_g: c,
        });
        onSaved(updated);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    } else {
      const q = Number(quantity);
      if (!Number.isFinite(q) || q <= 0) {
        setError("Servings must be greater than zero.");
        return;
      }

      setSaving(true);
      try {
        const token = await getToken();
        if (!token) throw new Error("not signed in");
        const updated = await updateNutritionLogEntry(token, entry.id, {
          quantity: q,
          meal,
        });
        onSaved(updated);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    }
  }

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
        {/* Header */}
        <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
          <View className="flex-1 pr-3">
            <Text className="text-base font-semibold text-foreground">Edit log entry</Text>
            <Text className="text-xs text-muted" numberOfLines={1}>
              {itemName}
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

        {/* Form body */}
        <ScrollView contentContainerClassName="gap-4 px-4 py-4">
          {isCustom && (
            <EditField label="Name">
              <TextInput
                value={customName}
                onChangeText={setCustomName}
                placeholder="Chipotle chicken bowl"
                placeholderTextColor="#71717a"
                editable={!saving}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
              />
            </EditField>
          )}

          {isCustom && (
            <View className="flex-row flex-wrap gap-3">
              <View className="min-w-[45%] flex-1">
                <MacroField
                  label="Calories"
                  value={calories}
                  onChange={setCalories}
                  disabled={saving}
                />
              </View>
              <View className="min-w-[45%] flex-1">
                <MacroField
                  label="Protein (g)"
                  value={proteinG}
                  onChange={setProteinG}
                  disabled={saving}
                />
              </View>
              <View className="min-w-[45%] flex-1">
                <MacroField label="Fat (g)" value={fatG} onChange={setFatG} disabled={saving} />
              </View>
              <View className="min-w-[45%] flex-1">
                <MacroField
                  label="Carbs (g)"
                  value={carbsG}
                  onChange={setCarbsG}
                  disabled={saving}
                />
              </View>
            </View>
          )}

          {!isCustom && (
            <EditField label="Servings">
              <TextInput
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="decimal-pad"
                placeholder="1"
                placeholderTextColor="#71717a"
                editable={!saving}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm tabular-nums text-foreground"
              />
            </EditField>
          )}

          <EditField label="Meal">
            <View className="flex-row flex-wrap gap-2">
              {MEAL_ORDER.map((m) => {
                const active = m === meal;
                return (
                  <Pressable
                    key={m}
                    onPress={() => setMeal(m)}
                    disabled={saving}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    className={`rounded-full border px-4 py-2 active:opacity-80 disabled:opacity-50 ${
                      active ? "border-accent bg-accent" : "border-border bg-surface"
                    }`}
                  >
                    <Text
                      className={`text-sm font-medium ${
                        active ? "text-accent-fg" : "text-foreground"
                      }`}
                    >
                      {MEAL_LABELS[m]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </EditField>

          {/* consumed_at editing deferred — a native date/time picker
              would be needed to match web; deferred to keep OTA compat. */}

          {error && (
            <View className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
              <Text className="text-xs text-danger">{error}</Text>
            </View>
          )}
        </ScrollView>

        {/* Footer actions */}
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
              <Text className="text-sm font-medium text-accent-fg">Save changes</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// --- Sub-components ------------------------------------------------

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="gap-1">
      <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</Text>
      {children}
    </View>
  );
}

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
        keyboardType="decimal-pad"
        editable={!disabled}
        className="rounded-md border border-border bg-surface px-3 py-2 text-sm tabular-nums text-foreground"
      />
    </View>
  );
}
