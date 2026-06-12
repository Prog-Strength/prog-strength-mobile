// Pantry item form. Drives both new-item creation and inline edit.
// Validation is client-side first so the user gets a clean error
// before the API rejects with a 400. Server-side validation is the
// backstop.
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import type { PantryItemPayload } from "@/lib/api";

export function PantryItemForm({
  initial,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<PantryItemPayload>;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (payload: PantryItemPayload) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [calories, setCalories] = useState(initial?.calories?.toString() ?? "");
  const [proteinG, setProteinG] = useState(initial?.protein_g?.toString() ?? "");
  const [fatG, setFatG] = useState(initial?.fat_g?.toString() ?? "");
  const [carbsG, setCarbsG] = useState(initial?.carbs_g?.toString() ?? "");
  const [servingSize, setServingSize] = useState(initial?.serving_size?.toString() ?? "1");
  const [servingUnit, setServingUnit] = useState(initial?.serving_unit ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  function submit() {
    setLocalError(null);
    if (!name.trim()) {
      setLocalError("Name is required.");
      return;
    }
    if (!servingUnit.trim()) {
      setLocalError("Serving unit is required.");
      return;
    }
    const cal = Number(calories);
    const p = Number(proteinG);
    const f = Number(fatG);
    const c = Number(carbsG);
    const s = Number(servingSize);
    if (![cal, p, f, c, s].every(Number.isFinite)) {
      setLocalError("Macros and serving size must be numbers.");
      return;
    }
    if (cal < 0 || p < 0 || f < 0 || c < 0) {
      setLocalError("Macros must be non-negative.");
      return;
    }
    if (s <= 0) {
      setLocalError("Serving size must be greater than zero.");
      return;
    }
    onSubmit({
      name: name.trim(),
      calories: cal,
      protein_g: p,
      fat_g: f,
      carbs_g: c,
      serving_size: s,
      serving_unit: servingUnit.trim(),
    });
  }

  const shownError = error ?? localError;

  return (
    <View className="gap-2 rounded-lg border border-border bg-surface p-3">
      <LabeledInput
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="Eggland's Best Large Egg"
        disabled={busy}
      />
      <View className="flex-row gap-2">
        <LabeledInput
          label="Serving size"
          value={servingSize}
          onChangeText={setServingSize}
          keyboardType="decimal-pad"
          disabled={busy}
          flex
        />
        <LabeledInput
          label="Serving unit"
          value={servingUnit}
          onChangeText={setServingUnit}
          placeholder="egg, slice, g"
          disabled={busy}
          flex
        />
      </View>
      <View className="flex-row gap-2">
        <LabeledInput
          label="Calories"
          value={calories}
          onChangeText={setCalories}
          keyboardType="decimal-pad"
          disabled={busy}
          flex
        />
        <LabeledInput
          label="Protein (g)"
          value={proteinG}
          onChangeText={setProteinG}
          keyboardType="decimal-pad"
          disabled={busy}
          flex
        />
      </View>
      <View className="flex-row gap-2">
        <LabeledInput
          label="Fat (g)"
          value={fatG}
          onChangeText={setFatG}
          keyboardType="decimal-pad"
          disabled={busy}
          flex
        />
        <LabeledInput
          label="Carbs (g)"
          value={carbsG}
          onChangeText={setCarbsG}
          keyboardType="decimal-pad"
          disabled={busy}
          flex
        />
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
            <Text className="text-xs font-medium text-accent-fg">{submitLabel}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function LabeledInput({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  disabled,
  flex,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "decimal-pad";
  disabled?: boolean;
  flex?: boolean;
}) {
  return (
    <View className={`gap-1 ${flex ? "flex-1" : ""}`}>
      <Text className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#71717a"
        keyboardType={keyboardType ?? "default"}
        editable={!disabled}
        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
      />
    </View>
  );
}
