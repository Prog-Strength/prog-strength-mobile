// Stack inside the Workouts tab. Lets us push the detail screen on
// top of the list while keeping the tab bar visible — exactly the
// behavior iOS users expect from any list/detail flow.
import { Stack } from "expo-router";

export default function WorkoutsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#0a0a0b" },
        headerTitleStyle: { color: "#fafafa" },
        headerTintColor: "#fafafa",
        headerShadowVisible: false,
        contentStyle: { backgroundColor: "#0a0a0b" },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Workouts" }} />
      <Stack.Screen name="[id]" options={{ title: "Workout" }} />
    </Stack>
  );
}
