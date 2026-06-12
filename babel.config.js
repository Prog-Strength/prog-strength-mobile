// NativeWind v4 hooks into Babel two ways:
//   1. babel-preset-expo's `jsxImportSource` swaps the JSX runtime to
//      one that understands `className`.
//   2. "nativewind/babel" rewrites those className strings into the
//      style objects that React Native consumes at runtime.
// Both are required — the JSX swap on its own gives you className-aware
// JSX with nothing reading it.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"],
  };
};
