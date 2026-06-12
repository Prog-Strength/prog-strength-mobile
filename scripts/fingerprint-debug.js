#!/usr/bin/env node
/**
 * EAS on-error diagnostic: when a build fails (the recurring case being
 * the "Configure expo-updates" fingerprint mismatch), dump a compact
 * per-subdirectory content hash of the packages whose fingerprints
 * drift between CI and the EAS builder, plus the native-dir state.
 * Comparing this output against the same script run locally pinpoints
 * exactly which files the builder mutates.
 *
 * Wired via the `eas-build-on-error` npm hook. Costs nothing on
 * successful builds.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PACKAGES = [
  "react-native-reanimated",
  "react-native-safe-area-context",
  "react-native-screens",
  "react-native-svg",
  "react-native-worklets",
];

function hashDir(dir) {
  const hash = crypto.createHash("sha1");
  const files = [];
  (function walk(d) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) files.push(p);
    }
  })(dir);
  for (const f of files) {
    hash.update(path.relative(dir, f));
    try {
      hash.update(fs.readFileSync(f));
    } catch {
      hash.update("<unreadable>");
    }
  }
  return { hash: hash.digest("hex").slice(0, 12), count: files.length };
}

console.log("=== fingerprint-debug ===");
console.log("cwd:", process.cwd());
console.log("ios/ exists:", fs.existsSync("ios"), "| android/ exists:", fs.existsSync("android"));
console.log("fingerprint.config.js exists:", fs.existsSync("fingerprint.config.js"));

for (const pkg of PACKAGES) {
  const root = path.join("node_modules", pkg);
  if (!fs.existsSync(root)) {
    console.log(`${pkg}: MISSING`);
    continue;
  }
  const subdirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const top = hashDir(root);
  console.log(`${pkg}: total ${top.hash} (${top.count} files)`);
  for (const sub of subdirs) {
    const h = hashDir(path.join(root, sub));
    console.log(`  ${sub}/: ${h.hash} (${h.count} files)`);
  }
  try {
    const v = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
    console.log(`  version: ${v}`);
  } catch {
    /* ignore */
  }
}
console.log("=== end fingerprint-debug ===");
