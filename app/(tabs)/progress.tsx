// Progress tab. Two segments at the top — the muscle-group chart and
// the personal-records trophy case. Both views could plausibly live as
// their own bottom tabs, but the 5-tab cap forces them to share one
// (see initial-mobile-app-implementation SOW).
import { useState } from "react";
import { View } from "react-native";
import {
  SegmentedControl,
  type Segment,
} from "@/components/segmented-control";
import { ProgressView } from "@/components/progress/progress-view";
import { PRsView } from "@/components/progress/prs-view";

type ProgressSegment = "progress" | "prs";

const SEGMENTS: readonly Segment<ProgressSegment>[] = [
  { value: "progress", label: "Progress" },
  { value: "prs", label: "PRs" },
];

export default function ProgressScreen() {
  const [segment, setSegment] = useState<ProgressSegment>("progress");
  return (
    <View className="flex-1 bg-background">
      <View className="px-4 py-3">
        <SegmentedControl
          value={segment}
          onChange={setSegment}
          segments={SEGMENTS}
          ariaLabel="Progress sections"
        />
      </View>
      {segment === "progress" ? <ProgressView /> : <PRsView />}
    </View>
  );
}
