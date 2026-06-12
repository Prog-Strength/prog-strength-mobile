// Mobile Set Goals sheet. Mirrors the web macro-goals modal: one
// form for the four macro targets (protein, carbs, fat, calories)
// plus a live calories-from-macros hint computed off the 4/4/9 math.
// The hint is informational only — the SOW deliberately doesn't
// enforce calorie/macro consistency at save time.

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
import { putMacroGoals, type MacroGoals } from "@/lib/api";

// Mirrors the API's MaxMacroGrams / MaxCalories. Duplicated so the
// sheet can surface an inline error without a roundtrip; the API
// re-enforces these caps as the source of truth.
const MAX_MACRO_GRAMS = 10_000;
const MAX_CALORIES = 100_000;

export function MacroGoalsSheet({
  open,
  initial,
  onSaved,
  onClose,
}: {
  open: boolean;
  initial: MacroGoals;
  onSaved: (saved: MacroGoals) => void;
  onClose: () => void;
}) {
  // String-backed inputs so the user can clear a field without it
  // snapping to 0 mid-edit. The save handler parses on submit.
  const [protein, setProtein] = useState(() => String(initial.protein_g));
  const [carbs, setCarbs] = useState(() => String(initial.carbs_g));
  const [fat, setFat] = useState(() => String(initial.fat_g));
  const [calories, setCalories] = useState(() => String(initial.calories));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when the sheet reopens with a different snapshot —
  // otherwise edits made and then dismissed leak into the next open.
  useEffect(() => {
    if (!open) return;
    setProtein(String(initial.protein_g));
    setCarbs(String(initial.carbs_g));
    setFat(String(initial.fat_g));
    setCalories(String(initial.calories));
    setError(null);
  }, [open, initial]);

  const parseIntOrNull = (s: string): number | null => {
    if (s.trim() === "") return null;
    const n = Number(s);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };
  const p = parseIntOrNull(protein);
  const c = parseIntOrNull(carbs);
  const f = parseIntOrNull(fat);
  const k = parseIntOrNull(calories);

  const computedCalories = p !== null && c !== null && f !== null ? p * 4 + c * 4 + f * 9 : null;
  const delta = computedCalories !== null && k !== null ? k - computedCalories : null;

  async function save() {
    if (p === null || c === null || f === null || k === null) {
      setError("Enter a non-negative integer for each field.");
      return;
    }
    if (p > MAX_MACRO_GRAMS || c > MAX_MACRO_GRAMS || f > MAX_MACRO_GRAMS) {
      setError(`Each macro must be ≤ ${MAX_MACRO_GRAMS} g.`);
      return;
    }
    if (k > MAX_CALORIES) {
      setError(`Calories must be ≤ ${MAX_CALORIES}.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("not signed in");
      const saved = await putMacroGoals(token, {
        protein_g: p,
        carbs_g: c,
        fat_g: f,
        calories: k,
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
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
        <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
          <View className="flex-1">
            <Text className="text-base font-semibold text-foreground">Set daily goals</Text>
            <Text className="text-xs text-muted">
              Targets drive the rings on the Nutrition tab.
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
          <GoalField
            label="Protein"
            unit="g"
            value={protein}
            onChange={setProtein}
            disabled={saving}
          />
          <GoalField label="Carbs" unit="g" value={carbs} onChange={setCarbs} disabled={saving} />
          <GoalField label="Fat" unit="g" value={fat} onChange={setFat} disabled={saving} />
          <GoalField
            label="Calories"
            unit="kcal"
            value={calories}
            onChange={setCalories}
            disabled={saving}
            hint={
              computedCalories !== null && delta !== null
                ? delta === 0
                  ? `Macros total ${computedCalories} kcal (matches your target)`
                  : `Macros total ${computedCalories} kcal (${Math.abs(delta)} kcal ${
                      delta > 0 ? "under" : "over"
                    } your target)`
                : null
            }
          />

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

function GoalField({
  label,
  unit,
  value,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string | null;
  disabled?: boolean;
}) {
  return (
    <View className="gap-1">
      <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</Text>
      <View className="flex-row items-center gap-2">
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType="number-pad"
          editable={!disabled}
          className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm tabular-nums text-foreground"
        />
        <Text className="text-xs text-muted">{unit}</Text>
      </View>
      {hint && <Text className="text-[10px] text-muted">{hint}</Text>}
    </View>
  );
}
