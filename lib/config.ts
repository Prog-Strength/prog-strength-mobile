/**
 * Runtime configuration. EXPO_PUBLIC_* env vars are inlined into the JS
 * bundle at build time — set them in .env.local for local dev and via
 * EAS Secrets (or `expo export --env-file`) for production builds.
 *
 * Defaults target a Mac running the API + agent locally. On a physical
 * iPhone you'll want to override these to your dev machine's LAN IP
 * (e.g. http://10.0.0.49:8080) since `localhost` resolves to the phone
 * itself. Simulators inherit the host's localhost.
 */
export const config = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8080",
  agentUrl: process.env.EXPO_PUBLIC_AGENT_URL ?? "http://localhost:8001",
};
