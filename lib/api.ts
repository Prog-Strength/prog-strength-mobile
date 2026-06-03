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

/** A logged training session. */
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

/** Optional filters and pagination params for GET /workouts. */
export type ListWorkoutsOptions = {
  // RFC3339 lower/upper bounds on performed_at.
  since?: string;
  until?: string;
  // Page size, 1–100. The API defaults to 50 when omitted.
  limit?: number;
  // Rows to skip, ≥ 0. Defaults to 0.
  offset?: number;
};

/**
 * One page of workouts plus the metadata callers need to render
 * pagination controls. Mirrors the API's data envelope shape.
 */
export type WorkoutsPage = {
  items: Workout[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
};

/**
 * GET /workouts. Returns one page of the authed user's workouts,
 * most recent first. Pass `since`/`until` for server-side timeframe
 * filtering; pass `limit`/`offset` for pagination.
 */
export async function listWorkouts(
  token: string,
  options: ListWorkoutsOptions = {},
): Promise<WorkoutsPage> {
  const params = new URLSearchParams();
  if (options.since) params.set("since", options.since);
  if (options.until) params.set("until", options.until);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  const qs = params.toString();
  const resp = await fetch(
    `${config.apiUrl}/workouts${qs ? `?${qs}` : ""}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  // Empty page fallback so callers can render a clean empty state
  // rather than throw on missing payload.
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
 * catalog. Used by the workouts page to map exercise_id slugs to
 * human names.
 */
export async function listExercises(): Promise<Exercise[]> {
  const resp = await fetch(`${config.apiUrl}/exercises`);
  return unwrap<Exercise[]>(resp, []);
}

/**
 * GET /workouts/{id}. Returns a single workout owned by the authed
 * user. Used by the workout detail route reachable from the Personal
 * Records page. 404 if the ID doesn't exist or belongs to another
 * user (deliberately indistinguishable so IDs can't be enumerated).
 */
export async function getWorkout(token: string, id: string): Promise<Workout> {
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
export async function listPersonalRecords(
  token: string,
): Promise<PersonalRecord[]> {
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
export async function listMyHeadlineExercises(
  token: string,
): Promise<HeadlineExercise[]> {
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

/**
 * GET /workouts/progression response. Currently driven by the
 * `muscle_group` query parameter; future filters (exercise_id,
 * equipment, etc.) will produce different response shapes returned
 * from the same endpoint. See
 * prog-strength-docs/sows/estimated-one-rep-max-time-series-table.md.
 */
export type MuscleGroupProgression = {
  muscle_group: string;
  since: string;
  until: string;
  exercise_baselines: ExerciseBaseline[];
  points: MuscleGroupProgressionPoint[];
  // Single combined trendline through every normalized point.
  // Null when there are fewer than 2 points or all share the same X.
  trendline: Trendline | null;
};

/**
 * GET /workouts/progression?muscle_group=...&since=...&until=...
 *
 * Requires auth. The backend resolves the muscle-group filter into
 * every exercise that targets it, reads each exercise's 1RM history,
 * computes a recency-weighted current baseline per exercise, and
 * returns normalized points + a single trendline ready to plot.
 *
 * Timestamps are RFC3339; if either is omitted, the server defaults
 * to the last 90 days.
 */
export async function listProgression(
  token: string,
  muscleGroup: string,
  since?: string,
  until?: string,
): Promise<MuscleGroupProgression> {
  const params = new URLSearchParams({ muscle_group: muscleGroup });
  if (since) params.set("since", since);
  if (until) params.set("until", until);
  const resp = await fetch(
    `${config.apiUrl}/workouts/progression?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  // Force a non-null default — empty progression rather than throwing
  // on missing payload, so callers can render a clean empty state.
  const got = await unwrap<MuscleGroupProgression | null>(resp, null);
  return (
    got ?? {
      muscle_group: muscleGroup,
      since: since ?? "",
      until: until ?? "",
      exercise_baselines: [],
      points: [],
      trendline: null,
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
  ended_at?: string;    // RFC3339, optional
  notes?: string;
  exercises: {
    exercise_id: string;
    superset_group?: number | null;
    notes?: string;
    sets: WorkoutSet[];
  }[];
};

/**
 * DELETE /workouts/{id}. Soft-deletes the workout server-side (sets
 * deleted_at; subsequent reads treat the row as gone). Throws on non-
 * 2xx with the API's `error` envelope as the message — typically a
 * 404 if the ID doesn't exist or isn't owned by this user.
 */
export async function deleteWorkout(token: string, id: string): Promise<void> {
  const resp = await fetch(`${config.apiUrl}/workouts/${encodeURIComponent(id)}`, {
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
 * PUT /workouts/{id}. Full replacement — the body is the complete
 * workout state, not a partial diff. Ownership is enforced server-side;
 * a non-2xx response means the API rejected the payload (validation
 * error) or the workout doesn't belong to this user.
 *
 * Returns the updated Workout from the API response so callers can
 * splice it into local state without a follow-up refetch.
 */
export async function updateWorkout(
  token: string,
  id: string,
  payload: WorkoutPayload,
): Promise<Workout> {
  const resp = await fetch(`${config.apiUrl}/workouts/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  // For mutations we don't fall back to an empty value — if the
  // response shape is wrong, that's a bug worth surfacing as an error.
  const updated = await unwrap<Workout | null>(resp, null);
  if (!updated) {
    throw new Error("API did not return the updated workout");
  }
  return updated;
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

/** Payload for editing a log entry. Omit a field to leave it unchanged. */
export type UpdateLogEntryPayload = {
  quantity?: number;
  consumed_at?: string;
  meal?: MealType;
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

export async function listPantryItems(
  token: string,
  query?: string,
): Promise<PantryItem[]> {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  const qs = params.toString();
  const resp = await fetch(
    `${config.apiUrl}/pantry-items${qs ? `?${qs}` : ""}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return unwrap<PantryItem[]>(resp, []);
}

export async function getPantryItem(
  token: string,
  id: string,
): Promise<PantryItem> {
  const resp = await fetch(
    `${config.apiUrl}/pantry-items/${encodeURIComponent(id)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
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
  const resp = await fetch(
    `${config.apiUrl}/pantry-items/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
  );
  const updated = await unwrap<PantryItem | null>(resp, null);
  if (!updated) throw new Error("API did not return the updated pantry item");
  return updated;
}

export async function deletePantryItem(
  token: string,
  id: string,
): Promise<void> {
  const resp = await fetch(
    `${config.apiUrl}/pantry-items/${encodeURIComponent(id)}`,
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
  const resp = await fetch(
    `${config.apiUrl}/nutrition-log${qs ? `?${qs}` : ""}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
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

export async function updateNutritionLogEntry(
  token: string,
  id: string,
  payload: UpdateLogEntryPayload,
): Promise<NutritionLogEntry> {
  const resp = await fetch(
    `${config.apiUrl}/nutrition-log/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
  );
  const updated = await unwrap<NutritionLogEntry | null>(resp, null);
  if (!updated) throw new Error("API did not return the updated log entry");
  return updated;
}

export async function deleteNutritionLogEntry(
  token: string,
  id: string,
): Promise<void> {
  const resp = await fetch(
    `${config.apiUrl}/nutrition-log/${encodeURIComponent(id)}`,
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
  const resp = await fetch(
    `${config.apiUrl}/nutrition-log/daily?${qs}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
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
  const resp = await fetch(
    `${config.apiUrl}/bodyweight${qs ? `?${qs}` : ""}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
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

export async function deleteBodyweightEntry(
  token: string,
  id: string,
): Promise<void> {
  const resp = await fetch(
    `${config.apiUrl}/bodyweight/${encodeURIComponent(id)}`,
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
  const resp = await fetch(
    `${config.apiUrl}/recipes/${encodeURIComponent(id)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const got = await unwrap<Recipe | null>(resp, null);
  if (!got) throw new Error("recipe not found");
  return got;
}

export async function createRecipe(
  token: string,
  payload: RecipePayload,
): Promise<Recipe> {
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
  const resp = await fetch(
    `${config.apiUrl}/recipes/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
  );
  const updated = await unwrap<Recipe | null>(resp, null);
  if (!updated) throw new Error("API did not return the updated recipe");
  return updated;
}

export async function deleteRecipe(
  token: string,
  id: string,
): Promise<void> {
  const resp = await fetch(
    `${config.apiUrl}/recipes/${encodeURIComponent(id)}`,
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

// --- Chat sessions -----------------------------------------------

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

export async function listChatSessions(
  token: string,
): Promise<ChatSessionListItem[]> {
  const resp = await fetch(`${config.apiUrl}/chat-sessions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return unwrap<ChatSessionListItem[]>(resp, []);
}

export async function createChatSession(
  token: string,
  id: string,
): Promise<ChatSession> {
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

export async function getChatSession(
  token: string,
  id: string,
): Promise<ChatSessionWithMessages> {
  const resp = await fetch(
    `${config.apiUrl}/chat-sessions/${encodeURIComponent(id)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
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
  const resp = await fetch(
    `${config.apiUrl}/chat-sessions/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title }),
    },
  );
  const updated = await unwrap<ChatSession | null>(resp, null);
  if (!updated) throw new Error("API did not return the updated chat session");
  return updated;
}

export async function deleteChatSession(
  token: string,
  id: string,
): Promise<void> {
  const resp = await fetch(
    `${config.apiUrl}/chat-sessions/${encodeURIComponent(id)}`,
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
