// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
// Last so it disables any stylistic rules that would fight Prettier —
// formatting is Prettier's job, linting is ESLint's.
const prettierConfig = require("eslint-config-prettier");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  prettierConfig,
]);
