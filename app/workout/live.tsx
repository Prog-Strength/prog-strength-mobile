// Placeholder for the live-session screen. Task M3 replaces this with
// the real logging surface (exercise search, set/superset cards, clock,
// rest timer). For now it simply bounces back to the Activities tab so
// the start button / in-progress pill have a valid typed route to push.
import { Redirect } from "expo-router";

export default function LiveWorkoutPlaceholder() {
  return <Redirect href="/(tabs)/activities" />;
}
