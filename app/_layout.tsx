// Root layout. Mounted once for the whole app, so this is the right
// place to:
//   - import global.css so NativeWind registers every Tailwind utility
//     used by descendant screens
//   - mount the GestureHandlerRootView wrapper (required at the top of
//     the tree for any RN gesture-handler-backed component to work)
//   - set the platform StatusBar style globally
//   - mount ProfileProvider and UsageProvider so they are available to
//     every route, including Settings which lives outside the tab group;
//     both providers are lazy (no I/O at mount) so this layout keeps its
//     documented "no SecureStore round trip at mount" property — the
//     first fetch is triggered by the (tabs) auth gate after a token is
//     confirmed
//
// Auth-gating happens in app/index.tsx and (tabs)/_layout.tsx — keeping
// this layout thin means a Stack route can render without paying the
// SecureStore round trip.
import "@/global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ProfileProvider } from "@/lib/profile-context";
import { UsageProvider } from "@/lib/usage-context";

export default function RootLayout() {
  return (
    <GestureHandlerRootView className="flex-1">
      <SafeAreaProvider>
        <ProfileProvider>
          <UsageProvider>
            <StatusBar style="light" />
            <Stack screenOptions={{ headerShown: false }} />
          </UsageProvider>
        </ProfileProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
