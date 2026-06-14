// Foreground rest-timer countdown. Reads `session.restTimer` and, when
// set, shows a live countdown from `startedAt + durationSec` ticking
// once a second. At zero it flips to a "Rest complete" state. The user
// can adjust the default rest duration (persisted on the session via
// `setRestDefault`) and dismiss the active timer (`clearRestTimer`).
//
// SCOPE BOUNDARY (per SOW/plan): this is a foreground-only countdown.
// Scheduling a local notification so the timer fires while the app is
// backgrounded would require `expo-notifications`, which is not a
// dependency and would expand the native surface / change the build
// fingerprint — that piece is a deliberate follow-up, intentionally
// out of scope here.
import { Pressable, Text, View } from "react-native";
import { useActiveWorkoutSession } from "@/lib/active-workout-session";
import { useNow } from "@/components/live-workout/use-now";

// Quick-pick rest durations (seconds) offered when no timer is running.
const PRESETS = [60, 90, 120, 180] as const;

export function RestTimer() {
  const { session, clearRestTimer, setRestDefault } = useActiveWorkoutSession();
  const now = useNow(1000);

  if (!session) return null;

  const timer = session.restTimer;

  // Idle state: no active countdown — show the configurable default.
  if (!timer) {
    return (
      <View className="border-t border-border bg-surface px-4 py-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-xs uppercase tracking-wider text-muted">Rest timer</Text>
          <Text className="text-xs text-muted">
            Default {formatSeconds(session.restDefaultSec)}
          </Text>
        </View>
        <View className="mt-2 flex-row gap-2">
          {PRESETS.map((sec) => {
            const active = sec === session.restDefaultSec;
            return (
              <Pressable
                key={sec}
                onPress={() => setRestDefault(sec)}
                accessibilityRole="button"
                accessibilityLabel={`Set default rest to ${formatSeconds(sec)}`}
                accessibilityState={{ selected: active }}
                className={`min-h-11 flex-1 items-center justify-center rounded-md border px-2 py-2 active:opacity-70 ${
                  active ? "border-accent bg-accent/15" : "border-border bg-background"
                }`}
              >
                <Text className={`text-sm ${active ? "text-accent" : "text-foreground"}`}>
                  {formatSeconds(sec)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  const endsAt = new Date(timer.startedAt).getTime() + timer.durationSec * 1000;
  const remainingMs = endsAt - now;
  const done = remainingMs <= 0;

  return (
    <View
      className={`flex-row items-center justify-between border-t px-4 py-3 ${
        done ? "border-accent bg-accent/15" : "border-border bg-surface"
      }`}
    >
      <View>
        <Text className="text-xs uppercase tracking-wider text-muted">
          {done ? "Rest complete" : "Resting"}
        </Text>
        <Text
          className={`mt-0.5 text-2xl font-semibold tabular-nums ${
            done ? "text-accent" : "text-foreground"
          }`}
          accessibilityLabel={
            done
              ? "Rest complete"
              : `Rest remaining ${formatSeconds(Math.ceil(remainingMs / 1000))}`
          }
        >
          {done ? "0:00" : formatSeconds(Math.ceil(remainingMs / 1000))}
        </Text>
      </View>
      <Pressable
        onPress={clearRestTimer}
        accessibilityRole="button"
        accessibilityLabel="Dismiss rest timer"
        className="min-h-11 items-center justify-center rounded-md border border-border bg-background px-4 py-2 active:opacity-70"
      >
        <Text className="text-sm font-medium text-foreground">Dismiss</Text>
      </Pressable>
    </View>
  );
}

function formatSeconds(totalSec: number): string {
  const total = Math.max(0, Math.floor(totalSec));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
