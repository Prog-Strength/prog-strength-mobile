// Bottom-tab navigator. Mounted after the user has a token in the
// Keychain — we re-check here as a safety net (so a stale link or a
// manually-cleared token doesn't drop the user into a half-authed
// screen). Per-tab navigation stacks live in subdirectories under this
// route group.
import { useEffect, useState } from "react";
import { Tabs, useRouter } from "expo-router";
import { getToken } from "@/lib/auth";

export default function TabsLayout() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getToken().then((t) => {
      if (!t) {
        router.replace("/login");
      } else {
        setReady(true);
      }
    });
  }, [router]);

  if (!ready) return null;

  return (
    <Tabs
      screenOptions={{
        // Dark-mode-only for v1 — matches the web app and our
        // tailwind.config.js color tokens.
        headerStyle: { backgroundColor: "#0a0a0b" },
        headerTitleStyle: { color: "#fafafa" },
        headerTintColor: "#fafafa",
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: "#0a0a0b",
          borderTopColor: "#27272a",
        },
        tabBarActiveTintColor: "#3b82f6",
        tabBarInactiveTintColor: "#a1a1aa",
        // We don't yet ship custom icons — labels alone are fine for
        // a two-tab v1. Add a glyph library (e.g. @expo/vector-icons)
        // when we add a third or fourth tab.
      }}
    >
      <Tabs.Screen
        name="workouts"
        options={{ title: "Workouts", headerShown: false }}
      />
      <Tabs.Screen name="chat" options={{ title: "Chat" }} />
    </Tabs>
  );
}
