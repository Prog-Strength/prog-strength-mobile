/**
 * Single source of truth for the equipment pill — the gear/setup a
 * given exercise requires. Mirrors the web twin at
 * components/equipment-pill.tsx: same color map, same humanize logic,
 * same /15 bg + 300 text + /30 border design-token pattern.
 *
 * Mobile version uses inline NativeWind className strings instead of
 * Tailwind CSS — the class names are identical so the two files stay
 * visually in sync. Unknown values fall back to stone (neutral).
 */
import { Text } from "react-native";

const EQUIPMENT_CLASSES: Record<string, string> = {
  none: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  barbell: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  ez_bar: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  dumbbell: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  kettlebell: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  cable: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  machine: "bg-pink-500/15 text-pink-300 border-pink-500/30",
  resistance_band: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  pullup_bar: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  flat_bench: "bg-stone-500/15 text-stone-300 border-stone-500/30",
  incline_bench: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  upright_bench: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  decline_bench: "bg-red-500/15 text-red-300 border-red-500/30",
  rack: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

export function EquipmentPill({ label }: { label: string }) {
  const classes = EQUIPMENT_CLASSES[label] ?? "bg-stone-500/15 text-stone-300 border-stone-500/30";
  return (
    <Text
      className={`overflow-hidden rounded-full border px-2 py-0.5 text-[10px] font-medium ${classes}`}
    >
      {humanizeEquipment(label)}
    </Text>
  );
}

/**
 * Display form for an equipment slug. Most values transform cleanly
 * with a Title Case rule ("flat_bench" → "Flat Bench"), but a few
 * acronym-bearing slugs need a manual override ("ez_bar" → "EZ Bar").
 * Add new entries to EQUIPMENT_LABELS as needed rather than
 * complicating the generic transform.
 */
const EQUIPMENT_LABELS: Record<string, string> = {
  ez_bar: "EZ Bar",
};

function humanizeEquipment(eq: string): string {
  if (EQUIPMENT_LABELS[eq]) return EQUIPMENT_LABELS[eq]!;
  return eq
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}
