// @expo/fingerprint config — keeps the fingerprint identical whether it
// is computed on a dev machine / CI runner (clean checkout) or on the
// EAS builder mid-build (after prebuild + pod install). Without this,
// builds fail in the "Configure expo-updates" phase with a runtime
// version mismatch:
//
//   - `expo prebuild` on the builder generates ios/ (CNG output —
//     fully derived from app.json + plugins, which ARE fingerprinted)
//   - `pod install` runs React Native codegen, which writes generated
//     code into the package dirs of codegen-enabled libraries
//     (reanimated, worklets, screens, svg, safe-area-context),
//     changing their rncoreAutolinking hashes
//
// Ignoring derived outputs only — package versions and config inputs
// stay fingerprinted, so real native changes still rotate the runtime.
/** @type {import('@expo/fingerprint').Config} */
module.exports = {
  ignorePaths: [
    "ios/**",
    "android/**",
    "node_modules/**/ios/generated/**",
    "node_modules/**/android/generated/**",
  ],
};
