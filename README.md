# Prog Strength — Mobile

iOS app for Prog Strength. React Native + Expo + TypeScript, Expo
Router for navigation, NativeWind (Tailwind) for styling. Calls the
same backends as [prog-strength-web](../prog-strength-web): the Go
API for reads and the Python agent for chat.

## What's here in v1

| Route | Purpose |
| --- | --- |
| `/login` | Continue with Google → JWT in Keychain |
| `/(tabs)/activities` | Activities hub — Overview / Workouts / Running segments |
| `/(tabs)/activities/workout/[id]` | One session's details (sets, reps, weights, PR badges) |
| `/(tabs)/activities/run/[id]` | Run detail — stats + pace/HR/elevation charts |
| `/(tabs)/chat` | Streaming chat with the agent — log new workouts, ask about progress |

Defered to a follow-up: Progress chart, Personal Records page,
Calendar view, Exercises catalog, workout editing, multi-device chat
sync. See `prog-strength-web` for shape parity.

## Prerequisites

- Node 20+ (`node -v`)
- An iOS device or the iOS simulator. Simulator ships with Xcode;
  install Xcode from the Mac App Store if you don't have it.
- The API and agent running locally (defaults: `:8080` and `:8001`),
  or use the prod URLs.

## First-time setup

```sh
npm install

# Copy the env template and edit if your API isn't on localhost:8080.
# Physical devices need your Mac's LAN IP here, not localhost.
cp .env.example .env.local
```

## Run the app

```sh
# Boot the Metro bundler + show the QR code.
npm run start

# Or skip Metro UI and launch the iOS simulator straight away:
npm run ios
```

To run on a physical iPhone, install [Expo Go](https://expo.dev/go)
from the App Store, scan the QR from `npm run start`, and the app
loads over your LAN. Use `EXPO_PUBLIC_API_URL=http://<mac-lan-ip>:8080`
in `.env.local` for this to reach your local backends.

## Backend prerequisite for OAuth

The login screen opens an in-app browser pointed at
`${apiUrl}/auth/google/login?return_to=progstrength://auth/callback`.
The API needs to accept that scheme as a valid `return_to`. In
`prog-strength-api`, add it to the env:

```
RETURN_TO_ALLOWED_ORIGINS=https://progstrength.fitness,...,progstrength://auth/callback
```

(That's a one-time backend change; redeploy the API after.)

Until that's wired up, openAuthSessionAsync resolves with
`type === "cancel"` and the login screen does nothing visible. A
quick local workaround for development is to manually call
`SecureStore.setItemAsync("ps_access_token", "<jwt-from-web-app>")`
from a temporary screen and skip OAuth altogether.

## Project layout

```
app/                  Expo Router file-based routes (mirrors web's
  _layout.tsx         pages/ layout)
  index.tsx           Auth-aware redirect → /login or /activities
  login.tsx
  (tabs)/             Route group: bottom-tab nav
    _layout.tsx
    activities/
      _layout.tsx     Nested stack so details push over the hub
      index.tsx
      [id].tsx
    chat.tsx
components/           Shared presentational pieces
lib/
  config.ts           EXPO_PUBLIC_* env vars + defaults
  auth.ts             JWT storage via expo-secure-store (Keychain)
  api.ts              Fetchers against the Go API
  stream.ts           SSE parser for agent chat
assets/               (add icon.png + splash.png before publishing)
global.css            Tailwind layers — required by NativeWind
tailwind.config.js    Color tokens (dark-only for v1)
```

## Workflow notes

- **Source of truth for types**: `lib/api.ts` mirrors
  `prog-strength-web/lib/api.ts`. When the Go API changes, update both.
- **No native code**: stays in Expo's managed workflow. If we ever
  need a library that requires a config plugin, add it to `app.json`
  and run `npx expo prebuild` once.
- **Versioning**: `npx expo install --check` aligns deps with the
  current SDK if something complains during install. Bump
  `expo` in `package.json` and rerun to take a new SDK.

## Things to watch for

- **Streaming chat**: uses Expo's `expo/fetch` (spec-compliant
  ReadableStream). If a future SDK breaks that import, swap to
  `react-native-sse` — the `StreamEvent` type stays identical.
- **Token expiry**: when the API returns 401, the app clears the
  token and routes to `/login`. There's no refresh flow yet.
- **iOS dark mode**: locked on in `app.json` (`userInterfaceStyle: "dark"`).
  The web app is dark-only too, so this is parity, not a missing
  feature.

## Distribution

### Tier 1 — Expo Go on your phone (free, instant)

For real-device feel while iterating. No Apple Developer account
required. Limit: phone has to be on the same Wi-Fi as your Mac, and
Expo Go has to be open for the app to run.

1. Install Expo Go from the App Store on your iPhone
2. Override `.env.local` to use your Mac's LAN IP (not localhost):
   ```sh
   ipconfig getifaddr en0     # e.g. 10.0.0.49
   ```
   ```
   EXPO_PUBLIC_API_URL=http://10.0.0.49:8080
   EXPO_PUBLIC_AGENT_URL=http://10.0.0.49:8001
   ```
3. `npm run start`, scan the QR code with the iPhone's Camera app

### Tier 2 — TestFlight Internal Testing + OTA updates ($99/yr Apple)

Standalone app, home screen icon, JS updates auto-pushed from CI.
Once set up, the loop is:

- `git push` to main → CI runs `eas update` → JS bundle reaches your
  phone within ~30 seconds of opening the app
- Manual workflow_dispatch with `build=true` when native files
  change (app icon, expo SDK bump, new native dep) → fresh
  TestFlight build, no App Review for Internal Testing

#### One-time setup (before the first build)

1. **Apple Developer Program** — sign up at developer.apple.com ($99/year).
   Activation can take 24-48h, plan around that.
2. **Expo account + EAS** — `npx eas-cli login` from this directory.
3. **Initialize the EAS project**:
   ```sh
   npx eas-cli init
   ```
   This creates the project entry on Expo's side and writes the
   project ID into `app.json` under `expo.extra.eas.projectId`.
4. **Bind to your Apple team**:
   ```sh
   npx eas-cli credentials
   ```
   Pick iOS → preview → set up new credentials. EAS handles
   provisioning certs and profiles; just sign in with your Apple ID
   when prompted.
5. **Drop in app assets** — Apple requires a real icon to build:
   - `assets/icon.png` (1024×1024 PNG, no alpha channel)
   - The default Expo splash is fine for now
6. **GitHub secrets** — add to this repo's settings:
   - `EXPO_TOKEN` — generate at expo.dev → Settings → Access Tokens.
     CI uses this to publish OTA updates and trigger builds.
7. **First build, locally**:
   ```sh
   npx eas-cli build --platform ios --profile preview
   ```
   Takes ~15-20 min. EAS emails you an install link when done; tap
   it on your iPhone, install, you have the app.

#### After the first build

- **Every push to main**: `.github/workflows/release.yml` runs
  `eas update`. App on phone gets the new JS bundle on next open.
- **Native change** (app icon, expo SDK bump, etc.): in GitHub Actions,
  use **Run workflow** on `Mobile Release`, check "Cut a new native
  build", pick `preview`. New TestFlight build lands in ~30 min.
- **Production push**: same workflow_dispatch with profile=`production`.
  EAS submits to App Store Connect, which fills the TestFlight
  External Testing slot after one-time App Review (skip until you
  need real testers beyond yourself).

### Tier 3 — Public App Store

Same toolchain (`profile=production` auto-submits). Adds Apple
review, screenshots, privacy policy, store listing. Skip until
there's a reason; Internal TestFlight covers personal use forever
(builds expire after 90 days, but each new build refreshes that).

### Cost summary

| Item              | Frequency      | Cost          |
| ----------------- | -------------- | ------------- |
| Apple Developer   | yearly         | $99           |
| EAS Build         | per build      | free up to ~30/month for personal use |
| EAS Update        | per OTA push   | free for hobby tier |
| App Store listing | one-time       | included in $99 |

## Releasing

Fully automatic — `.github/workflows/release.yml` decides on every
merge to `main`:

- **JS-only change** (fingerprint unchanged): `eas update` publishes
  an OTA bundle; the app fetches it on next launch (~30s). Roll back
  with `npx eas-cli update:republish --branch production`.
- **Native change** (new native module, config plugin, SDK upgrade —
  i.e. the fingerprint has no existing build): `eas build
  --auto-submit` cuts a new TestFlight build automatically. Install it
  from the TestFlight app (enable TestFlight auto-updates and even
  that is hands-off). No version bumps needed —
  `runtimeVersion.policy: fingerprint` guarantees OTA updates only
  ever target binaries with matching native state.

The only remaining manual step: TestFlight builds expire after 90
days, and an expiry refresh changes nothing in the fingerprint — force
one with Actions → release → Run workflow → `build=true`,
`profile=production`.

### One-time setup (already done — recorded for disaster recovery)

1. `npx eas-cli login` (Expo account `jwallace145`)
2. `npx eas-cli credentials` → EAS-managed iOS cert + provisioning
   profile against the Apple Developer account; App Store Connect app
   record for `fitness.progstrength.app`
3. Expo access token → `EXPO_TOKEN` secret on this repo
4. First build: `eas build --platform ios --profile preview`, install
   via the EAS link, smoke test; then `--profile production` to reach
   TestFlight
