# Contributing to prog-strength-mobile

This guide applies to human and AI contributors alike. For repo
orientation (architecture, conventions, gotchas), read
[AGENTS.md](AGENTS.md) first; for setup and the release pipeline, the
[README](README.md).

## TL;DR

1. Branch from `main`: `type/short-description` (e.g. `feat/run-detail-charts`).
2. Make the change; verify with `npm run typecheck && npm run lint` and
   the iOS simulator for UI work.
3. Commit in [Conventional Commits](https://www.conventionalcommits.org/)
   format — hooks enforce it.
4. Push and open a PR against `main` with a conventional-format title.
5. CI must be green to merge. PRs are squash-merged; the PR title
   becomes the commit on `main`.
6. Merging **is** releasing: the pipeline ships an OTA update (JS-only
   change) or a TestFlight build (native change) automatically.

## Branches

Branch names follow `type/short-kebab-description`, where `type`
matches the commit type the work will land as: `feat/`, `fix/`,
`chore/`, `docs/`, `refactor/`, `ci/`. Branch from an up-to-date
`main`; `main` is the release branch and there are no others.

## Commit messages

Every commit must be a valid
[Conventional Commit](https://www.conventionalcommits.org/en/v1.0.0/),
validated by commitlint (`@commitlint/config-conventional`) in a Husky
`commit-msg` hook locally and again in CI (the repo may adopt
semantic-release later; conventional history is the prerequisite):

```
type(scope): subject

optional body explaining why, wrapped at ~72 chars
```

- **Allowed types**: `feat`, `fix`, `docs`, `style`, `refactor`,
  `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **Scope** is optional but encouraged — the surface touched:
  `feat(running): …`, `fix(settings): …`, `ci: …`.
- **Subject** in lower case, imperative mood, no trailing period.
- **Breaking changes** get a `!` (`feat(api)!: …`) or a
  `BREAKING CHANGE:` footer.

## Local hooks (installed automatically)

`npm install` runs `husky` via the `prepare` script — no manual setup.

- **pre-commit**: `lint-staged` (eslint --fix + prettier on staged
  files) followed by a full `tsc --noEmit`.
- **commit-msg**: commitlint.

If your environment manages node with nvm and hooks fail with
`npx: command not found`, create `~/.config/husky/init.sh` exporting
your node bin dir onto `PATH` (husky sources it before every hook).

Hooks are a convenience, not the gate — CI re-runs everything, so
`--no-verify` in an emergency is recoverable, just expect CI to catch
what you skipped.

## PR status checks

`ci.yml` runs on every PR to `main`:

| Check                                | What it verifies                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `lint / format / typecheck / doctor` | eslint, `prettier --check`, `tsc --noEmit`, and `expo-doctor` (dependency/SDK/config health — keep it at 19/19) |
| `conventional commits`               | every commit in the PR **and** the PR title parse as conventional commits                                       |

The PR title check matters because PRs squash-merge: the title becomes
the commit subject on `main`, which the release pipeline (and any
future semantic-release) reads.

## What "done" means here

There is no JS test runner (deliberate — see AGENTS.md). A change is
done when: typecheck + lint + format + expo-doctor pass, the surface
was exercised in the iOS simulator (or on-device for native-module
changes), loading/empty/error states exist for new lists/charts, and
the mobile UI floor from AGENTS.md is met (44pt targets, safe areas,
no horizontally-scrolling charts).

## Native modules

Adding one is fine, but say so explicitly in the PR description: the
merge will produce a ~30-minute TestFlight build instead of a ~30-second
OTA update, and voice features should be re-smoke-tested on the device
afterward. Run `npx expo install <pkg>` (never bare `npm install`) so
the version matches the SDK.
