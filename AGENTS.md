# AGENTS.md — prog-strength-mobile

Orientation for AI agents and humans working in this repo. Read this
before touching code; see [CONTRIBUTING.md](CONTRIBUTING.md) for the
contribution workflow and [README.md](README.md) for setup + releasing.

## What this is

The iOS app for Prog Strength, a personal strength-training platform.
Expo SDK 55 (managed workflow), React Native + TypeScript (strict),
Expo Router (file-based routing), NativeWind (Tailwind classes on RN
primitives). Single real user (the owner) via TestFlight Internal
Testing. The app calls the same backends as `prog-strength-web`: the
Go API for data and the Python agent service for chat.

Sibling repos live under `prog-strength/repos/`. Feature work is
driven by SOWs in `prog-strength-docs/sows/` (currently
`mobile-feature-parity-and-testflight.md`) with per-phase plans in
`prog-strength-docs/plans/`.

## The one rule that matters most

**`prog-strength-web` is the parity reference.** When porting a
feature, read the web implementation first — endpoint shapes, math,
validation, copy. The web repo is checked out as a sibling
(`../prog-strength-web`). Two files are deliberate twins kept in sync
by hand ("edit twice" discipline, no shared package):

- `lib/api.ts` ↔ web `lib/api.ts` — same types, same fetcher
  signatures, same `unwrap` envelope. RN divergences are limited to
  FormData parts (`{uri, name, type}` instead of browser `File`).
- Formatting/conversion helpers in `lib/units.ts` mirror web's
  `lib/format.ts` + `lib/distance-unit-context.tsx` math exactly
  (weight conversion, distance/pace, durations).

## Map

```
app/                    Expo Router routes (typedRoutes ON)
  _layout.tsx           Root stack; mounts Profile/Usage providers (lazy)
  index.tsx, login.tsx  Auth redirect + Google OAuth (JWT → Keychain)
  settings.tsx          Root-level screen, pushed from header avatar
  (tabs)/_layout.tsx    Auth gate + 5 tabs: Chat · Activities · Calendar
                        · Nutrition · Progress (5 = iOS max; new surfaces
                        nest via segmented controls, not new tabs)
  (tabs)/activities/    Hub (Overview|Workouts|Running segments) +
                        workout/[id] + run/[id] detail stacks
components/             Shared UI; subfolders per domain
  charts/ticks.ts       Shared axis-tick helpers (SVG charts)
lib/                    api.ts (API twin), auth.ts (Keychain JWT),
                        units.ts (conversions), profile-context.tsx /
                        usage-context.tsx (lazy shared state),
                        stream.ts (SSE), config.ts (env)
```

## Conventions that are load-bearing

- **Units convert at render time only.** Sets/entries store the unit
  they were logged in; `profile.weight_unit` / `profile.distance_unit`
  drive display via `lib/units.ts`. Never rewrite stored values or
  convert in API payloads.
- **Contexts are lazy.** Profile/Usage providers mount at the root but
  do no I/O until the `(tabs)` auth gate calls `refresh()` — keeps the
  root layout free of SecureStore reads. Mirror this for new contexts.
- **401 handling**: every fetch error path checks
  `msg.toLowerCase().includes("401")` → `clearToken()` +
  `router.replace("/login")`. Copy the pattern from an existing screen.
- **Mobile UI floor** (from the SOW, non-negotiable): ≥44pt touch
  targets, safe-area respected, action sheets / bottom sheets instead
  of desktop modals, charts fit ~360pt width (no horizontal scroll),
  segmented controls max 3 options, loading + empty + error states on
  every new list/chart. Dark mode only (`#0a0a0b` background; use the
  NativeWind tokens: `bg-background`, `bg-surface`, `border-border`,
  `text-foreground`, `text-muted`, `text-danger`, `bg-accent`,
  `text-accent-fg`).
- **Charts** are hand-rolled `react-native-svg` (see
  `components/activities/run-metric-chart.tsx` and
  `components/nutrition/bodyweight-chart.tsx`); axis ticks come from
  `components/charts/ticks.ts`. No chart libraries.
- **Dumbbell weights are per-dumbbell**, not the pair ("50s" → 50).

## Verifying work

There is **no JS test runner** — a deliberate SOW decision; don't add
one. The bar is:

```bash
npm run typecheck   # tsc --noEmit (strict)
npm run lint        # eslint (expo config + prettier-compat)
npm run format:check
npx expo-doctor     # dependency/SDK/config health — keep 19/19
```

…plus a manual check in the iOS simulator (`npm run ios`) for UI work.
Pre-commit hooks run lint-staged + typecheck; commitlint enforces
conventional commits. CI re-runs all of it on PRs.

## Releases (you usually don't need to do anything)

`release.yml` runs on every merge to `main` and decides via Expo
fingerprint (`runtimeVersion.policy: fingerprint`):

- JS-only change → OTA update, on the phone in ~30s.
- Native change (new native module, config plugin, SDK bump) → EAS
  build auto-submitted to TestFlight (~30 min).

Consequences for contributors: adding a native module is allowed but
should be called out in the PR (it triggers a 30-minute build instead
of an instant OTA); never assume an OTA can deliver native changes.
No manual version bumps are needed — fingerprint isolation makes
runtime mismatches structurally impossible.

## Gotchas

- `expo/fetch` (not global fetch) is required for SSE streaming —
  `lib/stream.ts` handles this; chat consumes `audio_chunk` events for
  streaming TTS.
- `punycode` is a direct dependency on purpose (Node builtin removed;
  markdown-it needs it).
- npm `overrides` pins `react-dom` to Expo's exact `react` version —
  expo-router's server bits float it to latest otherwise and break
  `npm ci`.
- Voice features (`expo-speech-recognition`, `expo-audio`) are native
  modules pinned to the SDK; re-verify them on-device after any native
  rebuild.
- Keep `expo.install.exclude` empty; fix version drift with
  `npx expo install --fix` instead of suppressing expo-doctor.
