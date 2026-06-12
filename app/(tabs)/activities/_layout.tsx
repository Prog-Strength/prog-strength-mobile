// Stack inside the Activities tab. Lets us push the detail screens on
// top of the list while keeping the tab bar visible — exactly the
// behavior iOS users expect from any list/detail flow.
import { Stack } from "expo-router";
import { AvatarButton } from "@/components/avatar-button";

export default function ActivitiesLayout() {
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
      <Stack.Screen
        name="index"
        options={{ title: "Activities", headerRight: () => <AvatarButton /> }}
      />
      <Stack.Screen name="workout/[id]" options={{ title: "Workout" }} />
      <Stack.Screen name="run/[id]" options={{ title: "Run" }} />
    </Stack>
  );
}
