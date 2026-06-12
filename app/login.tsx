// Login screen — mirrors prog-strength-web/app/login/page.tsx in spirit,
// but adapted for the native flow:
//
//   1. We use `expo-web-browser`'s openAuthSessionAsync to open the
//      backend's OAuth start URL in an in-app browser (SFAuthenticationSession
//      on iOS), which the OS auto-dismisses when the redirect lands on
//      our scheme.
//   2. The backend redirects to progstrength://auth/callback with the
//      JWT in the URL hash, the same shape the web app uses.
//   3. We parse the hash, persist the token to the Keychain, and route
//      into the tab navigator.
//
// Prerequisite that lives outside this repo: the API's
// RETURN_TO_ALLOWED_ORIGINS env var must include
//   progstrength://auth/callback
// so the backend doesn't reject the return_to as untrusted. Without
// that, openAuthSessionAsync resolves with type === "cancel" and the
// screen sits idle.
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { config } from "@/lib/config";
import { getToken, setToken } from "@/lib/auth";

// Dev-mode sign-in path is offered only when EXPO_PUBLIC_API_URL points
// at a loopback / LAN host — exactly the case where the API is running
// locally with DEV_AUTH=true and the OAuth Google client isn't
// configured. Production builds (api.progstrength.fitness) never see
// this panel.
function isLocalApi(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
    url,
  );
}

// Required when using openAuthSessionAsync on web; harmless on native.
// Without this, the SDK can't tell the parent window that auth
// completed when the in-app session dismisses.
WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Dev-mode sign-in inputs. State lives at the top level (rather than
  // in the dev panel) so the email survives the OAuth button re-render
  // and so production builds never allocate it.
  const [devEmail, setDevEmail] = useState("");
  const showDevPanel = isLocalApi(config.apiUrl);

  // Skip the OAuth screen entirely if a token's already in the
  // Keychain — covers app-restart and a successful first login.
  useEffect(() => {
    getToken().then((t) => {
      if (t) router.replace("/activities");
    });
  }, [router]);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const returnTo = Linking.createURL("/auth/callback");
      const authUrl = `${config.apiUrl}/auth/google/login?return_to=${encodeURIComponent(returnTo)}`;
      const result = await WebBrowser.openAuthSessionAsync(authUrl, returnTo);

      if (result.type !== "success" || !result.url) {
        // User dismissed the in-app browser before the redirect
        // landed. No-op — they'll see the login screen again.
        return;
      }

      // Backend redirects to <returnTo>#access_token=…&expires_in=…
      // The hash never reaches the server, which is why we use it.
      const hash = result.url.split("#")[1] ?? "";
      const params = new URLSearchParams(hash);

      const oauthError = params.get("error");
      if (oauthError === "beta_required") {
        const email = params.get("email") ?? "";
        setError(
          email
            ? `${email} isn't on the beta allowlist. Contact the admin to request access.`
            : "This account isn't on the beta allowlist.",
        );
        return;
      }

      const token = params.get("access_token");
      const expiresInRaw = params.get("expires_in");
      if (!token) {
        setError("Sign-in didn't return a token. Try again.");
        return;
      }
      const expiresIn = expiresInRaw ? parseInt(expiresInRaw, 10) : NaN;
      await setToken(
        token,
        Number.isFinite(expiresIn) ? expiresIn : undefined,
      );
      router.replace("/activities");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function devSignIn() {
    const trimmed = devEmail.trim();
    if (!trimmed) {
      setError("Enter an email to mint a dev token.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`${config.apiUrl}/auth/dev/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, display_name: trimmed }),
      });
      const body = await resp.json();
      if (!resp.ok) {
        throw new Error(body?.error ?? `HTTP ${resp.status}`);
      }
      const token = body?.data?.token as string | undefined;
      const expiresIn = body?.data?.expires_in as number | undefined;
      if (!token) {
        throw new Error("API did not return a token");
      }
      await setToken(
        token,
        Number.isFinite(expiresIn) ? expiresIn : undefined,
      );
      router.replace("/activities");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <View className="w-full max-w-sm gap-8">
        <View className="items-center gap-2">
          <Text className="text-3xl font-semibold tracking-tight text-foreground">
            Prog Strength
          </Text>
          <Text className="text-center text-sm text-muted">
            Sign in to track and chat about your training.
          </Text>
        </View>

        <Pressable
          onPress={signIn}
          disabled={busy}
          accessibilityRole="button"
          className="flex-row items-center justify-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 active:opacity-80"
        >
          {busy ? (
            <ActivityIndicator color="#fafafa" />
          ) : (
            <Text className="text-sm font-medium text-foreground">
              Continue with Google
            </Text>
          )}
        </Pressable>

        {error && (
          <Text className="text-center text-xs text-danger">{error}</Text>
        )}

        <Text className="text-center text-xs text-muted">
          We use Google sign-in to identify you. No password to manage.
        </Text>

        {showDevPanel && (
          <View className="gap-2 rounded-lg border border-border bg-surface px-4 py-3">
            <Text className="text-[10px] uppercase tracking-wider text-muted">
              Dev sign-in
            </Text>
            <Text className="text-xs text-muted">
              EXPO_PUBLIC_API_URL points at a local host. Mint a JWT
              via the API&apos;s DEV_AUTH=true endpoint instead of going
              through Google OAuth.
            </Text>
            <TextInput
              value={devEmail}
              onChangeText={setDevEmail}
              placeholder="you@example.com"
              placeholderTextColor="#71717a"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={!busy}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
            <Pressable
              onPress={devSignIn}
              disabled={busy}
              accessibilityRole="button"
              className="rounded-md border border-border px-3 py-2 active:opacity-80"
            >
              {busy ? (
                <ActivityIndicator color="#fafafa" />
              ) : (
                <Text className="text-center text-xs font-medium text-foreground">
                  Dev sign in
                </Text>
              )}
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}
