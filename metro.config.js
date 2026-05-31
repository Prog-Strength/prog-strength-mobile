// Expo's default Metro config + NativeWind's CSS pipeline. NativeWind
// reads global.css at build time to register every Tailwind utility,
// so the wrapper has to know where that file lives.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Polyfill the Node built-in `punycode` module so transitive deps
// that import it can resolve in React Native's runtime. The
// markdown-it package (pulled in via react-native-markdown-display
// for chat-bubble rendering) does `require('punycode')`, which is
// a removed-in-Node-21 built-in that RN never had to begin with.
// The userland `punycode` package on npm is a drop-in replacement;
// this alias makes every transitive `require('punycode')` resolve
// to it.
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  punycode: path.resolve(__dirname, "node_modules/punycode"),
};

module.exports = withNativeWind(config, { input: "./global.css" });
