/**
 * Direct fetchers against the Prog Strength API.
 *
 * The agent service handles chat (Claude tool-use loop, SSE streaming).
 * For straight read endpoints like /workouts and /exercises, the
 * frontend calls the API directly — there's nothing the agent would
 * add to those requests beyond an extra hop.
 *
 * Auth: pass the user's JWT (from `getToken()` in lib/auth.ts) as a
 * Bearer token. Public endpoints (the exercise catalog) skip it.
 *
 * Sibling file: prog-strength-web/lib/api.ts. The two files are kept
 * deliberately in sync — same types, same fetcher signatures, same
 * envelope unwrapper. When an API endpoint changes shape, update both
 * sides in the same change set. See the initial-mobile-app-implementation
 * SOW for the rationale (duplication beats a shared package at our
 * scale; the drift discipline is "edit twice").
 */

import { config } from "@/lib/config";

/**
 * A single set within a workout exercise.
 *
 * Named `WorkoutSet` rather than `Set` to avoid colliding with
 * TypeScript's built-in generic `Set<T>` — importing `Set` from this
 * module would shadow the global in files that use both.
 */
export type WorkoutSet = {
  reps: number;
  weight: number;
  unit: "lb" | "kg";
};

/** One exercise within a workout, with its sets. */
export type WorkoutExercise = {
  exercise_id: string;
  order: number;
  superset_group?: number | null;
  sets: WorkoutSet[];
  notes?: string;
};

/**
 * One row of the personal record event log — captures the moment a
 * (user, exercise) PR was broken. Embedded inline on workouts that
 * produced one or more breaks so the workout list/detail UIs can
 * badge sessions inline without a second round trip.
 */
export type PersonalRecordEvent = {
  id: string;
  exercise_id: string;
  workout_id: string;
  weight: number;
  reps: number;
  unit: "lb" | "kg";
  // null when this was the user's first logged set on this exercise.
  previous_weight: number | null;
  previous_reps: number | null;
  previous_unit: "lb" | "kg" | null;
  achieved_at: string;
};

/**
 * A logged training session.
 *
 * Since the unified-activity-model migration this shape is
 * produced by `activityToWorkout` from the unified `/activities` DTO for
 * the list/detail/create/update paths. `user_id`/`updated_at` are optional
 * because the unified DTO doesn't carry them (no surface consumes them);
 * the workout-TCX endpoints still return the legacy DTO, which does.
 */
export type Workout = {
  id: string;
  user_id?: string;
  name?: string;
  performed_at: string; // RFC3339
  ended_at?: string | null;
  notes?: string;
  exercises: WorkoutExercise[];
  created_at: string;
  updated_at?: string;
  // PR break events this workout produced. Always present in API
  // responses (empty array when no PRs); the field is non-optional so
  // UIs can iterate without a null check.
  personal_records_set: PersonalRecordEvent[];
};

/** A catalog entry — the canonical definition of an exercise. */
export type Exercise = {
  id: string; // slug
  name: string;
  description?: string;
  muscle_groups: string[];
  equipment: string[];
};

// --- Workout compat adapters (legacy surface over /activities) -----
//
// Every fetcher in this group is a thin compat adapter over the unified
// /activities surface: same exported name and consumer-facing shape as the
// old /workouts fetchers, implemented via listActivities/getActivity/
// createActivity/updateActivity/deleteActivity + activityToWorkout.
// PREFER THE UNIFIED FETCHERS FOR NEW CODE — these wrappers exist so the
// existing workout surfaces didn't have to migrate types in the
// unified-activity-model migration, and they're slated for removal once
// those surfaces consume Activity directly.

/**
 * Optional filters and pagination params for the workouts list. Mirrors
 * `ListActivitiesOptions` minus the type (fixed to strength_training):
 * two mutually exclusive query patterns — cursor (`limit`/`before`) or
 * range (`since`/`until`) — because the unified `/activities` endpoint
 * forbids mixing them. The prior offset pagination is gone with the
 * legacy `/workouts` shim.
 */
export type ListWorkoutsOptions = {
  // RFC3339 lower/upper bounds on performed_at (range form, uncapped).
  since?: string;
  until?: string;
  // Cursor form: page size (1–100, API default 50) + a prior page's
  // `next_before`.
  limit?: number;
  before?: string;
};

/**
 * One page of workouts plus the keyset cursor for the next page —
 * the unified list's pagination model. `next_before` is null on the
 * last page (and always null in the range form).
 */
export type WorkoutsPage = {
  items: Workout[];
  next_before: string | null;
};

/**
 * Compat adapter (prefer `listActivities` for new code). Lists the authed
 * user's strength sessions, most recent first, via
 * `GET /activities?type=strength_training` — the unified replacement for
 * the deprecated `GET /workouts` shim. Each unified item's strength
 * `details` (exercises + personal_records_set, embedded per item by the
 * API's bulk loader) is adapted onto the legacy `Workout` shape so
 * consumers render unchanged.
 */
export async function listWorkouts(
  token: string,
  options: ListWorkoutsOptions = {},
): Promise<WorkoutsPage> {
  const page = await listActivities(token, { ...options, type: "strength_training" });
  return {
    items: page.activities.map(activityToWorkout),
    next_before: page.next_before,
  };
}

/**
 * GET /exercises. Public — no token. Returns the shared, admin-curated
 * catalog. Used by the workouts page to map exercise_id slugs to
 * human names.
 */
export async function listExercises(): Promise<Exercise[]> {
  const resp = await fetch(`${config.apiUrl}/exercises`);
  return unwrap<Exercise[]>(resp, []);
}

/**
 * Compat adapter (prefer `getActivity` for new code). Fetches a single
 * strength session via `GET /activities/{id}` (the unified replacement
 * for `GET /workouts/{id}`) and adapts it onto the legacy `Workout`
 * shape — exercises + personal_records_set from the strength `details`.
 * 404s and non-strength ids both surface as "workout not found"
 * (deliberately indistinguishable, matching the legacy endpoint).
 */
export async function getWorkout(token: string, id: string): Promise<Workout> {
  let activity: Activity;
  try {
    activity = await getActivity(token, id);
  } catch (err) {
    if (err instanceof Error && err.message === "activity not found") {
      throw new Error("workout not found");
    }
    throw err;
  }
  if (activity.activity_type !== "strength_training") {
    throw new Error("workout not found");
  }
  return activityToWorkout(activity);
}

/**
 * One row of the Personal Records page — a headline lift plus the
 * user's current PR for it (nullable if never set) and the current
 * recency-weighted estimated 1RM for comparison.
 *
 * The set of headline lifts is curated server-side, so this response
 * always returns one row per headline lift even for lifts the user
 * has never trained. The frontend renders empty-state cards for those.
 */
export type PersonalRecord = {
  exercise_id: string;
  exercise_name: string;
  workout_id: string | null;
  weight: number | null;
  reps: number | null;
  unit: "lb" | "kg" | null;
  achieved_at: string | null;
  current_estimated_1rm: number | null;
  estimated_1rm_unit: "lb" | "kg" | null;
};

/**
 * GET /personal-records. Returns one row per backend-curated headline
 * lift; entries the user hasn't yet PR'd appear with null PR fields.
 */
export async function listPersonalRecords(token: string): Promise<PersonalRecord[]> {
  const resp = await fetch(`${config.apiUrl}/personal-records`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrap<PersonalRecord[]>(resp, []);
}

/**
 * One entry in the user's headline-exercise selection — the per-user
 * curated set of exercises surfaced on the Personal Records page.
 * `is_default` indicates whether the slug is also in the global
 * curated default list, so the modal can show "(default)" annotations
 * without a second fetch. See
 * prog-strength-docs/sows/custom-headline-lifts.md.
 */
export type HeadlineExercise = {
  exercise_id: string;
  exercise_name: string;
  position: number;
  is_default: boolean;
};

/** One entry in the curated default headline-exercise list. */
export type DefaultHeadlineExercise = {
  exercise_id: string;
  exercise_name: string;
};

/**
 * GET /me/headline-exercises. Returns the authed user's selection in
 * display order; falls back server-side to the curated defaults when
 * the user has no rows yet. Used by the customize modal to pre-check
 * the right boxes when it opens.
 */
export async function listMyHeadlineExercises(token: string): Promise<HeadlineExercise[]> {
  const resp = await fetch(`${config.apiUrl}/me/headline-exercises`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrap<HeadlineExercise[]>(resp, []);
}

/**
 * PUT /me/headline-exercises. Replaces the user's selection wholesale
 * — the body is the complete ordered set, not a partial diff. The
 * server returns the saved list in the same shape as the GET so the
 * caller can splice it back into local state without a refetch.
 *
 * Server-side validation: at least one slug, at most 12, no
 * duplicates, every slug must exist in the exercise catalog. Failures
 * surface as the API's standard `error` envelope; we throw with that
 * message so callers can render it inline in the modal.
 */
export async function putMyHeadlineExercises(
  token: string,
  exerciseIDs: string[],
): Promise<HeadlineExercise[]> {
  const resp = await fetch(`${config.apiUrl}/me/headline-exercises`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ exercise_ids: exerciseIDs }),
  });
  return unwrap<HeadlineExercise[]>(resp, []);
}

/**
 * GET /headline-exercises/defaults. Returns the curated default list
 * — the same one new users land on before they customize. The modal
 * uses this to annotate "(default)" badges across the full exercise
 * catalog and to implement "Reset to defaults" without baking slugs
 * into the frontend.
 */
export async function listHeadlineExerciseDefaults(
  token: string,
): Promise<DefaultHeadlineExercise[]> {
  const resp = await fetch(`${config.apiUrl}/headline-exercises/defaults`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrap<DefaultHeadlineExercise[]>(resp, []);
}

/**
 * Two endpoints of a least-squares trendline, evaluated at the query's
 * `since` and `until`. The frontend connects them with a straight line;
 * the regression math lives on the server.
 */
export type Trendline = {
  start_at: string;
  start_value: number;
  end_at: string;
  end_value: number;
};

/**
 * One (workout, exercise) contribution to the muscle-group progression
 * chart. `normalized_max` is the field plotted on the Y-axis — the
 * exercise's per-workout MAX estimated 1RM divided by that exercise's
 * current recency-weighted baseline. 1.0 means the lifter's heaviest
 * set today matched their current capability on that exercise; >1.0
 * above, <1.0 below. Max (not avg) is used so warmup sets don't
 * deflate the signal; the raw fields are carried for tooltips so the
 * UI can show absolute load alongside the normalized percentage.
 */
export type MuscleGroupProgressionPoint = {
  workout_id: string;
  exercise_id: string;
  exercise_name: string;
  performed_at: string; // RFC3339
  normalized_max: number;
  avg_estimated_1rm: number;
  max_estimated_1rm: number;
  min_estimated_1rm: number;
  set_count: number;
  unit: "lb" | "kg";
};

/**
 * Per-exercise baseline used to normalize one exercise's contributions
 * to the chart. Sorted by `exercise_name` server-side for stable
 * rendering in legend/tooltip layouts.
 */
export type ExerciseBaseline = {
  exercise_id: string;
  exercise_name: string;
  baseline: number;
  unit: "lb" | "kg" | "";
};

/** Echo of the progression request, with the server-resolved muscle groups. */
export type ProgressionFilterInfo = {
  movement_pattern?: string;
  // Legacy single-muscle-group filter; unused by the modern flow.
  muscle_group?: string;
  muscle_groups_included: string[];
};

/** Least-squares trend for one exercise within the query window. */
export type PerExerciseTrend = {
  exercise_id: string;
  session_count: number;
  // %/month; null when below the session threshold or degenerate.
  slope_per_month: number | null;
  trendline: Trendline | null;
};

/**
 * Defensible aggregate stats built on top of the per-exercise slopes.
 * `min_sessions_threshold` is surfaced so the UI's "not enough data"
 * copy isn't hard-coded. `median_slope_per_month` is null when no
 * exercise clears the session threshold.
 */
export type ProgressionAggregate = {
  lifts_tracked: number;
  lifts_progressing: number;
  median_slope_per_month: number | null;
  min_sessions_threshold: number;
};

/**
 * GET /workouts/progression response. Driven by the `movement_pattern`
 * query parameter; the backend resolves the pattern to muscle groups
 * (echoed in filter.muscle_groups_included), normalizes each exercise
 * against its own recency-weighted baseline, and returns per-exercise
 * trends + aggregate stats ready to plot.
 *
 * `baseline_model` is the discriminator the UI uses to label what
 * "100%" means (today: "recency_weighted_current"). The single
 * cross-exercise top-level trendline of the prior shape is gone — the
 * trend layer is now per-exercise. See
 * prog-strength-docs/sows/progress-page-modernization.md.
 */
export type MuscleGroupProgression = {
  filter: ProgressionFilterInfo;
  since: string;
  until: string;
  baseline_model: string; // e.g. "recency_weighted_current"
  exercise_baselines: ExerciseBaseline[];
  points: MuscleGroupProgressionPoint[];
  per_exercise_trends: PerExerciseTrend[];
  aggregate: ProgressionAggregate | null;
};

export type MovementPattern = "push" | "pull" | "legs" | "core" | "all";

/**
 * GET /activities/progression?movement_pattern=…&since=…&until=… (the
 * progression endpoint's canonical unified path; response shape unchanged
 * from its /workouts/progression days). The server resolves the pattern
 * to muscle groups (echoed in filter.muscle_groups_included). since/until
 * default to 90d server-side.
 */
export async function listProgression(
  token: string,
  movementPattern: MovementPattern,
  since?: string,
  until?: string,
): Promise<MuscleGroupProgression> {
  const params = new URLSearchParams({ movement_pattern: movementPattern });
  if (since) params.set("since", since);
  if (until) params.set("until", until);
  const resp = await fetch(`${config.apiUrl}/activities/progression?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // Force a non-null default — empty progression rather than throwing
  // on missing payload, so callers can render a clean empty state.
  const got = await unwrap<MuscleGroupProgression | null>(resp, null);
  return (
    got ?? {
      filter: { movement_pattern: movementPattern, muscle_groups_included: [] },
      since: since ?? "",
      until: until ?? "",
      baseline_model: "recency_weighted_current",
      exercise_baselines: [],
      points: [],
      per_exercise_trends: [],
      aggregate: null,
    }
  );
}

/**
 * Payload shape for create/update. Matches the Go handler's
 * createWorkoutRequest (which the PUT handler also accepts).
 * Timestamps are RFC3339 strings; the caller is responsible for
 * converting datetime-local form values before calling this.
 */
export type WorkoutPayload = {
  name?: string;
  performed_at: string; // RFC3339, required by the API
  ended_at?: string; // RFC3339, optional
  notes?: string;
  exercises: {
    exercise_id: string;
    superset_group?: number | null;
    notes?: string;
    sets: WorkoutSet[];
  }[];
};

/**
 * Compat adapter (prefer `deleteActivity` for new code — this is a bare
 * delegation). Soft-deletes a strength session via
 * `DELETE /activities/{id}` (204; subsequent reads treat the row as
 * gone). Throws the API's `error` envelope on non-2xx — typically a 404
 * if the ID doesn't exist or isn't owned by this user.
 */
export async function deleteWorkout(token: string, id: string): Promise<void> {
  return deleteActivity(token, id);
}

/**
 * Maps the legacy WorkoutPayload (what every edit surface builds) onto the
 * unified create/update body: performed_at → start_time, ended_at →
 * duration_seconds, exercises → the strength `details` blob. The API
 * re-derives ended_at as start_time + duration on read. This is the WRITE
 * direction of the compat seam; `activityToWorkout` (in the unified
 * section below) is the READ direction.
 */
function workoutPayloadToActivityPayload(payload: WorkoutPayload): ActivityPayload {
  const body: ActivityPayload = {
    activity_type: "strength_training",
    start_time: payload.performed_at,
    details: { exercises: payload.exercises },
  };
  if (payload.ended_at) {
    body.duration_seconds = Math.round(
      (new Date(payload.ended_at).getTime() - new Date(payload.performed_at).getTime()) / 1000,
    );
  }
  if (payload.name) body.name = payload.name;
  if (payload.notes) body.notes = payload.notes;
  return body;
}

/**
 * Compat adapter (prefer `createActivity` for new code). Creates a
 * strength session via the typed `POST /activities`. Returns
 * the created Workout (including any personal_records_set the save
 * triggered — the unified response embeds them in the strength details)
 * so the caller can route to it and surface PRs without a follow-up
 * fetch. Throws the API's `error` envelope on non-2xx.
 */
export async function createWorkout(token: string, payload: WorkoutPayload): Promise<Workout> {
  const created = await createActivity(token, workoutPayloadToActivityPayload(payload));
  return activityToWorkout(created);
}

/**
 * Compat adapter (prefer `updateActivity` for new code). Full-replacement
 * update of a strength session via the typed `PUT /activities/{id}` —
 * same semantics as the legacy PUT /workouts/{id} (PRs recompute;
 * TCX-enrichment vitals survive). Returns the updated Workout so callers
 * can splice it into local state without a refetch.
 */
export async function updateWorkout(
  token: string,
  id: string,
  payload: WorkoutPayload,
): Promise<Workout> {
  const updated = await updateActivity(token, id, workoutPayloadToActivityPayload(payload));
  return activityToWorkout(updated);
}

// --- Nutrition (pantry + log) -------------------------------------

/**
 * One user-saved food entry. Macros are per serving; "5 eggs" is
 * represented as a log entry with quantity=5 against an item whose
 * serving_size=1 and serving_unit="egg". See
 * prog-strength-docs/sows/daily-nutrition-log.md.
 */
export type PantryItem = {
  id: string;
  name: string;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  serving_size: number;
  serving_unit: string;
  created_at: string;
  updated_at: string;
};

/** Payload for creating or updating a pantry item. */
export type PantryItemPayload = {
  name: string;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  serving_size: number;
  serving_unit: string;
};

/**
 * Which meal bucket a nutrition log entry rolls into on the
 * /nutrition UI. Hard enum mirrored on the API side; new values
 * require schema CHECK + handler changes there first.
 */
export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

/**
 * One consumption event. Macros are denormalized at log time so
 * historical totals are immutable under future pantry-item edits.
 * Earlier phases set only pantry_item_id; later work lifted that to
 * also support recipe_id, and the meal bucket landed alongside the
 * per-meal section UI.
 */
export type NutritionLogEntry = {
  id: string;
  consumed_at: string;
  pantry_item_id?: string | null;
  recipe_id?: string | null;
  custom_meal_name: string | null;
  quantity: number;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  meal: MealType;
  created_at: string;
};

/**
 * Payload for creating a log entry. Exactly one of `pantry_item_id`
 * and `recipe_id` must be set — server returns 400 otherwise. `meal`
 * is required.
 */
export type CreateLogEntryPayload = {
  pantry_item_id?: string;
  recipe_id?: string;
  quantity: number;
  meal: MealType;
  consumed_at?: string; // RFC3339; server defaults to now
};

/**
 * Payload for editing a log entry. Omit a field to leave it unchanged.
 * The `name`/`calories`/`protein_g`/`fat_g`/`carbs_g` fields are only
 * accepted for custom entries; the server rejects them for pantry- or
 * recipe-backed rows.
 */
export type UpdateLogEntryPayload = {
  quantity?: number;
  consumed_at?: string;
  meal?: MealType;
  name?: string;
  calories?: number;
  protein_g?: number;
  fat_g?: number;
  carbs_g?: number;
};

/** Per-day aggregate from GET /nutrition-log/daily. */
export type DailyMacros = {
  date: string; // YYYY-MM-DD user-local calendar date
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  entry_count: number;
};

export async function listPantryItems(token: string, query?: string): Promise<PantryItem[]> {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  const qs = params.toString();
  const resp = await fetch(`${config.apiUrl}/pantry-items${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrap<PantryItem[]>(resp, []);
}

export async function getPantryItem(token: string, id: string): Promise<PantryItem> {
  const resp = await fetch(`${config.apiUrl}/pantry-items/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const got = await unwrap<PantryItem | null>(resp, null);
  if (!got) throw new Error("pantry item not found");
  return got;
}

export async function createPantryItem(
  token: string,
  payload: PantryItemPayload,
): Promise<PantryItem> {
  const resp = await fetch(`${config.apiUrl}/pantry-items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const created = await unwrap<PantryItem | null>(resp, null);
  if (!created) throw new Error("API did not return the created pantry item");
  return created;
}

export async function updatePantryItem(
  token: string,
  id: string,
  payload: PantryItemPayload,
): Promise<PantryItem> {
  const resp = await fetch(`${config.apiUrl}/pantry-items/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const updated = await unwrap<PantryItem | null>(resp, null);
  if (!updated) throw new Error("API did not return the updated pantry item");
  return updated;
}

export async function deletePantryItem(token: string, id: string): Promise<void> {
  const resp = await fetch(`${config.apiUrl}/pantry-items/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    let detail: string;
    try {
      detail = (await resp.json())?.error ?? `HTTP ${resp.status}`;
    } catch {
      detail = `HTTP ${resp.status}`;
    }
    throw new Error(detail);
  }
}

/**
 * Date filter for the nutrition read endpoints. `timezone` is the IANA
 * name (e.g. "America/New_York") and is always sent; the server resolves
 * the user-local calendar day(s) against it. Provide either a single
 * `date` or an inclusive `startDate`/`endDate` range (all YYYY-MM-DD).
 */
export type NutritionDateQuery = {
  timezone: string;
  date?: string; // YYYY-MM-DD
  startDate?: string; // YYYY-MM-DD inclusive
  endDate?: string; // YYYY-MM-DD inclusive
};

function nutritionDateParams(query: NutritionDateQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set("timezone", query.timezone);
  if (query.date) params.set("date", query.date);
  if (query.startDate) params.set("start_date", query.startDate);
  if (query.endDate) params.set("end_date", query.endDate);
  return params;
}

/**
 * GET /nutrition-log. Filters `consumed_at` to the user-local calendar
 * day(s) named by `query` (resolved server-side against `timezone`).
 * Returns most-recent-first.
 */
export async function listNutritionLog(
  token: string,
  query: NutritionDateQuery,
): Promise<NutritionLogEntry[]> {
  const qs = nutritionDateParams(query).toString();
  const resp = await fetch(`${config.apiUrl}/nutrition-log${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrap<NutritionLogEntry[]>(resp, []);
}

export async function createNutritionLogEntry(
  token: string,
  payload: CreateLogEntryPayload,
): Promise<NutritionLogEntry> {
  const resp = await fetch(`${config.apiUrl}/nutrition-log`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const created = await unwrap<NutritionLogEntry | null>(resp, null);
  if (!created) throw new Error("API did not return the created log entry");
  return created;
}

/**
 * Payload for creating a custom (one-off) log entry — a meal the user
 * typed in directly, not backed by a saved pantry item or recipe. The
 * macros are the totals as consumed (quantity is always 1 server-side).
 */
export type CreateCustomLogEntryPayload = {
  name: string;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  meal: MealType;
  consumed_at?: string; // RFC3339; server defaults to now
};

/**
 * POST /nutrition-log/custom — a one-off meal with typed macros, no pantry item.
 * Mirrors `createNutritionLogEntry`'s fetch/unwrap pattern.
 */
export async function createCustomNutritionLogEntry(
  token: string,
  payload: CreateCustomLogEntryPayload,
): Promise<NutritionLogEntry> {
  const resp = await fetch(`${config.apiUrl}/nutrition-log/custom`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const created = await unwrap<NutritionLogEntry | null>(resp, null);
  if (!created) throw new Error("API did not return the created log entry");
  return created;
}

export async function updateNutritionLogEntry(
  token: string,
  id: string,
  payload: UpdateLogEntryPayload,
): Promise<NutritionLogEntry> {
  const resp = await fetch(`${config.apiUrl}/nutrition-log/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const updated = await unwrap<NutritionLogEntry | null>(resp, null);
  if (!updated) throw new Error("API did not return the updated log entry");
  return updated;
}

export async function deleteNutritionLogEntry(token: string, id: string): Promise<void> {
  const resp = await fetch(`${config.apiUrl}/nutrition-log/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    let detail: string;
    try {
      detail = (await resp.json())?.error ?? `HTTP ${resp.status}`;
    } catch {
      detail = `HTTP ${resp.status}`;
    }
    throw new Error(detail);
  }
}

/**
 * GET /nutrition-log/daily. Returns one row per user-local calendar
 * date (resolved server-side against `timezone`) in the requested range
 * that has at least one entry. Empty days are omitted; the frontend's
 * daily widget treats that as zeros.
 */
export async function getDailyMacros(
  token: string,
  query: NutritionDateQuery,
): Promise<DailyMacros[]> {
  const qs = nutritionDateParams(query).toString();
  const resp = await fetch(`${config.apiUrl}/nutrition-log/daily?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrap<DailyMacros[]>(resp, []);
}

// --- Macro goals --------------------------------------------------

/**
 * Per-user daily macro targets. created_at / updated_at are nullable
 * because the API returns a zero-valued row with null timestamps when
 * the user has never set goals — the empty-state ring renders off
 * `created_at === null`, not "every number is zero" (zero is a valid
 * cleared-target value). See
 * prog-strength-docs/sows/daily-macro-goals.md.
 */
export type MacroGoals = {
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  calories: number;
  created_at: string | null;
  updated_at: string | null;
};

/** Payload for PUT /me/macro-goals. All four fields required. */
export type PutMacroGoalsPayload = {
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  calories: number;
};

export async function getMacroGoals(token: string): Promise<MacroGoals> {
  const resp = await fetch(`${config.apiUrl}/me/macro-goals`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrap<MacroGoals>(resp, {
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    calories: 0,
    created_at: null,
    updated_at: null,
  });
}

export async function putMacroGoals(
  token: string,
  payload: PutMacroGoalsPayload,
): Promise<MacroGoals> {
  const resp = await fetch(`${config.apiUrl}/me/macro-goals`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return unwrap<MacroGoals>(resp, {
    ...payload,
    created_at: null,
    updated_at: null,
  });
}

// --- Bodyweight ---------------------------------------------------

/**
 * One scale reading. Unit is denormalized per row so a user changing
 * their preferred unit doesn't reinterpret history. See
 * prog-strength-docs/sows/daily-nutrition-log.md (Phase 3).
 */
export type BodyweightEntry = {
  id: string;
  weight: number;
  unit: "lb" | "kg";
  measured_at: string; // RFC3339
  created_at: string;
};

/** Payload for creating a bodyweight entry. */
export type CreateBodyweightPayload = {
  weight: number;
  unit?: "lb" | "kg"; // server defaults to the user's preferred unit
  measured_at?: string; // RFC3339; server defaults to now
};

export async function listBodyweight(
  token: string,
  options: { since?: string; until?: string } = {},
): Promise<BodyweightEntry[]> {
  const params = new URLSearchParams();
  if (options.since) params.set("since", options.since);
  if (options.until) params.set("until", options.until);
  const qs = params.toString();
  const resp = await fetch(`${config.apiUrl}/bodyweight${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrap<BodyweightEntry[]>(resp, []);
}

export async function createBodyweightEntry(
  token: string,
  payload: CreateBodyweightPayload,
): Promise<BodyweightEntry> {
  const resp = await fetch(`${config.apiUrl}/bodyweight`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const created = await unwrap<BodyweightEntry | null>(resp, null);
  if (!created) throw new Error("API did not return the created bodyweight entry");
  return created;
}

export async function deleteBodyweightEntry(token: string, id: string): Promise<void> {
  const resp = await fetch(`${config.apiUrl}/bodyweight/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    let detail: string;
    try {
      detail = (await resp.json())?.error ?? `HTTP ${resp.status}`;
    } catch {
      detail = `HTTP ${resp.status}`;
    }
    throw new Error(detail);
  }
}

/**
 * The user's bodyweight goal. created_at / updated_at are nullable
 * because the API returns a zero-valued row with null timestamps when
 * the user has never set a goal — the UI uses `weight === 0` / null
 * timestamps as the "no goal set" signal. Sibling: web lib/api.ts
 * BodyweightGoal.
 */
export type BodyweightGoal = {
  weight: number;
  unit: "lb" | "kg";
  created_at: string | null;
  updated_at: string | null;
};

/**
 * GET /me/bodyweight-goal — always 200. When no goal has been set the
 * response carries weight=0 and null timestamps; callers should treat
 * `weight === 0` as "unset" rather than a real target.
 */
export async function getBodyweightGoal(token: string): Promise<BodyweightGoal> {
  const resp = await fetch(`${config.apiUrl}/me/bodyweight-goal`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrap<BodyweightGoal>(resp, {
    weight: 0,
    unit: "lb",
    created_at: null,
    updated_at: null,
  });
}

/** PUT /me/bodyweight-goal. Set-replacement; returns the persisted row. */
export async function putBodyweightGoal(
  token: string,
  goal: { weight: number; unit: "lb" | "kg" },
): Promise<BodyweightGoal> {
  const resp = await fetch(`${config.apiUrl}/me/bodyweight-goal`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(goal),
  });
  const saved = await unwrap<BodyweightGoal | null>(resp, null);
  if (!saved) throw new Error("API did not return the saved bodyweight goal");
  return saved;
}

/** PUT /bodyweight/{id}. Partial update — omit fields to leave them unchanged. */
export async function updateBodyweightEntry(
  token: string,
  id: string,
  payload: { weight?: number; unit?: "lb" | "kg"; measured_at?: string },
): Promise<BodyweightEntry> {
  const resp = await fetch(`${config.apiUrl}/bodyweight/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const updated = await unwrap<BodyweightEntry | null>(resp, null);
  if (!updated) throw new Error("API did not return the updated bodyweight entry");
  return updated;
}

// --- Steps --------------------------------------------------------

/**
 * One day's step count. Date-keyed (one row per calendar day) rather
 * than timestamped like bodyweight — the API upserts on the `date`
 * path segment. Sibling: prog-strength-web lib/api.ts StepsEntry. See
 * prog-strength-docs/sows/daily-steps-logging.md.
 */
export type StepsEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  steps: number;
  created_at: string;
  updated_at: string;
};

/**
 * GET /steps response. Newest-first. Range mode (since/until) and
 * keyset mode (limit/before) mirror listRunningSessions — `next_before`
 * is the YYYY-MM-DD cursor for the next page (null when exhausted).
 */
export type StepsPage = {
  steps: StepsEntry[];
  next_before: string | null;
};

/**
 * The user's daily-steps goal. Mirrors BodyweightGoal's "unset" shape:
 * GET returns goal=0 with null timestamps when no goal has been set, so
 * callers treat `goal === 0` as "no target yet".
 */
export type StepsGoal = {
  goal: number;
  created_at: string | null;
  updated_at: string | null;
};

/**
 * GET /steps. Range mode (since/until, YYYY-MM-DD inclusive) and keyset
 * mode (limit + before=YYYY-MM-DD) are mutually exclusive — the API
 * rejects mixing them. Returns newest-first.
 */
export async function listSteps(
  token: string,
  opts: { since?: string; until?: string; limit?: number; before?: string } = {},
): Promise<StepsPage> {
  const params = new URLSearchParams();
  if (opts.since) params.set("since", opts.since);
  if (opts.until) params.set("until", opts.until);
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.before) params.set("before", opts.before);
  const qs = params.toString();
  const resp = await fetch(`${config.apiUrl}/steps${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrap<StepsPage>(resp, { steps: [], next_before: null });
}

/** PUT /steps/{date} — upsert the step count for a calendar day. */
export async function upsertStepsForDate(
  token: string,
  date: string,
  steps: number,
): Promise<StepsEntry> {
  const resp = await fetch(`${config.apiUrl}/steps/${encodeURIComponent(date)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ steps }),
  });
  const saved = await unwrap<StepsEntry | null>(resp, null);
  if (!saved) throw new Error("API did not return the saved steps entry");
  return saved;
}

/** DELETE /steps/{date} → 204. Throws on non-ok (mirrors deleteBodyweightEntry). */
export async function deleteStepsForDate(token: string, date: string): Promise<void> {
  const resp = await fetch(`${config.apiUrl}/steps/${encodeURIComponent(date)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    let detail: string;
    try {
      detail = (await resp.json())?.error ?? `HTTP ${resp.status}`;
    } catch {
      detail = `HTTP ${resp.status}`;
    }
    throw new Error(detail);
  }
}

/**
 * GET /me/steps-goal — always 200. When no goal has been set the
 * response carries goal=0 and null timestamps; callers should treat
 * `goal === 0` as "unset" rather than a real target.
 */
export async function getStepsGoal(token: string): Promise<StepsGoal> {
  const resp = await fetch(`${config.apiUrl}/me/steps-goal`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrap<StepsGoal>(resp, { goal: 0, created_at: null, updated_at: null });
}

/** PUT /me/steps-goal. Set-replacement; returns the persisted row. */
export async function putStepsGoal(token: string, payload: { goal: number }): Promise<StepsGoal> {
  const resp = await fetch(`${config.apiUrl}/me/steps-goal`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const saved = await unwrap<StepsGoal | null>(resp, null);
  if (!saved) throw new Error("API did not return the saved steps goal");
  return saved;
}

// --- Recipes ------------------------------------------------------

/**
 * One pantry-item component inside a recipe. Quantity is the number
 * of pantry-item servings in one batch of the recipe.
 */
export type RecipeComponent = {
  id: string;
  pantry_item_id: string;
  quantity: number;
  position: number;
};

/** Derived macros for one batch of a recipe. */
export type RecipeMacros = {
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
};

/**
 * A user-saved recipe — a named bag of pantry-item components with
 * derived macros for one batch. Recipe macros are NOT stored on the
 * recipe row; the API computes them on every read by joining
 * `recipe_items` to `pantry_items`. This means editing a component
 * pantry item updates the recipe's apparent macros — but log entries
 * already created against the recipe stay frozen at their original
 * macros (denormalized at log time).
 */
export type Recipe = {
  id: string;
  name: string;
  components: RecipeComponent[];
  macros: RecipeMacros;
  created_at: string;
  updated_at: string;
};

/** Payload for creating or updating a recipe. */
export type RecipePayload = {
  name: string;
  components: { pantry_item_id: string; quantity: number }[];
};

export async function listRecipes(token: string): Promise<Recipe[]> {
  const resp = await fetch(`${config.apiUrl}/recipes`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrap<Recipe[]>(resp, []);
}

export async function getRecipe(token: string, id: string): Promise<Recipe> {
  const resp = await fetch(`${config.apiUrl}/recipes/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const got = await unwrap<Recipe | null>(resp, null);
  if (!got) throw new Error("recipe not found");
  return got;
}

export async function createRecipe(token: string, payload: RecipePayload): Promise<Recipe> {
  const resp = await fetch(`${config.apiUrl}/recipes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const created = await unwrap<Recipe | null>(resp, null);
  if (!created) throw new Error("API did not return the created recipe");
  return created;
}

export async function updateRecipe(
  token: string,
  id: string,
  payload: RecipePayload,
): Promise<Recipe> {
  const resp = await fetch(`${config.apiUrl}/recipes/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const updated = await unwrap<Recipe | null>(resp, null);
  if (!updated) throw new Error("API did not return the updated recipe");
  return updated;
}

export async function deleteRecipe(token: string, id: string): Promise<void> {
  const resp = await fetch(`${config.apiUrl}/recipes/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    let detail: string;
    try {
      detail = (await resp.json())?.error ?? `HTTP ${resp.status}`;
    } catch {
      detail = `HTTP ${resp.status}`;
    }
    throw new Error(detail);
  }
}

// --- Chat sessions -----------------------------------------------

/**
 * A block in a multimodal chat turn. Text-only turns send a plain
 * string; a turn carrying a photo sends ContentBlock[] (image first,
 * then text). The agent /chat accepts `content: string | ContentBlock[]`.
 * Image bytes never persist — the stored record uses the
 * "[image attached] …" placeholder. Sibling: web lib/agent.ts.
 */
export type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: "image/jpeg" | "image/png" | "image/webp";
        data: string;
      };
    };

/**
 * One persistent chat conversation. The API returns these from
 * /chat-sessions list/get endpoints. The companion `messages` array
 * is only present on the per-id GET (and after POST on
 * /chat-sessions/{id}/messages).
 */
export type ChatSession = {
  id: string;
  user_id: string;
  title: string; // empty until the LLM-title PATCH lands
  created_at: string;
  updated_at: string;
  last_message_at: string;
};

export type ChatSessionListItem = ChatSession & {
  message_count: number;
};

export type ChatMessage = {
  id: number;
  session_id: string;
  position: number;
  role: "user" | "assistant";
  content: string;
  model?: string | null;
  tools_json?: string | null;
  created_at: string;
};

export type ChatSessionWithMessages = ChatSession & {
  messages: ChatMessage[];
};

/** Payload for appending one turn to a session. */
export type ChatTurnPayload = {
  user: { content: string };
  assistant: {
    content: string;
    model?: string;
    tools_json?: string;
  };
};

export async function listChatSessions(token: string): Promise<ChatSessionListItem[]> {
  const resp = await fetch(`${config.apiUrl}/chat-sessions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrap<ChatSessionListItem[]>(resp, []);
}

export async function createChatSession(token: string, id: string): Promise<ChatSession> {
  const resp = await fetch(`${config.apiUrl}/chat-sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ id }),
  });
  const created = await unwrap<ChatSession | null>(resp, null);
  if (!created) throw new Error("API did not return the created chat session");
  return created;
}

export async function getChatSession(token: string, id: string): Promise<ChatSessionWithMessages> {
  const resp = await fetch(`${config.apiUrl}/chat-sessions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const got = await unwrap<ChatSessionWithMessages | null>(resp, null);
  if (!got) throw new Error("chat session not found");
  return got;
}

/**
 * Update the session's title. Server validates 1..80 chars after
 * trimming; on invalid input the unwrap throws with the API's
 * "title must be 1–80 characters" error message.
 */
export async function patchChatSessionTitle(
  token: string,
  id: string,
  title: string,
): Promise<ChatSession> {
  const resp = await fetch(`${config.apiUrl}/chat-sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ title }),
  });
  const updated = await unwrap<ChatSession | null>(resp, null);
  if (!updated) throw new Error("API did not return the updated chat session");
  return updated;
}

export async function deleteChatSession(token: string, id: string): Promise<void> {
  const resp = await fetch(`${config.apiUrl}/chat-sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    let detail: string;
    try {
      detail = (await resp.json())?.error ?? `HTTP ${resp.status}`;
    } catch {
      detail = `HTTP ${resp.status}`;
    }
    throw new Error(detail);
  }
}

/**
 * Append one turn (user + assistant) to a session in a single
 * transaction server-side. The response includes the updated session
 * (with bumped last_message_at) and the two newly-created message
 * rows.
 */
export async function appendChatTurn(
  token: string,
  sessionId: string,
  turn: ChatTurnPayload,
): Promise<ChatSessionWithMessages> {
  const resp = await fetch(
    `${config.apiUrl}/chat-sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(turn),
    },
  );
  const appended = await unwrap<ChatSessionWithMessages | null>(resp, null);
  if (!appended) throw new Error("API did not return the appended turn");
  return appended;
}

/**
 * Common envelope unwrapper. The API wraps every success response in
 * `{service, message, data}`; the caller only cares about `data`.
 * Errors come back as `{service, error}` — we surface `error` as the
 * thrown message so callers don't have to repeat the envelope parsing.
 *
 * The `empty` parameter is the value to return when `data` is missing
 * or null (typically `[]` for list endpoints, since the server uses
 * `omitempty` on the envelope field).
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

// --- Profile + usage (/me) ---------------------------------------

/**
 * The resolved profile returned by the four /me profile endpoints
 * (GET/PATCH /me, POST/DELETE /me/avatar). `avatar_url` is resolved
 * server-side (presigned S3 GET, OAuth fallback, or null); `height_cm`
 * is the canonical centimeter value. Sibling: prog-strength-web
 * lib/api.ts ResolvedProfile.
 */
export type ResolvedProfile = {
  id: string;
  email: string;
  display_name: string;
  weight_unit: "lb" | "kg";
  distance_unit: "mi" | "km";
  height_cm: number | null;
  avatar_url: string | null;
  // The user's chosen handle (the `/u/{username}` profile slug), or null when
  // they haven't set one yet. Editable via PATCH /me; see `updateMe`.
  username: string | null;
};

/** Partial profile update for PATCH /me; omit a field to leave it unchanged. */
export type ProfilePatch = {
  display_name?: string;
  // Canonical centimeters; pass `null` to clear a previously-set height.
  height_cm?: number | null;
  weight_unit?: "lb" | "kg";
  distance_unit?: "mi" | "km";
  username?: string;
};

/**
 * GET /me. Returns the resolved profile — preferences plus `height_cm`
 * and a server-resolved `avatar_url`; seeds the profile context and
 * unit-aware displays. Throws if the response carries no user payload.
 */
export async function getMe(token: string): Promise<ResolvedProfile> {
  const resp = await fetch(`${config.apiUrl}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const got = await unwrap<ResolvedProfile | null>(resp, null);
  if (!got) throw new Error("user not found");
  return got;
}

/** PATCH /me. Returns the updated profile so callers can re-seed state. */
export async function updateMe(token: string, patch: ProfilePatch): Promise<ResolvedProfile> {
  const resp = await fetch(`${config.apiUrl}/me`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(patch),
  });
  const updated = await unwrap<ResolvedProfile | null>(resp, null);
  if (!updated) throw new Error("API did not return the updated user");
  return updated;
}

/**
 * A local image picked for avatar upload. RN's FormData takes a
 * {uri, name, type} part instead of a browser File — this is the
 * deliberate divergence from the web twin.
 */
export type PickedImage = {
  uri: string;
  // e.g. "image/jpeg" — the server accepts image/png, image/jpeg,
  // image/webp and enforces the 2 MB cap authoritatively.
  mimeType: string;
  fileName: string;
};

/**
 * POST /me/avatar as multipart/form-data under the field `file`.
 * No Content-Type header — fetch fills in `multipart/form-data;
 * boundary=...` itself; setting it manually would omit the boundary
 * and break server-side parsing. Same rule as the web twin.
 */
export async function uploadAvatar(token: string, image: PickedImage): Promise<ResolvedProfile> {
  const form = new FormData();
  form.append("file", {
    uri: image.uri,
    name: image.fileName,
    type: image.mimeType,
  } as unknown as Blob);
  const resp = await fetch(`${config.apiUrl}/me/avatar`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const updated = await unwrap<ResolvedProfile | null>(resp, null);
  if (!updated) throw new Error("API did not return the updated profile");
  return updated;
}

/** DELETE /me/avatar. avatar_url falls back to the OAuth photo or null. */
export async function deleteAvatar(token: string): Promise<ResolvedProfile> {
  const resp = await fetch(`${config.apiUrl}/me/avatar`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  const updated = await unwrap<ResolvedProfile | null>(resp, null);
  if (!updated) throw new Error("API did not return the updated profile");
  return updated;
}

/**
 * The authed user's daily AI-usage snapshot. Percent only — the API
 * deliberately omits dollar figures. `capped` gates the chat composer;
 * `resets_at` (RFC3339) is the user's next local midnight.
 */
export type UsageData = {
  percent_used: number;
  capped: boolean;
  resets_at: string;
};

/** GET /me/usage. `tz` is the user's IANA timezone for rollover anchoring. */
export async function getMyUsage(token: string, tz: string): Promise<UsageData> {
  const resp = await fetch(`${config.apiUrl}/me/usage?tz=${encodeURIComponent(tz)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrap<UsageData>(resp, {
    percent_used: 0,
    capped: false,
    resets_at: "",
  });
}

// --- Running activities -------------------------------------------

/**
 * Sport-agnostic activity type stored on every API row. `strength_training`
 * is included because the unified-activity-model migration makes
 * `GET /activities` return every activity type, not just endurance ones —
 * the type needs the literal so call sites can filter it out under `strict`
 * without a same-type-required-for-comparison tsc error. Strength rows are
 * rendered through the legacy `Workout` domain (via `activityToWorkout`),
 * not this endurance one; see `listRunningSessions` below for the guard.
 */
export type ActivityType = "running" | "walking" | "cycling" | "other" | "strength_training";

/**
 * How an activity entered the system. `manual` covers rows written by the
 * unified manual create surface (every strength session logged in-app);
 * the TCX/Garmin values cover imported endurance rows and TCX-enriched
 * lifts.
 */
export type IngestSource = "manual" | "manual_tcx" | "garmin_api";

export type RunningSession = {
  id: string;
  activity_type: ActivityType;
  ingest_source: IngestSource;
  source_activity_id: string;
  name: string | null;
  start_time: string; // RFC3339
  distance_meters: number;
  duration_seconds: number;
  avg_pace_sec_per_km: number | null;
  best_pace_sec_per_km: number | null;
  avg_heart_rate_bpm: number | null;
  max_heart_rate_bpm: number | null;
  total_calories: number | null;
  elevation_gain_meters: number | null;
  created_at: string;
  // Present on detail GET only.
  trackpoints?: RunningTrackpoint[];
};

export type RunningTrackpoint = {
  sequence: number;
  elapsed_seconds: number;
  distance_meters: number;
  heart_rate_bpm: number | null;
  pace_sec_per_km: number | null;
  elevation_meters: number | null;
};

export type RunningSessionsPage = {
  activities: RunningSession[];
  next_before: string | null;
};

export type RunningMetrics = {
  current_week: {
    distance_meters: number;
    run_count: number;
    delta_pct_vs_prior_week: number | null;
  };
  current_month: { distance_meters: number; run_count: number };
  recent_avg_pace_sec_per_km: number | null;
  all_time: { distance_meters: number; run_count: number };
};

// --- Unified /activities surface -----------------------------------
//
// The one typed surface over every activity type (SOW: unified-activity-
// model). `Activity` mirrors the Go unifiedReadDTO: the base-row fields
// (which `RunningSession` above already models — that type stays as the
// endurance-detail view of the same wire shape) plus the registry-driven
// `summary` card and the type-keyed `details` payload. The workout compat
// adapters bridge in both directions: `activityToWorkout` (below) reads a
// unified strength row back into the legacy `Workout` shape, and
// `workoutPayloadToActivityPayload` (beside createWorkout above) writes a
// legacy WorkoutPayload as a typed /activities body — so components keep
// their types.

/** The registry-rendered card for a list row: title, subtitle, metric chips. */
export type ActivitySummary = {
  title: string;
  subtitle: string;
  metrics: string[];
};

/**
 * The strength `details` payload: the session's exercises plus the PR
 * break events it produced, in the exact legacy /workouts DTO shape
 * (`personal_records_set` is never null — [] when no PRs). Embedded on
 * detail reads AND per-item on list responses (the API bulk-loads them).
 * `exercises` serializes as null for a zero-exercise session (e.g. a
 * fresh TCX import awaiting its exercises) — `activityToWorkout`
 * normalizes it to [].
 */
export type StrengthActivityDetails = {
  exercises: WorkoutExercise[] | null;
  personal_records_set: PersonalRecordEvent[];
};

/**
 * The endurance `details` payload (activity_run_details etc. projected
 * through the endurance detail store). Detail reads only; the running
 * surfaces read these same fields off the flattened base DTO instead, so
 * no consumer needs this today — typed for completeness.
 */
export type EnduranceActivityDetails = {
  distance_meters: number;
  raw_distance_meters?: number;
  avg_pace_sec_per_km?: number;
  best_pace_sec_per_km?: number;
  elevation_gain_meters?: number;
  environment?: "outdoor" | "indoor";
  route_geojson?: string;
};

/**
 * One unified activity as GET /activities returns it. Structurally the
 * base DTO `RunningSession` already models (same wire fields — see the
 * comment above), plus `summary` and `details`. `details` is present on
 * detail reads and, for strength items, on list rows too; discriminate
 * with `"exercises" in details` (or `activity_type`).
 */
export type Activity = RunningSession & {
  summary?: ActivitySummary;
  details?: StrengthActivityDetails | EnduranceActivityDetails;
  // Free-text notes carried on the unified base DTO for every type. Not
  // modeled on mobile's leaner `RunningSession` (no run surface renders
  // it), so it's declared here — the strength adapter reads it onto
  // `Workout.notes`. Null when the session has none.
  notes?: string | null;
  // User-attached photos, in display order (`position`). Present on the
  // detail GET only; absent (not []) on list rows, which don't embed them.
  // Field names mirror web for cross-repo consistency. See the
  // ActivityPhoto CRUD fetchers below.
  photos?: ActivityPhoto[];
};

/**
 * One photo attached to an activity. `url` is a presigned full-size GET;
 * `thumb_url` a presigned thumbnail. `width`/`height` are the stored
 * full-size pixel dimensions (for aspect-ratio layout without a load).
 * `caption` is user text or null; `position` is the 0-based display order
 * within the activity. Kept field-for-field in sync with the web twin and
 * the API's ActivityPhoto DTO.
 */
export type ActivityPhoto = {
  id: string;
  url: string;
  thumb_url: string;
  width: number;
  height: number;
  caption: string | null;
  position: number;
};

/** One page of unified activities plus the keyset cursor for the next. */
export type ActivitiesPage = {
  activities: Activity[];
  next_before: string | null;
};

/**
 * Query params for GET /activities. Two mutually exclusive patterns:
 * cursor (`limit` + `before`) or range (`since` + `until`, half-open,
 * uncapped server-side). `type` narrows to one registered activity type.
 */
export type ListActivitiesOptions = {
  limit?: number;
  before?: string;
  since?: string;
  until?: string;
  type?: ActivityType;
};

/**
 * The typed POST/PUT /activities body: the base columns plus the
 * type-keyed `details` blob. Strength is the only type this client writes
 * through this surface today, so `details` is typed as its exercises list
 * (the same shape POST /workouts accepted; the API assigns order from
 * array position).
 */
export type ActivityPayload = {
  activity_type: ActivityType;
  start_time: string; // RFC3339
  duration_seconds?: number;
  name?: string;
  notes?: string;
  avg_heart_rate_bpm?: number;
  max_heart_rate_bpm?: number;
  total_calories?: number;
  details?: { exercises: WorkoutPayload["exercises"] };
};

/**
 * GET /activities. Returns one page of the authed user's activities of
 * every type, most recent first. The API forbids mixing the range params
 * with the cursor params, so when `since`/`until` are present the cursor
 * params are dropped here — the range form is uncapped server-side and
 * the window itself bounds the result.
 */
export async function listActivities(
  token: string,
  opts: ListActivitiesOptions = {},
): Promise<ActivitiesPage> {
  const params = new URLSearchParams();
  if (opts.type) params.set("type", opts.type);
  const range = Boolean(opts.since || opts.until);
  if (opts.since) params.set("since", opts.since);
  if (opts.until) params.set("until", opts.until);
  if (!range && opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (!range && opts.before) params.set("before", opts.before);
  const qs = params.toString();
  const resp = await fetch(`${config.apiUrl}/activities${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrap<ActivitiesPage>(resp, { activities: [], next_before: null });
}

/**
 * GET /activities/{id}. Returns a single activity of any type, including
 * detail-only blocks (trackpoints, strength/endurance `details`). 404s
 * surface as a thrown "activity not found". No `unit` param is threaded
 * (unlike web): the mobile client converts units at render time, so the
 * server-derived running blocks use their canonical units either way.
 */
export async function getActivity(token: string, id: string): Promise<Activity> {
  const resp = await fetch(`${config.apiUrl}/activities/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const got = await unwrap<Activity | null>(resp, null);
  if (!got) {
    throw new Error("activity not found");
  }
  return got;
}

/**
 * POST /activities/{id}/photos as multipart/form-data under the field
 * `photo`, with an optional `caption` text field. No Content-Type header —
 * fetch fills in `multipart/form-data; boundary=...` itself; setting it
 * manually would omit the boundary and break server-side parsing. Same RN
 * FormData rule as `uploadAvatar` (a {uri, name, type} part, not a browser
 * File). Returns the created photo (201).
 */
export async function uploadActivityPhoto(
  token: string,
  activityId: string,
  image: PickedImage,
  caption?: string,
): Promise<ActivityPhoto> {
  const form = new FormData();
  form.append("photo", {
    uri: image.uri,
    name: image.fileName,
    type: image.mimeType,
  } as unknown as Blob);
  if (caption !== undefined) form.append("caption", caption);
  const resp = await fetch(`${config.apiUrl}/activities/${encodeURIComponent(activityId)}/photos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const created = await unwrap<ActivityPhoto | null>(resp, null);
  if (!created) throw new Error("API did not return the created photo");
  return created;
}

/**
 * PATCH /activities/{id}/photos/{photo_id}. Sets (or clears, with null)
 * the photo's caption. Returns the updated photo.
 */
export async function updateActivityPhotoCaption(
  token: string,
  activityId: string,
  photoId: string,
  caption: string | null,
): Promise<ActivityPhoto> {
  const resp = await fetch(
    `${config.apiUrl}/activities/${encodeURIComponent(activityId)}/photos/${encodeURIComponent(
      photoId,
    )}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ caption }),
    },
  );
  const updated = await unwrap<ActivityPhoto | null>(resp, null);
  if (!updated) throw new Error("API did not return the updated photo");
  return updated;
}

/**
 * PUT /activities/{id}/photos/order. Reorders the activity's photos to
 * match `photoIds` (the complete set, in the desired order). Returns the
 * reordered list with updated `position` values.
 */
export async function reorderActivityPhotos(
  token: string,
  activityId: string,
  photoIds: string[],
): Promise<ActivityPhoto[]> {
  const resp = await fetch(
    `${config.apiUrl}/activities/${encodeURIComponent(activityId)}/photos/order`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ photo_ids: photoIds }),
    },
  );
  return unwrap<ActivityPhoto[]>(resp, []);
}

/**
 * DELETE /activities/{id}/photos/{photo_id} → 204. Throws the API's
 * `error` envelope on non-2xx (mirrors deleteActivity).
 */
export async function deleteActivityPhoto(
  token: string,
  activityId: string,
  photoId: string,
): Promise<void> {
  const resp = await fetch(
    `${config.apiUrl}/activities/${encodeURIComponent(activityId)}/photos/${encodeURIComponent(
      photoId,
    )}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!resp.ok) {
    let detail: string;
    try {
      detail = (await resp.json())?.error ?? `HTTP ${resp.status}`;
    } catch {
      detail = `HTTP ${resp.status}`;
    }
    throw new Error(detail);
  }
}

/**
 * POST /activities. Creates an activity through the typed unified
 * surface; the descriptor for `activity_type` owns validation and the
 * write path (strength routes through the workout machinery: PR
 * detection, 1RM history, timeline posts). Returns the created row in
 * the unified read shape — for strength, `details` embeds any PR events
 * the save produced.
 */
export async function createActivity(token: string, payload: ActivityPayload): Promise<Activity> {
  const resp = await fetch(`${config.apiUrl}/activities`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const created = await unwrap<Activity | null>(resp, null);
  if (!created) throw new Error("API did not return the created activity");
  return created;
}

/**
 * PUT /activities/{id}. Full-replacement typed update; the row's stored
 * type must match `activity_type` (a PUT can't change a session's type).
 * Returns the updated row in the unified read shape.
 */
export async function updateActivity(
  token: string,
  id: string,
  payload: ActivityPayload,
): Promise<Activity> {
  const resp = await fetch(`${config.apiUrl}/activities/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const updated = await unwrap<Activity | null>(resp, null);
  if (!updated) throw new Error("API did not return the updated activity");
  return updated;
}

/**
 * DELETE /activities/{id}. Soft-deletes any activity type (204, no
 * body); throws the API's `error` envelope on non-2xx.
 */
export async function deleteActivity(token: string, id: string): Promise<void> {
  const resp = await fetch(`${config.apiUrl}/activities/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    let detail: string;
    try {
      detail = (await resp.json())?.error ?? `HTTP ${resp.status}`;
    } catch {
      detail = `HTTP ${resp.status}`;
    }
    throw new Error(detail);
  }
}

/**
 * Adapts one unified strength activity onto the legacy `Workout` shape
 * every workout surface consumes:
 *
 * - `performed_at`/`ended_at` ← `start_time` + `duration_seconds` (the
 *   unified model stores duration; 0 means an end-less lift → null).
 * - `exercises`/`personal_records_set` ← the strength `details` payload
 *   (absent details — a base-only read — degrade to empty arrays).
 *
 * Twin divergence from web: mobile's `Workout` doesn't model TCX
 * enrichment (`activity_id`/`enrichment`) — the mobile workout-detail
 * screen renders exercises + PR badges only, no HR chart — so this
 * adapter omits those fields web fills. `source_activity_id` still rides
 * on the underlying `Activity` if a future mobile surface needs it.
 */
export function activityToWorkout(a: Activity): Workout {
  const details = a.details && "exercises" in a.details ? a.details : undefined;
  return {
    id: a.id,
    name: a.name ?? undefined,
    performed_at: a.start_time,
    ended_at:
      a.duration_seconds > 0
        ? new Date(new Date(a.start_time).getTime() + a.duration_seconds * 1000).toISOString()
        : null,
    notes: a.notes ?? undefined,
    exercises: details?.exercises ?? [],
    created_at: a.created_at,
    personal_records_set: details?.personal_records_set ?? [],
  };
}

/**
 * Splits one unified /activities page into the two buckets the mixed-type
 * surfaces render: strength sessions adapted onto the legacy `Workout`
 * shape (via `activityToWorkout`), and everything else (runs, walks,
 * rides) as the endurance `RunningSession` view.
 *
 * Shared by the Activities Overview and the Calendar — the surfaces that
 * collapsed their workouts+runs merges into ONE `listActivities` fetch in
 * the unified-activity-model migration. Order within each bucket preserves
 * the API's most-recent-first order. Twin note: web extracts this helper
 * to lib/partition-activities.ts for unit tests; mobile has no test runner
 * (deliberate), so it stays inline here — nothing to gain from the split.
 */
export function partitionActivities(activities: Activity[]): {
  workouts: Workout[];
  sessions: RunningSession[];
} {
  const workouts: Workout[] = [];
  const sessions: RunningSession[] = [];
  for (const a of activities) {
    if (a.activity_type === "strength_training") workouts.push(activityToWorkout(a));
    else sessions.push(a);
  }
  return { workouts, sessions };
}

/**
 * GET /activities. Range mode (since/until) and cursor mode
 * (limit/before) are mutually exclusive — the API rejects mixing them.
 * Stage 3 of the unified-activity-model migration: the running surfaces
 * filter server-side via ?type=running rather than pulling every type and
 * discarding. The client-side strength_training guard from the hardening
 * PR stays as a one-line belt in case an older API version (which ignores
 * unknown params) serves this client.
 */
export async function listRunningSessions(
  token: string,
  opts: { limit?: number; before?: string; since?: string; until?: string } = {},
): Promise<RunningSessionsPage> {
  const page = await listActivities(token, { ...opts, type: "running" });
  return {
    ...page,
    activities: page.activities.filter((a) => a.activity_type !== "strength_training"),
  };
}

/** GET /activities/{id} — includes trackpoints. Callers only ever pass ids
 * sourced from run routes/lists, so this assumes an endurance activity id;
 * it does not re-check activity_type. */
export async function getRunningSession(token: string, id: string): Promise<RunningSession> {
  const resp = await fetch(`${config.apiUrl}/activities/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const got = await unwrap<RunningSession | null>(resp, null);
  if (!got) throw new Error("activity not found");
  return got;
}

/** GET /activities/running-metrics — fixed buckets, timeframe-independent. */
export async function getRunningMetrics(token: string, timezone: string): Promise<RunningMetrics> {
  const params = new URLSearchParams({ timezone });
  const resp = await fetch(`${config.apiUrl}/activities/running-metrics?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrap<RunningMetrics>(resp, {
    current_week: { distance_meters: 0, run_count: 0, delta_pct_vs_prior_week: null },
    current_month: { distance_meters: 0, run_count: 0 },
    recent_avg_pace_sec_per_km: null,
    all_time: { distance_meters: 0, run_count: 0 },
  });
}

/** PATCH /activities/{id} — rename. */
export async function renameRunningSession(
  token: string,
  id: string,
  name: string,
): Promise<RunningSession> {
  const resp = await fetch(`${config.apiUrl}/activities/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name }),
  });
  const got = await unwrap<RunningSession | null>(resp, null);
  if (!got) throw new Error("API did not return the updated activity");
  return got;
}

/** DELETE /activities/{id}. */
export async function deleteRunningSession(token: string, id: string): Promise<void> {
  const resp = await fetch(`${config.apiUrl}/activities/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    let detail: string;
    try {
      detail = (await resp.json())?.error ?? `HTTP ${resp.status}`;
    } catch {
      detail = `HTTP ${resp.status}`;
    }
    throw new Error(detail);
  }
}

/**
 * Thrown by importRunningTcx on a 409 — the activity was already
 * imported. Carries the existing activity's id so the UI can link to
 * it ("already in your log → View run").
 */
export class DuplicateRunError extends Error {
  existingActivityId: string;
  constructor(message: string, existingActivityId: string) {
    super(message);
    this.name = "DuplicateRunError";
    this.existingActivityId = existingActivityId;
  }
}

/** A local .tcx file picked for import (RN FormData part). */
export type PickedFile = {
  uri: string;
  name: string;
  mimeType: string;
};

/**
 * POST /activities/tcx as multipart/form-data under field `file`.
 * Server caps at 10 MB. 409 → DuplicateRunError. No Content-Type
 * header (fetch sets the multipart boundary; same rule as uploadAvatar).
 */
export async function importRunningTcx(token: string, file: PickedFile): Promise<RunningSession> {
  const form = new FormData();
  form.append("file", {
    uri: file.uri,
    name: file.name,
    type: file.mimeType,
  } as unknown as Blob);
  const resp = await fetch(`${config.apiUrl}/activities/tcx`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (resp.status === 409) {
    let body: { error?: string; existing_activity_id?: string } = {};
    try {
      body = await resp.json();
    } catch {
      // fall through to defaults
    }
    throw new DuplicateRunError(
      body.error || "This activity is already in your log.",
      body.existing_activity_id ?? "",
    );
  }
  if (!resp.ok) {
    if (resp.status === 413) {
      throw new Error("File is too large (max 10 MB).");
    }
    let detail: string;
    try {
      detail = (await resp.json())?.error ?? `HTTP ${resp.status}`;
    } catch {
      detail = `HTTP ${resp.status}`;
    }
    throw new Error(detail);
  }
  const got = await unwrap<RunningSession | null>(resp, null);
  if (!got) throw new Error("API did not return the imported activity");
  return got;
}

// --- Running best efforts + progression history ------------------
//
// "Best efforts" are running PRs: the fastest window of each standard
// distance (1mi, 2mi, 5K, 10K, half marathon, marathon) found inside any
// of the user's running activities — including a fast segment embedded in
// a longer run. The API stays metric (distance in meters, pace in
// seconds-per-kilometer); the DistanceUnitContext converts toward the
// user's preferred unit at render time. See
// prog-strength-docs/sows/running-best-efforts.md §API Surface.

/**
 * One running PR row: the user's current best at a single standard
 * distance, plus the activity that set it. `pace_sec_per_km` is derived
 * server-side from `duration_seconds / (distance_meters / 1000)`.
 */
export type RunningBestEffort = {
  distance_key: string;
  distance_label: string;
  distance_meters: number;
  duration_seconds: number;
  pace_sec_per_km: number;
  activity_id: string;
  activity_start_time: string; // RFC3339
};

/**
 * One point in a distance's progression series — an activity that
 * achieved a best effort at that distance, with the time it ran.
 */
export type BestEffortPoint = {
  activity_id: string;
  activity_start_time: string; // RFC3339
  duration_seconds: number;
};

/**
 * Progression history for a single standard distance: every activity that
 * achieved a best effort at it, ascending by `activity_start_time`, so a
 * line chart consumes `points` without re-sorting.
 */
export type RunningBestEffortHistory = {
  distance_key: string;
  distance_label: string;
  distance_meters: number;
  points: BestEffortPoint[];
};

/**
 * One point in an exercise's estimated-1RM progression series — the max
 * estimated 1RM across a single workout's sets on that exercise.
 */
export type OneRMHistoryPoint = {
  workout_id: string;
  performed_at: string; // RFC3339
  estimated_1rm: number;
};

/**
 * Per-exercise estimated-1RM time series. `unit` is the lifter's stored
 * weight unit for the series; `points` is one entry per workout in which
 * the exercise was performed, ascending by `performed_at`.
 */
export type ExerciseOneRMHistory = {
  exercise_id: string;
  exercise_name: string;
  unit: "lb" | "kg";
  points: OneRMHistoryPoint[];
};

/**
 * GET /running/best-efforts. Returns the authed user's current best across
 * each standard distance, sorted shortest first. Distances the user has
 * never covered are omitted from the list.
 */
export async function listRunningBestEfforts(token: string): Promise<RunningBestEffort[]> {
  const resp = await fetch(`${config.apiUrl}/running/best-efforts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const got = await unwrap<{ best_efforts: RunningBestEffort[] }>(resp, { best_efforts: [] });
  return got.best_efforts ?? [];
}

/**
 * GET /running/best-efforts/{distance_key}/history. Returns the
 * progression series for one standard distance. 404 (surfaced as a thrown
 * Error) if `distanceKey` isn't a standard distance.
 */
export async function getRunningBestEffortHistory(
  token: string,
  distanceKey: string,
): Promise<RunningBestEffortHistory> {
  const resp = await fetch(
    `${config.apiUrl}/running/best-efforts/${encodeURIComponent(distanceKey)}/history`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  return unwrap<RunningBestEffortHistory>(resp, {
    distance_key: distanceKey,
    distance_label: "",
    distance_meters: 0,
    points: [],
  });
}

// --- Running max-effort estimates --------------------------------
//
// "Max-effort estimates" model what the user could run at each standard
// distance right now — a single curve fit across all their best efforts,
// then evaluated per distance with a confidence band. Unlike best efforts
// (their fastest *actual* window), an estimate exists even for distances
// they've never raced. The API stays metric (distances in meters, pace in
// seconds-per-kilometer; durations in seconds). Sibling: web lib/api.ts
// RunningMaxEffort*. See prog-strength-docs/sows/running-max-effort-estimates.md.

/** The estimate block on a summary/detail row. Null when basis is "insufficient_data". */
export type RunningMaxEffortEstimate = {
  seconds: number;
  lower_seconds: number;
  upper_seconds: number;
  basis: string;
  confidence: string;
  n_points: number;
  n_distances: number;
};

/** The user's current actual best at a distance, if they've run it. */
export type RunningMaxEffortActualBest = {
  seconds: number;
  activity_id: string;
  achieved_at: string; // RFC3339
};

/** One point in the estimate's history series — the estimate as of a past date. */
export type RunningMaxEffortHistoryPoint = {
  as_of: string; // RFC3339
  seconds: number;
  lower_seconds: number;
  upper_seconds: number;
};

/** One actual best-effort attempt at the distance, plotted as a dot. */
export type RunningMaxEffortAttempt = {
  activity_id: string;
  achieved_at: string; // RFC3339
  duration_seconds: number;
  pace_sec_per_km: number;
  source: string;
};

/** Headline stats for the detail screen's tile grid. */
export type RunningMaxEffortStats = {
  estimated_max_effort_seconds: number | null;
  current_best_seconds: number | null;
  gap_seconds: number | null;
  confidence: string;
  data_summary: string;
};

/**
 * One distance row in the summary list. The estimate and actual-best
 * fields are flattened (not nested) and may all be null for distances
 * with insufficient data.
 */
export type RunningMaxEffortDistanceSummary = {
  distance_key: string;
  distance_label: string;
  distance_meters: number;
  estimate_seconds: number | null;
  lower_seconds: number | null;
  upper_seconds: number | null;
  basis: string | null;
  confidence: string | null;
  actual_best_seconds: number | null;
  actual_best_activity_id: string | null;
  actual_best_achieved_at: string | null;
};

/** GET /running/max-effort response — the at-a-glance summary across distances. */
export type RunningMaxEffortSummary = {
  estimator_version: string;
  distances: RunningMaxEffortDistanceSummary[];
};

/** GET /running/max-effort/{distance_key} response — the per-distance detail. */
export type RunningMaxEffortDetail = {
  estimator_version: string;
  distance_key: string;
  distance_label: string;
  distance_meters: number;
  estimate: RunningMaxEffortEstimate | null;
  actual_best: RunningMaxEffortActualBest | null;
  estimate_history: RunningMaxEffortHistoryPoint[];
  attempts: RunningMaxEffortAttempt[];
  stats: RunningMaxEffortStats;
};

/**
 * GET /running/max-effort. Returns the estimator version plus one row per
 * standard distance; estimate/actual-best fields are null where the model
 * lacks data. Always 200.
 */
export async function getRunningMaxEffortSummary(token: string): Promise<RunningMaxEffortSummary> {
  const resp = await fetch(`${config.apiUrl}/running/max-effort`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrap<RunningMaxEffortSummary>(resp, {
    estimator_version: "",
    distances: [],
  });
}

/**
 * GET /running/max-effort/{distance_key}. Returns the per-distance detail
 * — estimate (null when basis "insufficient_data", still HTTP 200), actual
 * best, the estimate history series, raw attempts, and headline stats.
 */
export async function getRunningMaxEffort(
  token: string,
  distanceKey: string,
): Promise<RunningMaxEffortDetail> {
  const resp = await fetch(
    `${config.apiUrl}/running/max-effort/${encodeURIComponent(distanceKey)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  return unwrap<RunningMaxEffortDetail>(resp, {
    estimator_version: "",
    distance_key: distanceKey,
    distance_label: "",
    distance_meters: 0,
    estimate: null,
    actual_best: null,
    estimate_history: [],
    attempts: [],
    stats: {
      estimated_max_effort_seconds: null,
      current_best_seconds: null,
      gap_seconds: null,
      confidence: "",
      data_summary: "",
    },
  });
}

/**
 * GET /activities/personal-records/{exercise_id}/history — the unified
 * alias for the legacy /personal-records/{exercise_id}/history (identical
 * payload). Returns the per-workout estimated-1RM series for one exercise.
 * 404 (surfaced as a thrown Error) if the slug isn't in the exercise
 * catalog.
 */
export async function getExerciseOneRMHistory(
  token: string,
  exerciseId: string,
): Promise<ExerciseOneRMHistory> {
  const resp = await fetch(
    `${config.apiUrl}/activities/personal-records/${encodeURIComponent(exerciseId)}/history`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  return unwrap<ExerciseOneRMHistory>(resp, {
    exercise_id: exerciseId,
    exercise_name: "",
    unit: "lb",
    points: [],
  });
}

// --- Timeline (read shapes for the gated profile activity tab) ----
//
// Mobile has no Timeline surface yet; these are the minimal read shapes
// the public-profile activity tab needs. They mirror web lib/api.ts
// (TimelineSourceType / TimelinePost / TimelineFeedPage) field-for-field
// so the two clients stay a twin — the mobile UI renders read-only cards
// and does NOT port reactions/comments this phase, but the post type
// keeps those fields for shape parity with the API + web.

/**
 * Which source domain a timeline post was projected from. Drives the
 * per-type glyph/label on the card; the denormalized `content` block
 * means the renderer never has to fetch the source row itself.
 */
export type TimelineSourceType = "workout" | "run" | "pr" | "best_effort";

/** The four reaction types a post accepts. Mirrored on the API side. */
export type ReactionType = "like" | "strong" | "fire" | "celebrate";

/**
 * The reaction state for a post: `summary` is a per-type count map (a type
 * is absent when its count is zero), and `mine` lists the types the authed
 * viewer has applied. Returned inline on every post. Read-only on mobile
 * this phase — kept for shape parity with web/the API.
 */
export type ReactionSummary = {
  summary: Record<string, number>;
  mine: string[];
};

/**
 * One feed entry. `content` is the API's denormalized render block so the
 * card needs no per-source fetch; `href` deep-links to the source detail
 * page (e.g. /workouts/{id}, /running/{id}). `occurred_at` is the source
 * event's timestamp (RFC3339), which is what the feed orders and paginates
 * on — NOT the row's created_at.
 */
export type TimelinePost = {
  id: string;
  source_type: TimelineSourceType;
  source_id: string;
  occurred_at: string; // RFC3339
  visibility: string;
  content: {
    title: string;
    subtitle: string;
    metrics: string[];
    href: string;
  };
  reactions: ReactionSummary;
  comment_count: number;
};

/**
 * One page of the feed plus the cursor for the next page. `next_before`
 * is an opaque cursor (an `occurred_at`) to pass back as `before`; null
 * when there are no older posts. Mirrors the activities feed shape.
 */
export type TimelineFeedPage = {
  posts: TimelinePost[];
  next_before: string | null;
};

// --- Social graph: profiles, follows, search ---------------------
//
// The social layer adds public profiles addressable by `username`, a
// follow graph with an approval state machine (request → accept/reject,
// plus cancel/unfollow/remove-follower), user search, and a viewer-scoped
// timeline. Every list endpoint paginates with an opaque keyset `cursor`
// (echoed back as `next_cursor`, null on the last page). The follow
// mutations return the affected edge's `relationship` so the caller can
// reconcile a profile/list row without a refetch. Twin of
// prog-strength-web lib/api.ts — keep the two in sync.

/**
 * The viewer's relationship to another user, from the viewer's side of the
 * edge:
 *   - "none"             no edge in either direction
 *   - "requested"        viewer asked to follow; awaiting the target's accept
 *   - "pending_incoming" the target asked to follow the viewer; viewer can
 *                        accept/reject
 *   - "following"        viewer follows the target (accepted)
 *   - "self"             the target is the viewer
 */
export type Relationship = "none" | "requested" | "pending_incoming" | "following" | "self";

/**
 * The compact card shape used across search results, follower/following
 * lists, and follow-request rows. `username` is nullable because a user may
 * not have chosen a handle yet (the row still resolves by `user_id`).
 */
export type ProfileSummary = {
  user_id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
  relationship: Relationship;
};

/**
 * A full public profile (GET /users/{username}) — a `ProfileSummary` plus
 * the aggregate follower/following counts the profile header renders.
 */
export type PublicProfile = ProfileSummary & {
  follower_count: number;
  following_count: number;
};

/**
 * One pending follow request — a `ProfileSummary` for the other party plus
 * `created_at` (RFC3339) so the inbox can sort/relativize the request age.
 */
export type FollowRequest = ProfileSummary & {
  created_at: string;
};

/**
 * One page of profile summaries plus the keyset cursor for the next page.
 * `next_cursor` is opaque; pass it back as `cursor` to advance. Null when
 * there are no more rows. Shared by search and the follower/following lists.
 */
export type ProfilePage = {
  users: ProfileSummary[];
  next_cursor: string | null;
};

/** One page of follow requests plus the keyset cursor for the next page. */
export type FollowRequestPage = {
  requests: FollowRequest[];
  next_cursor: string | null;
};

/**
 * GET /users/{username}. Returns the public profile addressed by handle.
 * Throws (via unwrap's error path) when the handle is unknown — the API
 * returns a 404 whose `error` envelope becomes the thrown message.
 */
export async function getProfile(token: string, username: string): Promise<PublicProfile> {
  const resp = await fetch(`${config.apiUrl}/users/${encodeURIComponent(username)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const got = await unwrap<PublicProfile | null>(resp, null);
  if (!got) {
    throw new Error("profile not found");
  }
  return got;
}

/**
 * GET /users/search?q=. Returns one page of matching profiles, ranked
 * server-side. `cursor` advances the keyset; omit it for the first page.
 */
export async function searchProfiles(
  token: string,
  q: string,
  cursor?: string,
): Promise<ProfilePage> {
  const params = new URLSearchParams();
  params.set("q", q);
  if (cursor) params.set("cursor", cursor);
  const resp = await fetch(`${config.apiUrl}/users/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrap<ProfilePage>(resp, { users: [], next_cursor: null });
}

/**
 * GET /users/{username}/followers. One page of the users who follow
 * `username`, newest-first. `cursor` advances the keyset.
 */
export async function listFollowers(
  token: string,
  username: string,
  cursor?: string,
): Promise<ProfilePage> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  const resp = await fetch(
    `${config.apiUrl}/users/${encodeURIComponent(username)}/followers${qs ? `?${qs}` : ""}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return unwrap<ProfilePage>(resp, { users: [], next_cursor: null });
}

/**
 * GET /users/{username}/following. One page of the users `username`
 * follows, newest-first. `cursor` advances the keyset.
 */
export async function listFollowing(
  token: string,
  username: string,
  cursor?: string,
): Promise<ProfilePage> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  const resp = await fetch(
    `${config.apiUrl}/users/${encodeURIComponent(username)}/following${qs ? `?${qs}` : ""}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return unwrap<ProfilePage>(resp, { users: [], next_cursor: null });
}

/**
 * GET /follows/requests?direction=. Lists the viewer's pending follow
 * requests in the given direction: "incoming" (others asking to follow the
 * viewer — the inbox to accept/reject) or "outgoing" (the viewer's own
 * pending requests they can cancel). `cursor` advances the keyset.
 */
export async function listFollowRequests(
  token: string,
  direction: "incoming" | "outgoing",
  cursor?: string,
): Promise<FollowRequestPage> {
  const params = new URLSearchParams();
  params.set("direction", direction);
  if (cursor) params.set("cursor", cursor);
  const resp = await fetch(`${config.apiUrl}/follows/requests?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrap<FollowRequestPage>(resp, { requests: [], next_cursor: null });
}

/**
 * POST /follows. Follows `followee` (a username or user_id). For a public
 * target this takes effect immediately (relationship → "following"); for a
 * private one it creates a pending request (relationship → "requested").
 * Returns the affected edge so the caller can reconcile its row. Throws the
 * API's `error` envelope on 400/404/409/429.
 */
export async function requestFollow(token: string, followee: string): Promise<ProfileSummary> {
  const resp = await fetch(`${config.apiUrl}/follows`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ followee }),
  });
  const edge = await unwrap<ProfileSummary | null>(resp, null);
  if (!edge) {
    throw new Error("API did not return the follow edge");
  }
  return edge;
}

/**
 * POST /follows/{username}/accept. Accepts an incoming follow request (the
 * other user now follows the viewer). Returns the updated edge so the inbox
 * can reconcile the row. Throws the API's `error` envelope on non-2xx.
 */
export async function acceptFollow(token: string, username: string): Promise<ProfileSummary> {
  const resp = await fetch(`${config.apiUrl}/follows/${encodeURIComponent(username)}/accept`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const edge = await unwrap<ProfileSummary | null>(resp, null);
  if (!edge) {
    throw new Error("API did not return the follow edge");
  }
  return edge;
}

/**
 * POST /follows/{username}/reject. Rejects an incoming follow request. 204
 * on success (no body); throws the API's `error` envelope on non-2xx.
 */
export async function rejectFollow(token: string, username: string): Promise<void> {
  const resp = await fetch(`${config.apiUrl}/follows/${encodeURIComponent(username)}/reject`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    let detail: string;
    try {
      detail = (await resp.json())?.error ?? `HTTP ${resp.status}`;
    } catch {
      detail = `HTTP ${resp.status}`;
    }
    throw new Error(detail);
  }
}

/**
 * DELETE /follows/{username}. Tears down the viewer's outbound edge to
 * `username`: cancels a still-pending request, or unfollows an accepted
 * one. 204 on success (no body); throws the API's `error` envelope on
 * non-2xx.
 */
export async function cancelOrUnfollow(token: string, username: string): Promise<void> {
  const resp = await fetch(`${config.apiUrl}/follows/${encodeURIComponent(username)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    let detail: string;
    try {
      detail = (await resp.json())?.error ?? `HTTP ${resp.status}`;
    } catch {
      detail = `HTTP ${resp.status}`;
    }
    throw new Error(detail);
  }
}

/**
 * DELETE /followers/{username}. Removes `username` from the viewer's
 * followers (the inbound edge). 204 on success (no body); throws the API's
 * `error` envelope on non-2xx.
 */
export async function removeFollower(token: string, username: string): Promise<void> {
  const resp = await fetch(`${config.apiUrl}/followers/${encodeURIComponent(username)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    let detail: string;
    try {
      detail = (await resp.json())?.error ?? `HTTP ${resp.status}`;
    } catch {
      detail = `HTTP ${resp.status}`;
    }
    throw new Error(detail);
  }
}

/**
 * GET /timeline?user={username}. The viewer-scoped feed for another user's
 * profile, reusing the timeline feed shape. When the viewer isn't allowed
 * to see the user's activity the API returns `locked: true` with an empty
 * `posts` array (the profile renders a gated state rather than throwing);
 * `locked` is absent / false on an accessible feed. `before` is a prior
 * page's `next_before` cursor for pagination.
 */
export async function listUserTimeline(
  token: string,
  username: string,
  before?: string,
): Promise<TimelineFeedPage & { locked?: boolean }> {
  const params = new URLSearchParams();
  params.set("user", username);
  if (before) params.set("before", before);
  const resp = await fetch(`${config.apiUrl}/timeline?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrap<TimelineFeedPage & { locked?: boolean }>(resp, {
    posts: [],
    next_before: null,
    locked: false,
  });
}

/**
 * Availability probe for a candidate username, used by the Settings handle
 * editor to give snappy "available / taken" feedback before the user saves.
 * Implemented against GET /users/{username}: a 200 means the handle resolves
 * to an existing profile (taken → false); a 404 means no such profile
 * (available → true). Because a 404 is the expected/non-error outcome here,
 * this inspects `resp.status` directly rather than going through `unwrap`
 * (which would throw on the 404). Any other non-2xx is surfaced as an error
 * so the caller can fall back to letting the server be authoritative on save.
 */
export async function checkUsernameAvailable(token: string, username: string): Promise<boolean> {
  const resp = await fetch(`${config.apiUrl}/users/${encodeURIComponent(username)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resp.status === 404) return true; // no such profile → available
  if (resp.ok) return false; // resolves to a profile → taken
  let detail: string;
  try {
    detail = (await resp.json())?.error ?? `HTTP ${resp.status}`;
  } catch {
    detail = `HTTP ${resp.status}`;
  }
  throw new Error(detail);
}
