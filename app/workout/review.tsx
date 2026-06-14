// Review-and-save screen — closes the live-workout loop on phone. Renders
// the full in-progress draft editable one more time (name, notes, every
// exercise/set via the same live ExerciseCard/SupersetCard editing UI,
// plus the performed_at / ended_at timestamps), then fires a single
// POST /workouts via the provider's `save()`. On success the provider
// clears the draft and we route to the saved-workout detail, surfacing
// any PRs the save produced; on failure we keep the draft and show the
// error inline so nothing is stranded.
//
// Timestamps are edited as plain "YYYY-MM-DD HH:MM" text fields (local
// time) rather than a native picker — a nicer native date picker is a
// deliberate follow-up; we avoid adding @react-native-community/
// datetimepicker (or any native module) here to keep the native surface
// / fingerprint unchanged beyond the M1 async-storage addition.
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useActiveWorkoutSession } from "@/lib/active-workout-session";
import { useExerciseCatalog } from "@/components/exercise-catalog-context";
import { useProfile } from "@/lib/profile-context";
import { ExerciseCard } from "@/components/live-workout/exercise-card";
import { SupersetCard, type SupersetMember } from "@/components/live-workout/superset-card";
import { isSessionSaveable } from "@/lib/workout-draft";
import { formatWeight } from "@/lib/units";
import type { DraftExercise } from "@/lib/workout-draft";
import type { PersonalRecordEvent } from "@/lib/api";

// --- local timestamp helpers --------------------------------------
// Mirror the web `rfc3339ToLocalInput` / `localInputToRFC3339` semantics
// (local-time interpretation), but in a "YYYY-MM-DD HH:MM" shape since RN
// has no native datetime-local control. Parsing is strict: an invalid /
// unparseable string returns null so save can be blocked with a message.

const TS_FORMAT = "YYYY-MM-DD HH:MM";

function rfc3339ToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DD HH:MM" (local) → RFC3339, or null when malformed. */
function localInputToRFC3339(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [, y, mo, day, hh, mm] = m;
  const year = Number(y);
  const month = Number(mo);
  const date = Number(day);
  const hour = Number(hh);
  const minute = Number(mm);
  if (month < 1 || month > 12 || date < 1 || date > 31 || hour > 23 || minute > 59) return null;
  // Construct in local time (mirrors `new Date("...")` w/o tz on web).
  const d = new Date(year, month - 1, date, hour, minute, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  // Reject impossible dates that JS would roll over (e.g. Feb 31).
  if (d.getMonth() !== month - 1 || d.getDate() !== date) return null;
  return d.toISOString();
}

// Same superset-grouping walk as the live screen so the review surface
// renders identically (contiguous runs sharing a non-null superset_group
// collapse into one superset chunk; each item keeps its session index).
type Chunk =
  | { type: "single"; index: number; exercise: DraftExercise }
  | { type: "superset"; group: number; members: { index: number; exercise: DraftExercise }[] };

function groupChunks(exercises: DraftExercise[]): Chunk[] {
  const chunks: Chunk[] = [];
  exercises.forEach((exercise, index) => {
    const sg = exercise.superset_group;
    if (sg == null) {
      chunks.push({ type: "single", index, exercise });
      return;
    }
    const prev = chunks[chunks.length - 1];
    if (prev && prev.type === "superset" && prev.group === sg) {
      prev.members.push({ index, exercise });
    } else {
      chunks.push({ type: "superset", group: sg, members: [{ index, exercise }] });
    }
  });
  return chunks;
}

export default function ReviewWorkoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, setName, setNotes, save, discard } = useActiveWorkoutSession();
  const { byID } = useExerciseCatalog();
  const { profile } = useProfile();
  const preferred = profile?.weight_unit;

  // Timestamp text fields, seeded once from the draft. performed_at comes
  // from the session; ended_at defaults to "now" (the workout is ending).
  const [performedAtText, setPerformedAtText] = useState("");
  const [endedAtText, setEndedAtText] = useState("");
  const [seeded, setSeeded] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // No active session → nothing to review. Bounce back to Activities in
  // an effect so we don't navigate during render.
  useEffect(() => {
    if (!session) router.replace("/(tabs)/activities");
  }, [session, router]);

  // Seed the timestamp fields once the session is available.
  useEffect(() => {
    if (session && !seeded) {
      setPerformedAtText(rfc3339ToLocalInput(session.performed_at));
      setEndedAtText(rfc3339ToLocalInput(new Date().toISOString()));
      setSeeded(true);
    }
  }, [session, seeded]);

  const chunks = useMemo(() => groupChunks(session?.exercises ?? []), [session?.exercises]);

  if (!session) return null;

  const performedAtRFC = localInputToRFC3339(performedAtText);
  // ended_at is optional: an empty field omits it; a non-empty malformed
  // field is an error.
  const endedAtTrimmed = endedAtText.trim();
  const endedAtRFC = endedAtTrimmed ? localInputToRFC3339(endedAtTrimmed) : "";
  const performedInvalid = performedAtRFC === null;
  const endedInvalid = endedAtRFC === null;

  const saveable = isSessionSaveable(session) && !performedInvalid && !endedInvalid && !saving;

  async function onSave() {
    if (!session) return;
    if (performedAtRFC === null) {
      setError(`Performed time is invalid — use ${TS_FORMAT}.`);
      return;
    }
    if (endedAtRFC === null) {
      setError(`Ended time is invalid — use ${TS_FORMAT} or leave it blank.`);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      // Pass the edited timestamps directly to save as explicit overrides
      // (undefined ended_at → provider stamps "now"). Passing performed_at
      // here avoids the async-state round-trip that previously dropped the
      // user's edit from the payload.
      const created = await save(endedAtRFC || undefined, performedAtRFC || undefined);
      surfacePRs(created.personal_records_set);
      // Provider already cleared the draft; route to the saved workout.
      router.replace(`/(tabs)/activities/workout/${created.id}`);
    } catch (err) {
      // Failure keeps the draft intact (provider only clears on success).
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  function surfacePRs(prs: PersonalRecordEvent[]) {
    if (prs.length === 0) return;
    const lines = prs.map((pr) => {
      const name = byID.get(pr.exercise_id)?.name ?? pr.exercise_id;
      return `${name} ${formatWeight(pr.weight, pr.unit, preferred ?? pr.unit)} × ${pr.reps}`;
    });
    const title = prs.length === 1 ? "New personal record!" : `${prs.length} new personal records!`;
    Alert.alert(title, lines.map((l) => `New PR: ${l}`).join("\n"));
  }

  function onDiscard() {
    Alert.alert(
      "Discard workout?",
      "This will delete the in-progress workout. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            discard();
            router.replace("/(tabs)/activities");
          },
        },
      ],
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Header — title + Back to the live screen */}
      <View
        className="flex-row items-center justify-between gap-3 border-b border-border bg-background px-4 pb-3"
        style={{ paddingTop: insets.top + 8 }}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to live workout"
          className="min-h-11 justify-center active:opacity-70"
        >
          <Text className="text-sm text-accent">‹ Back</Text>
        </Pressable>
        <Text className="text-lg font-semibold text-foreground">Review & save</Text>
        <View className="min-w-11" />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Name + notes */}
        <View className="rounded-lg border border-border bg-surface px-4 py-3">
          <Text className="text-[10px] uppercase tracking-wider text-muted">Name</Text>
          <TextInput
            value={session.name}
            onChangeText={setName}
            placeholder="Workout name"
            placeholderTextColor="#71717a"
            className="mt-1 min-h-11 text-base font-semibold text-foreground"
          />
          <Text className="mt-3 text-[10px] uppercase tracking-wider text-muted">Notes</Text>
          <TextInput
            value={session.notes ?? ""}
            onChangeText={setNotes}
            placeholder="Workout notes (optional)"
            placeholderTextColor="#71717a"
            multiline
            className="mt-1 min-h-11 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </View>

        {/* Timestamps */}
        <View className="rounded-lg border border-border bg-surface px-4 py-3">
          <Text className="text-[10px] uppercase tracking-wider text-muted">
            Performed at ({TS_FORMAT})
          </Text>
          <TextInput
            value={performedAtText}
            onChangeText={setPerformedAtText}
            placeholder={TS_FORMAT}
            placeholderTextColor="#71717a"
            autoCapitalize="none"
            autoCorrect={false}
            className={`mt-1 min-h-11 rounded-md border bg-background px-3 py-2 text-sm tabular-nums text-foreground ${
              performedInvalid ? "border-danger" : "border-border"
            }`}
          />
          {performedInvalid && (
            <Text className="mt-1 text-xs text-danger">Required — use {TS_FORMAT}.</Text>
          )}

          <Text className="mt-3 text-[10px] uppercase tracking-wider text-muted">
            Ended at ({TS_FORMAT}, optional)
          </Text>
          <TextInput
            value={endedAtText}
            onChangeText={setEndedAtText}
            placeholder={TS_FORMAT}
            placeholderTextColor="#71717a"
            autoCapitalize="none"
            autoCorrect={false}
            className={`mt-1 min-h-11 rounded-md border bg-background px-3 py-2 text-sm tabular-nums text-foreground ${
              endedInvalid ? "border-danger" : "border-border"
            }`}
          />
          {endedInvalid && (
            <Text className="mt-1 text-xs text-danger">
              Invalid — use {TS_FORMAT} or leave it blank.
            </Text>
          )}
        </View>

        {/* Exercises / supersets — reuse the live editing UI */}
        {chunks.length === 0 && (
          <View className="rounded-lg border border-border bg-surface px-4 py-6">
            <Text className="text-center text-sm text-muted">
              No exercises logged. Go back to add some before saving.
            </Text>
          </View>
        )}

        {chunks.map((chunk) =>
          chunk.type === "single" ? (
            <ExerciseCard
              key={`s:${chunk.index}`}
              exercise={chunk.exercise}
              index={chunk.index}
              name={byID.get(chunk.exercise.exercise_id)?.name ?? chunk.exercise.exercise_id}
              total={session.exercises.length}
              selected={false}
              onToggleSelect={() => {}}
            />
          ) : (
            <SupersetCard
              key={`ss:${chunk.group}`}
              group={chunk.group}
              members={chunk.members.map<SupersetMember>((m) => ({
                index: m.index,
                exercise: m.exercise,
                name: byID.get(m.exercise.exercise_id)?.name ?? m.exercise.exercise_id,
              }))}
            />
          ),
        )}

        {/* Save error (draft preserved) */}
        {error && (
          <View className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3">
            <Text className="text-sm text-danger">{error}</Text>
          </View>
        )}

        {/* Save */}
        <Pressable
          onPress={onSave}
          disabled={!saveable}
          accessibilityRole="button"
          accessibilityLabel="Save workout"
          accessibilityState={{ disabled: !saveable }}
          className={`min-h-11 items-center justify-center rounded-md border border-accent bg-accent active:opacity-80 ${
            saveable ? "" : "opacity-40"
          }`}
        >
          <Text className="text-sm font-semibold text-background">
            {saving ? "Saving…" : "Save workout"}
          </Text>
        </Pressable>

        {/* Discard */}
        <Pressable
          onPress={onDiscard}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Discard workout"
          className="min-h-11 items-center justify-center rounded-md border border-danger/40 bg-danger/10 active:opacity-70"
        >
          <Text className="text-sm font-medium text-danger">Discard workout</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
