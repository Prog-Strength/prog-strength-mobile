/**
 * Single source of truth for the muscle-group pill — used wherever the
 * UI shows which muscles an exercise targets. Mirrors the web twin at
 * components/muscle-group-pill.tsx: same color map, same humanize
 * logic, same /15 bg + 300 text + /30 border design-token pattern.
 *
 * Mobile version uses inline NativeWind className strings instead of
 * Tailwind CSS — the class names are identical so the two files stay
 * visually in sync.
 */
import { Text } from "react-native";

const MUSCLE_GROUP_CLASSES: Record<string, string> = {
  chest: "bg-red-500/15 text-red-300 border-red-500/30",
  back: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  shoulders: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  biceps: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  triceps: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  forearms: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  core: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  quads: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  hamstrings: "bg-lime-500/15 text-lime-300 border-lime-500/30",
  glutes: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  calves: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
};

export function MuscleGroupPill({ label }: { label: string }) {
  const classes = MUSCLE_GROUP_CLASSES[label] ?? "bg-zinc-500/15 text-zinc-300 border-zinc-500/30";
  return (
    <Text
      className={`overflow-hidden rounded-full border px-2 py-0.5 text-[10px] font-medium ${classes}`}
    >
      {humanizeMuscleGroup(label)}
    </Text>
  );
}

/**
 * Display form for a muscle group slug. The API only emits simple
 * single-word values today ("chest", "hamstrings") so this is just
 * a capitalize. Kept as a function so a future slug with underscores
 * (e.g. "lower_back") would format correctly without a code change
 * at the call site.
 */
function humanizeMuscleGroup(mg: string): string {
  return mg
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}
