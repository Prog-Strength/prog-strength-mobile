/**
 * Render-time weight conversion. Sets and bodyweight entries carry the
 * unit they were logged in; the user's preferred unit (profile
 * weight_unit) converts at display only — stored data is never
 * reinterpreted. Mirrors the web app's conversion rule.
 */
export const KG_PER_LB = 0.45359237;

export function convertWeight(value: number, from: "lb" | "kg", to: "lb" | "kg"): number {
  if (from === to) return value;
  return from === "lb" ? value * KG_PER_LB : value / KG_PER_LB;
}

/** "225 lb" / "102.1 kg" in the preferred unit; ≤1 decimal, no trailing zero. */
export function formatWeight(value: number, unit: "lb" | "kg", preferred: "lb" | "kg"): string {
  if (!Number.isFinite(value)) return "—";
  const converted = convertWeight(value, unit, preferred);
  const rounded = Math.round(converted * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${preferred}`;
}

// --- Distance / pace / run duration (running features) ---------------

export const METERS_PER_MILE = 1609.344;
export const METERS_PER_KM = 1000;
export const KM_PER_MILE = 1.609344;

export type DistanceUnit = "mi" | "km";

/** Meters → "5.0" in the given unit (always 1 decimal, no unit suffix). */
export function formatDistance(meters: number, unit: DistanceUnit): string {
  if (!Number.isFinite(meters)) return "—";
  const divisor = unit === "mi" ? METERS_PER_MILE : METERS_PER_KM;
  return (meters / divisor).toFixed(1);
}

/** sec/km → "m:ss" pace per the given unit; "—" for null/invalid. */
export function formatPace(secPerKm: number | null, unit: DistanceUnit): string {
  if (secPerKm == null || !Number.isFinite(secPerKm) || secPerKm <= 0) return "—";
  const secPerUnit = unit === "mi" ? secPerKm * KM_PER_MILE : secPerKm;
  const totalSeconds = Math.round(secPerUnit);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Seconds → "m:ss" or "h:mm:ss" (zero-padded). Web lib/format.ts twin. */
export function formatRunDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Garmin-style time-of-day fallback name for an unnamed run.
 * Web source: app/(app)/running/_components/RunListRow.tsx
 */
export function runFallbackName(startTime: string): string {
  const hour = new Date(startTime).getHours();
  if (hour < 12) return "Morning Run";
  if (hour < 17) return "Afternoon Run";
  if (hour < 21) return "Evening Run";
  return "Night Run";
}
