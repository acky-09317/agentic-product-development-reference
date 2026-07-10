#!/usr/bin/env node
// Preservation-boundary check — a LIVE drift canary for THIS repo.
//
// Mirrors the mechanism documented in docs/methodology/preservation-boundaries.md
// and CLAUDE.md § Preservation boundaries: each directory carries an enforcement
// class and a committed baseline; a frozen mismatch or an append-only shrink
// exits 1. The count is crude on purpose — it can't say WHAT drifted, only THAT
// something did, which is enough to make an out-of-scope edit loud (LSN-004).
//
//   npm run check:preservation

import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The enforcement table. Baselines are committed literals — updating one is a
// deliberate re-baseline in the same commit as the change that moved it.
const BOUNDARIES = {
  "src/example": { class: "frozen", count: 6 },
  "scripts/eval/lib": { class: "frozen", count: 4 },
  "scripts/eval/corpus": { class: "append-only", min: 6 },
  "docs": { class: "append-only", min: 13 },
};

function countFiles(dir) {
  let n = 0;
  for (const entry of readdirSync(dir)) {
    if (entry === ".DS_Store") continue; // OS junk must never trip a canary
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) n += countFiles(p);
    else n += 1;
  }
  return n;
}

let failed = false;
for (const [rel, rule] of Object.entries(BOUNDARIES)) {
  const actual = countFiles(join(ROOT, rel));
  if (rule.class === "frozen" && actual !== rule.count) {
    console.error(`✗ ${rel}/ — frozen at ${rule.count} files, found ${actual}`);
    failed = true;
  } else if (rule.class === "append-only" && actual < rule.min) {
    console.error(`✗ ${rel}/ — append-only floor ${rule.min} files, found ${actual} (shrink = scope breach)`);
    failed = true;
  } else {
    console.log(`✓ ${rel}/ — ${rule.class} (${actual}${rule.class === "frozen" ? ` = ${rule.count}` : ` ≥ ${rule.min}`})`);
  }
}

if (failed) {
  console.error("\npreservation boundary breached — see docs/methodology/preservation-boundaries.md");
  process.exit(1);
}
console.log("\npreservation boundaries hold");
