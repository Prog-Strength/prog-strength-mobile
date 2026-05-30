// Bottom-tab navigator. Mounted after the user has a token in the
// Keychain — we re-check here as a safety net (so a stale link or a
// manually-cleared token doesn't drop the user into a half-authed
// screen). Per-tab navigation stacks live in subdirectories under this
// route group.
//
// Tab layout per the initial-mobile-app-implementation SOW:
//   Chat · Workouts · Calendar · Nutrition · Progress
//
// Five is the practical max for iOS bottom navigation. Personal
// Records nests inside Progress and Pantry + Bodyweight nest inside
// Nutrition via top-of-screen segmented controls (added in their
// respective phases).
import { useEffect, useState } from "react";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getToken } from "@/lib/auth";
import { ExerciseCatalogProvider } from "@/components/exercise-catalog-context";

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

  // Catalog provider sits inside the auth gate (above) and above every
  // screen (below), so /exercises gets fetched exactly once per
  // authed session instead of on every tab focus.
  return (
    <ExerciseCatalogProvider>
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
      }}
    >
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubble-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="workouts"
        options={{
          title: "Workouts",
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="barbell-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: "Calendar",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="nutrition"
        options={{
          title: "Nutrition",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="restaurant-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: "Progress",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trending-up-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
    </ExerciseCatalogProvider>
  );
}
