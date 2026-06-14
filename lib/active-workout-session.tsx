/**
 * Root-mounted live-workout session state. Owns a single in-progress
 * draft (`ActiveSession | null`), mirrors every mutation to device
 * storage (AsyncStorage, key `ps_active_workout_session`) so the
 * session survives both in-app navigation and a force-quit/relaunch,
 * and exposes the full action surface the live + review screens use.
 *
 * The draft is local-only until the user confirms the review screen,
 * where a single POST /workouts fires via `save()`.
 *
 * Mirrors prog-strength-web/lib/active-workout-session.tsx in action
 * surface + semantics; the only difference is persistence (AsyncStorage
 * is async, so hydration happens in a mount effect behind a `hydrated`
 * flag while children render immediately).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createWorkout, listWorkouts, type Workout } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { useProfile } from "@/lib/profile-context";
import {
  addExercise as addExercisePure,
  addSet as addSetPure,
  buildPrefillMap,
  createSession,
  createSuperset as createSupersetPure,
  defaultSet,
  logSupersetRound as logSupersetRoundPure,
  removeExercise as removeExercisePure,
  removeSet as removeSetPure,
  reorderExercise as reorderExercisePure,
  sessionToPayload,
  setExerciseNotes as setExerciseNotesPure,
  setName as setNamePure,
  setNotes as setNotesPure,
  ungroupSuperset as ungroupSupersetPure,
  updateSet as updateSetPure,
  type ActiveSession,
  type DraftSet,
} from "@/lib/workout-draft";

const STORAGE_KEY = "ps_active_workout_session";

type ActiveWorkoutSessionValue = {
  session: ActiveSession | null;
  /** exercise_id → last-logged set, populated by `start()`. */
  prefill: Map<string, DraftSet>;
  start: () => void;
  discard: () => void;
  save: (endedAt?: string) => Promise<Workout>;
  setName: (name: string) => void;
  setNotes: (notes: string) => void;
  setExerciseNotes: (exIdx: number, notes: string) => void;
  addExercise: (exercise_id: string) => void;
  removeExercise: (idx: number) => void;
  reorderExercise: (from: number, to: number) => void;
  addSet: (exIdx: number, set: DraftSet) => void;
  updateSet: (exIdx: number, setIdx: number, patch: Partial<DraftSet>) => void;
  removeSet: (exIdx: number, setIdx: number) => void;
  createSuperset: (idxs: number[]) => void;
  ungroupSuperset: (group: number) => void;
  logSupersetRound: (group: number, sets: Record<number, DraftSet>) => void;
  setTimes: (performed_at?: string) => void;
  startRestTimer: () => void;
  clearRestTimer: () => void;
  setRestDefault: (sec: number) => void;
};

const ActiveWorkoutSessionContext = createContext<ActiveWorkoutSessionValue | null>(null);

export function ActiveWorkoutSessionProvider({ children }: { children: ReactNode }) {
  const { profile } = useProfile();
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [prefill, setPrefill] = useState<Map<string, DraftSet>>(new Map());
  // Guard write-through so we don't clobber stored state with the
  // initial `null` before the async hydrate has had a chance to read.
  const [hydrated, setHydrated] = useState(false);

  // Keep the latest unit and prefill in refs so the action callbacks
  // stay stable (no churn) while still reading fresh values.
  const unit: "lb" | "kg" = profile?.weight_unit ?? "lb";
  const unitRef = useRef(unit);
  unitRef.current = unit;
  const prefillRef = useRef(prefill);
  prefillRef.current = prefill;

  // Hydrate once on mount. Children render immediately; `session`
  // populates if a draft was persisted.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && raw) {
          setSession(JSON.parse(raw) as ActiveSession);
        }
      } catch {
        // Corrupt/unreadable storage → start clean.
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Write through on every change once hydration has completed.
  useEffect(() => {
    if (!hydrated) return;
    if (session) {
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      void AsyncStorage.removeItem(STORAGE_KEY);
    }
  }, [session, hydrated]);

  // Apply a pure mutator to the current session (no-op when idle).
  const mutate = useCallback((fn: (s: ActiveSession) => ActiveSession) => {
    setSession((s) => (s ? fn(s) : s));
  }, []);

  const start = useCallback(() => {
    setSession(createSession(new Date()));
    setPrefill(new Map());
    // Kick off last-time prefill in the background. Degrade silently on
    // any failure — prefill is a convenience, not a requirement.
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const page = await listWorkouts(token, { limit: 50 });
        setPrefill(buildPrefillMap(page.items));
      } catch {
        // ignore — new sets just fall back to the profile unit default
      }
    })();
  }, []);

  const discard = useCallback(() => {
    setSession(null);
  }, []);

  const save = useCallback(
    async (endedAt?: string): Promise<Workout> => {
      if (!session) throw new Error("no active workout session to save");
      const token = await getToken();
      if (!token) throw new Error("not authenticated");
      const payload = sessionToPayload(session, endedAt ?? new Date().toISOString());
      const created = await createWorkout(token, payload);
      // Success → clear the draft (and its stored copy via write-through).
      setSession(null);
      return created;
    },
    [session],
  );

  const setName = useCallback((name: string) => mutate((s) => setNamePure(s, name)), [mutate]);
  const setNotes = useCallback((notes: string) => mutate((s) => setNotesPure(s, notes)), [mutate]);
  const setExerciseNotes = useCallback(
    (exIdx: number, notes: string) => mutate((s) => setExerciseNotesPure(s, exIdx, notes)),
    [mutate],
  );

  const addExercise = useCallback(
    (exercise_id: string) =>
      mutate((s) => {
        // Seed the first set from last-time prefill when we have it,
        // else a zeroed set in the profile's unit.
        const seed = prefillRef.current.get(exercise_id) ?? defaultSet(unitRef.current);
        return addExercisePure(s, exercise_id, seed);
      }),
    [mutate],
  );

  const removeExercise = useCallback(
    (idx: number) => mutate((s) => removeExercisePure(s, idx)),
    [mutate],
  );
  const reorderExercise = useCallback(
    (from: number, to: number) => mutate((s) => reorderExercisePure(s, from, to)),
    [mutate],
  );
  const addSet = useCallback(
    (exIdx: number, set: DraftSet) => mutate((s) => addSetPure(s, exIdx, set)),
    [mutate],
  );
  const updateSet = useCallback(
    (exIdx: number, setIdx: number, patch: Partial<DraftSet>) =>
      mutate((s) => updateSetPure(s, exIdx, setIdx, patch)),
    [mutate],
  );
  const removeSet = useCallback(
    (exIdx: number, setIdx: number) => mutate((s) => removeSetPure(s, exIdx, setIdx)),
    [mutate],
  );
  const createSuperset = useCallback(
    (idxs: number[]) => mutate((s) => createSupersetPure(s, idxs)),
    [mutate],
  );
  const ungroupSuperset = useCallback(
    (group: number) => mutate((s) => ungroupSupersetPure(s, group)),
    [mutate],
  );
  const logSupersetRound = useCallback(
    (group: number, sets: Record<number, DraftSet>) =>
      mutate((s) => logSupersetRoundPure(s, group, sets)),
    [mutate],
  );

  // The draft model only stores `performed_at`; `ended_at` is stamped
  // at save (passed into `save()`), matching `sessionToPayload`. The
  // signature keeps the web parity but the `ended_at` arg is a no-op on
  // the session itself and is left to the caller to forward to `save`.
  const setTimes = useCallback(
    (performed_at?: string) =>
      mutate((s) => ({
        ...s,
        ...(performed_at !== undefined && { performed_at }),
      })),
    [mutate],
  );

  const startRestTimer = useCallback(
    () =>
      mutate((s) => ({
        ...s,
        restTimer: { startedAt: new Date().toISOString(), durationSec: s.restDefaultSec },
      })),
    [mutate],
  );
  const clearRestTimer = useCallback(() => mutate((s) => ({ ...s, restTimer: null })), [mutate]);
  const setRestDefault = useCallback(
    (sec: number) => mutate((s) => ({ ...s, restDefaultSec: sec })),
    [mutate],
  );

  return (
    <ActiveWorkoutSessionContext.Provider
      value={{
        session,
        prefill,
        start,
        discard,
        save,
        setName,
        setNotes,
        setExerciseNotes,
        addExercise,
        removeExercise,
        reorderExercise,
        addSet,
        updateSet,
        removeSet,
        createSuperset,
        ungroupSuperset,
        logSupersetRound,
        setTimes,
        startRestTimer,
        clearRestTimer,
        setRestDefault,
      }}
    >
      {children}
    </ActiveWorkoutSessionContext.Provider>
  );
}

/** Throws outside <ActiveWorkoutSessionProvider> so a missing provider fails loudly. */
export function useActiveWorkoutSession(): ActiveWorkoutSessionValue {
  const ctx = useContext(ActiveWorkoutSessionContext);
  if (!ctx) {
    throw new Error("useActiveWorkoutSession must be used within an ActiveWorkoutSessionProvider");
  }
  return ctx;
}
