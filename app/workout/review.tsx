// Placeholder for the review-and-save screen. Task M4 replaces this with
// the real surface (editable name/notes/sets, performed_at/ended_at, and
// the single POST /workouts via `save()`). For now it exists so the live
// screen's "Finish" button has a valid typed route to push to; with no
// session it bounces back to Activities, otherwise back to the live
// screen so the in-progress draft is never stranded on a dead screen.
import { Redirect } from "expo-router";
import { useActiveWorkoutSession } from "@/lib/active-workout-session";

export default function ReviewWorkoutPlaceholder() {
  const { session } = useActiveWorkoutSession();
  return <Redirect href={session ? "/workout/live" : "/(tabs)/activities"} />;
}
