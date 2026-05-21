/**
 * Direct fetchers against the Prog Strength API. The mobile app calls
 * this for everything that isn't chat — the agent handles those.
 *
 * Auth: pass the JWT from `getToken()` in lib/auth.ts as a Bearer
 * token. Public endpoints (the exercise catalog) skip it.
 *
 * v1 covers Login + Workouts + Chat. Personal Records, Progress, and
 * mutations (create/update/delete) are deferred until the read-only
 * loop is real on a device.
 */
import { config } from "@/lib/config";

/**
 * A single set within a workout exercise.
 *
 * Named `WorkoutSet` rather than `Set` to avoid shadowing TypeScript's
 * built-in generic `Set<T>` for callers that pull both into scope.
 */
export type WorkoutSet = {
  reps: number;
  weight: number;
  unit: "lb" | "kg";
};

export type WorkoutExercise = {
  exercise_id: string;
  order: number;
  superset_group?: number | null;
  sets: WorkoutSet[];
  notes?: string;
};

/**
 * One row of the personal record event log — the moment a (user,
 * exercise) PR was broken. Embedded inline on workouts that produced
 * one or more breaks so the workouts list/detail UI can badge a
 * session without a second round trip.
 */
export type PersonalRecordEvent = {
  id: string;
  exercise_id: string;
  workout_id: string;
  weight: number;
  reps: number;
  unit: "lb" | "kg";
  previous_weight: number | null;
  previous_reps: number | null;
  previous_unit: "lb" | "kg" | null;
  achieved_at: string;
};

export type Workout = {
  id: string;
  user_id: string;
  name?: string;
  performed_at: string; // RFC3339
  ended_at?: string | null;
  notes?: string;
  exercises: WorkoutExercise[];
  created_at: string;
  updated_at: string;
  personal_records_set: PersonalRecordEvent[];
};

export type Exercise = {
  id: string; // slug
  name: string;
  description?: string;
  muscle_groups: string[];
  equipment: string[];
};

export type ListWorkoutsOptions = {
  since?: string; // RFC3339
  until?: string; // RFC3339
  limit?: number; // 1–100, server defaults to 50
  offset?: number;
};

export type WorkoutsPage = {
  items: Workout[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
};

/**
 * GET /workouts. Returns one page of the authed user's workouts, most
 * recent first. Pass `since`/`until` for server-side timeframe filtering;
 * pass `limit`/`offset` for pagination.
 */
export async function listWorkouts(
  token: string,
  options: ListWorkoutsOptions = {},
): Promise<WorkoutsPage> {
  const params = new URLSearchParams();
  if (options.since) params.set("since", options.since);
  if (options.until) params.set("until", options.until);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined)
    params.set("offset", String(options.offset));
  const qs = params.toString();
  const resp = await fetch(
    `${config.apiUrl}/workouts${qs ? `?${qs}` : ""}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return await unwrap<WorkoutsPage>(resp, {
    items: [],
    total: 0,
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
    has_more: false,
  });
}

/**
 * GET /exercises. Public — no token. Returns the shared, admin-curated
 * catalog used to map exercise_id slugs to human-readable names.
 */
export async function listExercises(): Promise<Exercise[]> {
  const resp = await fetch(`${config.apiUrl}/exercises`);
  return unwrap<Exercise[]>(resp, []);
}

/**
 * GET /workouts/{id}. Returns a single workout owned by the authed
 * user. 404 if the ID doesn't exist or belongs to another user
 * (deliberately indistinguishable so IDs can't be enumerated).
 */
export async function getWorkout(
  token: string,
  id: string,
): Promise<Workout> {
  const resp = await fetch(
    `${config.apiUrl}/workouts/${encodeURIComponent(id)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const got = await unwrap<Workout | null>(resp, null);
  if (!got) {
    throw new Error("workout not found");
  }
  return got;
}

/**
 * Common envelope unwrapper. The API wraps every success response in
 * `{service, message, data}`; the caller only cares about `data`.
 * Errors come back as `{service, error}` — we surface `error` as the
 * thrown message so callers don't repeat envelope parsing.
 *
 * `empty` is returned when `data` is missing or null (typical for list
 * endpoints with `omitempty` on the envelope field).
 */
async function unwrap<T>(resp: Response, empty: T): Promise<T> {
  if (!resp.ok) {
    let detail: string;
    try {
      const body = await resp.json();
      detail = body?.error ?? `HTTP ${resp.status}`;
    } catch {
      detail = `HTTP ${resp.status}`;
    }
    throw new Error(detail);
  }
  const body = await resp.json();
  return (body?.data as T | undefined) ?? empty;
}
