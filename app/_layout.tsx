// Root layout. Mounted once for the whole app, so this is the right
// place to:
//   - import global.css so NativeWind registers every Tailwind utility
//     used by descendant screens
//   - mount the GestureHandlerRootView wrapper (required at the top of
//     the tree for any RN gesture-handler-backed component to work)
//   - set the platform StatusBar style globally
//
// Auth-gating happens in app/index.tsx and (tabs)/_layout.tsx — keeping
// this layout thin means a Stack route can render without paying the
// SecureStore round trip.
import "@/global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

export default function RootLayout() {
  return (
    <GestureHandlerRootView className="flex-1">
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
