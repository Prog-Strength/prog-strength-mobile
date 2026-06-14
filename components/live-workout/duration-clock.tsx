// Elapsed-time clock for the live session. Ticks once a second and
// formats the gap between `now` and the session's `performed_at` as
// "M:SS" under an hour, "H:MM:SS" once it crosses one — matching the
// in-progress pill's formatting.
import { Text } from "react-native";
import { useNow } from "@/components/live-workout/use-now";

export function DurationClock({ performedAt }: { performedAt: string }) {
  const now = useNow(1000);
  const elapsed = formatDuration(now - new Date(performedAt).getTime());
  return (
    <Text className="text-sm tabular-nums text-muted" accessibilityLabel={`Elapsed ${elapsed}`}>
      {elapsed}
    </Text>
  );
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  return `${minutes}:${ss}`;
}
