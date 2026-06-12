// @expo/fingerprint config — keeps the fingerprint identical whether it
// is computed on a dev machine / CI runner (clean checkout) or on the
// EAS builder mid-build (after prebuild + pod install). Without this,
// builds fail in the "Configure expo-updates" phase with a runtime
// version mismatch:
//
//   - `expo prebuild` on the builder generates ios/ (CNG output —
//     fully derived from app.json + plugins, which ARE fingerprinted).
//     NOTE: the fingerprint reports the native dir as a dir-type
//     source whose path is exactly `ios` — a bare `ios` entry is
//     required because the glob `ios/**` matches children only, not
//     the directory source itself.
//   - `pod install` mutates package dirs of RN-core autolinked
//     libraries on the builder (their rncoreAutolinking hashes change
//     vs the clean checkout).
//
// Ignoring derived outputs only — package versions and config inputs
// stay fingerprinted, so real native changes still rotate the runtime.
// If the builder still drifts, the eas-build-on-error hook
// (scripts/fingerprint-debug.js) dumps what changed.
/** @type {import('@expo/fingerprint').Config} */
module.exports = {
  ignorePaths: [
    "ios",
    "ios/**",
    "android",
    "android/**",
    "node_modules/**/ios/generated/**",
    "node_modules/**/android/generated/**",
  ],
};
