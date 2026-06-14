// Root-level Stack for the live-workout flow (live + review). Sits
// OUTSIDE the (tabs) group so the logging surface takes over the full
// screen (no tab bar) — the in-progress pill is what brings the user
// back here from elsewhere in the app. Headers are hidden; each screen
// renders its own in-content header so the inline-editable name, clock,
// and finish/discard controls can live together.
import { Stack } from "expo-router";

export default function WorkoutFlowLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#0a0a0b" },
      }}
    >
      <Stack.Screen name="live" />
      <Stack.Screen name="review" />
    </Stack>
  );
}
