// Activities hub — Overview | Workouts | Running, mirroring the web
// /activities page. The segment state is local (no URL backing on
// mobile); the timeframe pills drive Overview + Running (Workouts
// keeps its own weekly view — deliberate deviation from web).
import { useState } from "react";
import { View } from "react-native";
import { SegmentedControl } from "@/components/segmented-control";
import { WorkoutsView } from "@/components/activities/workouts-view";
import { OverviewView } from "@/components/activities/overview-view";
import { RunningView } from "@/components/activities/running-view";
import { TimeframePills, type Timeframe } from "@/components/activities/timeframe-pills";

type ActivityView = "overview" | "workouts" | "running";

export default function ActivitiesScreen() {
  const [view, setView] = useState<ActivityView>("overview");
  const [timeframe, setTimeframe] = useState<Timeframe>("30d");

  return (
    <View className="flex-1 bg-background">
      <View className="gap-3 px-4 pt-3">
        <SegmentedControl
          value={view}
          onChange={setView}
          segments={[
            { value: "overview", label: "Overview" },
            { value: "workouts", label: "Workouts" },
            { value: "running", label: "Running" },
          ]}
        />
        {view !== "workouts" && (
          <TimeframePills value={timeframe} onChange={setTimeframe} />
        )}
      </View>
      {view === "overview" && <OverviewView timeframe={timeframe} />}
      {view === "workouts" && <WorkoutsView />}
      {view === "running" && <RunningView timeframe={timeframe} />}
    </View>
  );
}
