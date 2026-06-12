/**
 * Render-time weight conversion. Sets and bodyweight entries carry the
 * unit they were logged in; the user's preferred unit (profile
 * weight_unit) converts at display only — stored data is never
 * reinterpreted. Mirrors the web app's conversion rule.
 */
export const KG_PER_LB = 0.45359237;

export function convertWeight(
  value: number,
  from: "lb" | "kg",
  to: "lb" | "kg",
): number {
  if (from === to) return value;
  return from === "lb" ? value * KG_PER_LB : value / KG_PER_LB;
}

/** "225 lb" / "102.1 kg" in the preferred unit; ≤1 decimal, no trailing zero. */
export function formatWeight(
  value: number,
  unit: "lb" | "kg",
  preferred: "lb" | "kg",
): string {
  if (!Number.isFinite(value)) return "—";
  const converted = convertWeight(value, unit, preferred);
  const rounded = Math.round(converted * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${preferred}`;
}
