/**
 * JWT storage backed by the iOS Keychain via expo-secure-store. The web
 * app uses localStorage; we can't here because (a) RN has no
 * localStorage and (b) Keychain is encrypted at rest and tied to the
 * user's device passcode, which is the right primitive for an auth
 * token.
 *
 * The token is sent as `Authorization: Bearer <token>` on every call
 * to the API and the agent. There's no refresh flow yet — when the
 * backend returns 401 the UI calls `clearToken()` and routes the user
 * back to /login.
 */
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "ps_access_token";
const EXPIRES_AT_KEY = "ps_access_token_expires_at";

/**
 * Persist the token (and optional expiry) to the Keychain. SecureStore
 * is async because the OS may prompt for biometric/passcode unlock
 * depending on accessibility settings — we default to WHEN_UNLOCKED
 * which doesn't prompt but does require the device to be unlocked
 * before the token is readable.
 */
export async function setToken(
  token: string,
  expiresInSeconds?: number,
): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
  if (expiresInSeconds !== undefined) {
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    await SecureStore.setItemAsync(EXPIRES_AT_KEY, String(expiresAt));
  } else {
    // Clear any stale expiry so we don't accidentally enforce the
    // previous token's deadline against a fresh long-lived one.
    await SecureStore.deleteItemAsync(EXPIRES_AT_KEY);
  }
}

/**
 * Read the token. Returns null when no token is stored, or when an
 * optional expiry has elapsed (in which case the stored entries are
 * cleared so subsequent calls don't repeat the check).
 */
export async function getToken(): Promise<string | null> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!token) return null;
  const expiresAtRaw = await SecureStore.getItemAsync(EXPIRES_AT_KEY);
  if (expiresAtRaw) {
    const expiresAt = parseInt(expiresAtRaw, 10);
    if (!Number.isNaN(expiresAt) && Date.now() > expiresAt) {
      await clearToken();
      return null;
    }
  }
  return token;
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(EXPIRES_AT_KEY);
}
