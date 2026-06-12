// TODO(task 9): Replace with the real Settings screen implementation.
// Placeholder required so typedRoutes can resolve "/settings" in
// AvatarButton — without this file the router type union omits the
// route and router.push("/settings") is a type error.
import { View, Text } from "react-native";

export default function SettingsPlaceholder() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Text className="text-foreground">Settings — coming soon</Text>
    </View>
  );
}
