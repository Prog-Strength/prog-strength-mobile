// Exercise catalog context. The catalog is admin-curated and basically
// static for the lifetime of a session — it changes only when the API
// team deploys new slugs. Fetching it once per session, instead of on
// every tab focus that needs to resolve slug → name, removes the bulk
// of /exercises traffic the mobile was generating.
//
// Provider is mounted inside (tabs)/_layout.tsx so it sits underneath
// the auth gate (only authed sessions need the catalog) and above every
// screen that consumes it. Consumers use the `useExerciseCatalog` hook
// to read the list + a memoized id→Exercise map for O(1) lookups.
//
// `refresh()` is exposed for the rare case where a screen needs to
// force a re-fetch (e.g. an admin tool that's added a new slug
// mid-session). Day-to-day code doesn't need it.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { listExercises, type Exercise } from "@/lib/api";

type CatalogState = {
  exercises: Exercise[];
  byID: Map<string, Exercise>;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

const CatalogContext = createContext<CatalogState | null>(null);

export function ExerciseCatalogProvider({ children }: { children: React.ReactNode }) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    listExercises()
      .then(setExercises)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const byID = useMemo(() => {
    const m = new Map<string, Exercise>();
    for (const ex of exercises) m.set(ex.id, ex);
    return m;
  }, [exercises]);

  const value = useMemo<CatalogState>(
    () => ({ exercises, byID, loading, error, refresh }),
    [exercises, byID, loading, error, refresh],
  );

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useExerciseCatalog(): CatalogState {
  const ctx = useContext(CatalogContext);
  if (!ctx) {
    throw new Error("useExerciseCatalog called outside <ExerciseCatalogProvider>");
  }
  return ctx;
}
