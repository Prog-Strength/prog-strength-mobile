/**
 * Runtime configuration. EXPO_PUBLIC_* env vars are inlined into the JS
 * bundle at build time — set them in .env.local for local dev and via
 * EAS Secrets (or `expo export --env-file`) for production builds.
 *
 * Defaults target the deployed Prog Strength backends so a fresh
 * checkout runs against live data without any local services. Override
 * via .env.local to point at a Mac running the API / agent locally
 * (LAN IP if testing on a physical phone, since `localhost` resolves
 * to the phone itself; simulators inherit the host's localhost).
 *
 * The dev-only "Dev sign in" panel on the login screen keys off the
 * URL — it only renders when EXPO_PUBLIC_API_URL points at a loopback
 * / LAN host, so prod builds never see it.
 */
export const config = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "https://api.progstrength.fitness",
  agentUrl:
    process.env.EXPO_PUBLIC_AGENT_URL ?? "https://agent.progstrength.fitness",
};
