#!/usr/bin/env node
/**
 * Native-fingerprint guard.
 *
 * The runtime version is a literal string in app.json (no fingerprint
 * policy — the EAS builder's fingerprint recomputation diverges from
 * CI's and fails builds; see git history of fingerprint.config.js).
 * The fingerprint is still the change DETECTOR: `.native-fingerprint`
 * records the canonical hash, and CI fails any PR whose fingerprint
 * moved without a runtimeVersion bump — which is what keeps OTA
 * updates from ever targeting a binary with mismatched native code.
 *
 *   node scripts/native-fingerprint.js check    # CI / verification
 *   node scripts/native-fingerprint.js update   # after a native change
 *
 * Always computed via `expo-updates fingerprint:generate` so every
 * environment uses the same (project-bundled) implementation.
 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");

const FILE = ".native-fingerprint";

function currentFingerprint() {
  const out = execSync("npx expo-updates fingerprint:generate --platform ios", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(out).hash;
}

const mode = process.argv[2];
const hash = currentFingerprint();

if (mode === "update") {
  fs.writeFileSync(FILE, hash + "\n");
  console.log(`${FILE} updated: ${hash}`);
  process.exit(0);
}

if (mode === "check") {
  const recorded = fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8").trim() : "<missing>";
  if (recorded === hash) {
    console.log(`native fingerprint OK: ${hash}`);
    process.exit(0);
  }
  console.error(
    [
      `Native fingerprint changed:`,
      `  recorded (${FILE}): ${recorded}`,
      `  computed:           ${hash}`,
      ``,
      `This change affects the native binary. To ship it safely:`,
      `  1. bump "runtimeVersion" in app.json (it's a plain counter)`,
      `  2. run: npm run fingerprint:update`,
      `  3. commit both files in this PR`,
      ``,
      `The release pipeline will then cut a new TestFlight build for the`,
      `new runtime instead of publishing an incompatible OTA update.`,
    ].join("\n"),
  );
  process.exit(1);
}

console.error("usage: node scripts/native-fingerprint.js <check|update>");
process.exit(2);
