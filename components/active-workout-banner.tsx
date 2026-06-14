// App-wide "workout in progress" pill. Shows whenever a live session is
// active (`session !== null`) and the user is NOT already on the live or
// review screen. Sits absolutely above the bottom tab bar; tapping it
// routes back to the live screen so the user can pick up where they
// left off after wandering through the rest of the app.
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter, useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useActiveWorkoutSession } from "@/lib/active-workout-session";

// Height of the bottom tab bar content (excluding the home-indicator
// inset) so the pill floats just above it on every tab screen.
const TAB_BAR_HEIGHT = 49;

export function ActiveWorkoutBanner() {
  const router = useRouter();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const { session } = useActiveWorkoutSession();

  // Re-render once a second so the elapsed duration ticks.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session]);

  if (!session) return null;

  // Hide on the workout flow itself (live + review) — the pill is for
  // getting *back* to it, not for showing while you're there.
  const onWorkoutFlow = segments.some((s) => s === "workout");
  if (onWorkoutFlow) return null;

  const elapsed = formatDuration(now - new Date(session.performed_at).getTime());

  return (
    <View
      pointerEvents="box-none"
      className="absolute inset-x-0"
      style={{ bottom: TAB_BAR_HEIGHT + insets.bottom + 8 }}
    >
      <Pressable
        onPress={() => router.push("/workout/live")}
        accessibilityRole="button"
        accessibilityLabel="Resume workout in progress"
        className="mx-4 flex-row items-center justify-between rounded-full border border-border bg-surface px-4 py-2.5 active:opacity-80"
      >
        <View className="flex-row items-center gap-2">
          <View className="h-2 w-2 rounded-full bg-accent" />
          <Text className="text-sm font-medium text-foreground">Workout in progress</Text>
        </View>
        <Text className="text-sm tabular-nums text-muted">{elapsed}</Text>
      </Pressable>
    </View>
  );
}

// "M:SS" under an hour, "H:MM:SS" once it crosses one. Mirrors the
// DurationClock formatting the live screen will use.
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  return `${minutes}:${ss}`;
}
