/**
 * Shared resolved-profile state for the authed app. The header avatar
 * button, the Settings screen, and unit-aware displays all read one
 * `GET /me` result instead of fetching independently — editing the
 * display name in Settings updates the header instantly.
 *
 * Mounted once in app/_layout.tsx. The provider does NOT fetch on
 * mount (the root layout renders before auth is known); the (tabs)
 * auth gate calls `refresh()` once a token is confirmed. Mirrors
 * prog-strength-web/lib/profile-context.tsx — keep the two in sync.
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useRouter } from "expo-router";
import {
  deleteAvatar,
  getMe,
  updateMe,
  uploadAvatar,
  type PickedImage,
  type ProfilePatch,
  type ResolvedProfile,
} from "@/lib/api";
import { clearToken, getToken } from "@/lib/auth";

type ProfileContextValue = {
  profile: ResolvedProfile | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  update: (patch: ProfilePatch) => Promise<ResolvedProfile>;
  uploadAvatar: (image: PickedImage) => Promise<ResolvedProfile>;
  removeAvatar: () => Promise<ResolvedProfile>;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [profile, setProfile] = useState<ResolvedProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On a 401 from any profile call, drop the token and bounce to
  // /login. Returns true when it handled an auth failure.
  const handleAuthError = useCallback(
    async (err: unknown): Promise<boolean> => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("401")) {
        await clearToken();
        router.replace("/login");
        return true;
      }
      return false;
    },
    [router],
  );

  const refresh = useCallback(async (): Promise<void> => {
    const token = await getToken();
    if (!token) return; // stay idle; the (tabs) auth gate owns routing
    setLoading(true);
    try {
      const data = await getMe(token);
      setProfile(data);
      setError(null);
    } catch (err: unknown) {
      if (await handleAuthError(err)) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [handleAuthError]);

  // Shared write path: run the call, store the returned profile,
  // rethrow so the caller can surface the error inline.
  const mutate = useCallback(
    async (op: (token: string) => Promise<ResolvedProfile>): Promise<ResolvedProfile> => {
      const token = await getToken();
      if (!token) {
        router.replace("/login");
        throw new Error("not authenticated");
      }
      try {
        const next = await op(token);
        setProfile(next);
        setError(null);
        return next;
      } catch (err: unknown) {
        await handleAuthError(err);
        throw err;
      }
    },
    [handleAuthError, router],
  );

  const update = useCallback(
    (patch: ProfilePatch) => mutate((token) => updateMe(token, patch)),
    [mutate],
  );
  const doUploadAvatar = useCallback(
    (image: PickedImage) => mutate((token) => uploadAvatar(token, image)),
    [mutate],
  );
  const removeAvatar = useCallback(() => mutate((token) => deleteAvatar(token)), [mutate]);

  return (
    <ProfileContext.Provider
      value={{
        profile,
        loading,
        error,
        refresh,
        update,
        uploadAvatar: doUploadAvatar,
        removeAvatar,
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

/** Throws outside <ProfileProvider> so a missing provider fails loudly. */
export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used within a ProfileProvider");
  return ctx;
}
