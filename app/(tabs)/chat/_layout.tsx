// Stack inside the Chat tab. Mirrors activities/_layout.tsx — the Stack
// header owns the title + buttons so the chat surface gains "New chat"
// and "History" affordances without sacrificing the bottom tab bar.
// The tab itself is set headerShown:false (see (tabs)/_layout.tsx) so
// only this Stack draws the header.
import { Stack } from "expo-router";
import { AvatarButton } from "@/components/avatar-button";

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
      <Stack.Screen
        name="index"
        options={{
          title: "Chat",
          // When "New chat" / "History" buttons are added (future task),
          // wrap all buttons in a <View className="flex-row gap-2"> and
          // append <AvatarButton /> after them.
          headerRight: () => <AvatarButton />,
        }}
      />
      <Stack.Screen name="history" options={{ title: "Chat history" }} />
    </Stack>
  );
}
