// Shared tick-generation helpers for SVG charts. Extracted verbatim
// from components/nutrition/bodyweight-chart.tsx (Part 1, Task 6).
// Re-exported here so RunMetricChart and any future chart can share
// the same axis math without duplicating it.

/**
 * Generate up to `count` "nice" evenly-spaced Y tick values within
 * [min, max], snapped to a human-friendly step (1/2/5 × power-of-10).
 * Returns [min] as a safe fallback when max ≤ min.
 */
export function niceYTicks(min: number, max: number, count: number): number[] {
  if (max <= min) return [min];
  const rawStep = (max - min) / (count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const snap = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  const step = snap * mag;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + 1e-9; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return ticks;
}

/**
 * Generate exactly `count` evenly-spaced X tick values within
 * [min, max]. Returns [min] when max ≤ min or count ≤ 1.
 */
export function niceXTicks(min: number, max: number, count: number): number[] {
  if (max <= min || count <= 1) return [min];
  const step = (max - min) / (count - 1);
  const ticks: number[] = [];
  for (let i = 0; i < count; i++) ticks.push(min + step * i);
  return ticks;
}
