import { Text, View } from "react-native";

/**
 * Tab-stub component for tabs whose real implementation lands in a
 * later phase of the initial-mobile-app-implementation SOW. Lets the
 * 5-tab bar light up end-to-end on Phase 1 so navigation can be
 * exercised on a device before the screen contents arrive.
 *
 * Delete this component (and every usage) once the last tab ships.
 */
export function ComingSoon({ title, body }: { title: string; body: string }) {
  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <View className="w-full max-w-sm gap-2">
        <Text className="text-center text-xl font-semibold text-foreground">{title}</Text>
        <Text className="text-center text-sm text-muted">{body}</Text>
      </View>
    </View>
  );
}
