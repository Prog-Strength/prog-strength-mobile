// Stub — replaced by Task 8.
import { Text, View } from "react-native";
import type { Timeframe } from "./timeframe-pills";

export function OverviewView({ timeframe: _timeframe }: { timeframe: Timeframe }) {
  return (
    <View className="flex-1 items-center justify-center">
      <Text className="text-sm text-muted">
        Overview coming in this branch — Task 8
      </Text>
    </View>
  );
}
