#!/usr/bin/env node
// GP-2: assert the required E2E lane runs against the exact certified stack.
//
// Reads certified-stack.json and verifies each pinned package resolves to that
// exact version in the installed dependency graph. Any drift fails the gate so
// the certified lane can never silently test a different stack than the one
// recorded. The latest-package canary (GP-3) is a separate, non-certifying lane
// and must never rewrite certified-stack.json.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const certified = JSON.parse(
  readFileSync(join(here, "..", "certified-stack.json"), "utf8"),
);

// Resolve a package by walking up from the repo looking for a hoisted
// node_modules/<pkg>/package.json. Does not rely on package "exports", which
// commonly blocks the `./package.json` subpath.
function resolvePackageVersion(pkg) {
  const parts = pkg.split("/");
  let dir = here;
  for (;;) {
    const candidate = join(dir, "node_modules", ...parts, "package.json");
    if (existsSync(candidate)) {
      return JSON.parse(readFileSync(candidate, "utf8")).version;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const TRACKED = [
  ...Object.keys(certified.packages),
  "@openagentaudit/adapters",
  "@openagentaudit/core",
  "@openagentaudit/passport",
  "@openagentaudit/schema",
];

const resolved = {};
for (const pkg of TRACKED) {
  resolved[pkg] = resolvePackageVersion(pkg);
}

console.log("resolved stack:");
for (const [pkg, version] of Object.entries(resolved)) {
  console.log(`  ${pkg}@${version ?? "(not installed)"}`);
}

let failed = false;
for (const [pkg, expected] of Object.entries(certified.packages)) {
  if (resolved[pkg] !== expected) {
    console.error(
      `CERTIFIED STACK MISMATCH: ${pkg} resolved ${resolved[pkg]}, expected ${expected} (${certified.aep_certified_target})`,
    );
    failed = true;
  }
}

if (failed) {
  console.error(
    "The required E2E lane must run against the certified stack. Re-certify before changing certified-stack.json.",
  );
  process.exit(1);
}

console.log(
  `certified stack verified against ${certified.aep_certified_target}`,
);
