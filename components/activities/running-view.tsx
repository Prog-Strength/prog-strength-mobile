// Stub — replaced by Task 5.
import { Text, View } from "react-native";
import type { Timeframe } from "./timeframe-pills";

export function RunningView({ timeframe: _timeframe }: { timeframe: Timeframe }) {
  return (
    <View className="flex-1 items-center justify-center">
      <Text className="text-sm text-muted">
        Running coming in this branch — Task 5
      </Text>
    </View>
  );
}
