// Stack inside the Chat tab. Mirrors workouts/_layout.tsx — the Stack
// header owns the title + buttons so the chat surface gains "New chat"
// and "History" affordances without sacrificing the bottom tab bar.
// The tab itself is set headerShown:false (see (tabs)/_layout.tsx) so
// only this Stack draws the header.
import { Stack } from "expo-router";

export default function ChatLayout() {
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
      <Stack.Screen name="index" options={{ title: "Chat" }} />
      <Stack.Screen name="history" options={{ title: "Chat history" }} />
    </Stack>
  );
}
