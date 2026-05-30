// Nutrition tab. Hosts a three-way segmented control at the top so
// Pantry items, recipes, and bodyweight live one tap from the daily
// food log without growing the bottom tab bar past five entries.
// See initial-mobile-app-implementation SOW for the rationale.
import { useState } from "react";
import { View } from "react-native";
import {
  SegmentedControl,
  type Segment,
} from "@/components/segmented-control";
import { TodayView } from "@/components/nutrition/today-view";
import { PantryView } from "@/components/nutrition/pantry-view";
import { BodyweightView } from "@/components/nutrition/bodyweight-view";

type NutritionSegment = "today" | "pantry" | "bodyweight";

const SEGMENTS: readonly Segment<NutritionSegment>[] = [
  { value: "today", label: "Today" },
  { value: "pantry", label: "Pantry" },
  { value: "bodyweight", label: "Bodyweight" },
];

export default function NutritionScreen() {
  const [segment, setSegment] = useState<NutritionSegment>("today");
  return (
    <View className="flex-1 bg-background">
      <View className="px-4 py-3">
        <SegmentedControl
          value={segment}
          onChange={setSegment}
          segments={SEGMENTS}
          ariaLabel="Nutrition sections"
        />
      </View>
      {segment === "today" && <TodayView />}
      {segment === "pantry" && <PantryView />}
      {segment === "bodyweight" && <BodyweightView />}
    </View>
  );
}
