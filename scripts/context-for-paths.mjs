#!/usr/bin/env node
// Path → governing-context resolver.
//
// Given a set of file paths, prints the ADRs, roadmap parts, and lessons whose
// `affects` / `paths` globs match — i.e. "what governs this file?" This is the
// read-side of the machine-readable context: instead of hoping the right rules
// are in the agent's context window, the agent (or CI) queries for them.
//
//   node scripts/context-for-paths.mjs packages/server/src/domain/orders/commands.ts
//   git diff --name-only origin/main... | node scripts/context-for-paths.mjs
//   npm run context -- packages/db/src/schema/domains/catalog/skus.ts
//
// Reads: docs/structured/roadmap.jsonl, docs/structured/lessons.jsonl,
//        docs/architecture/*.md front matter.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function globToRe(glob) {
  const re = glob
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp("^" + re + "$");
}

const matchesAny = (globs, path) => globs.some((g) => globToRe(g).test(path));

// ---- load sources ----

function loadJsonl(rel) {
  return readFileSync(join(ROOT, rel), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

// Minimal front-matter reader: pulls id/title/affects out of the leading
// --- ... --- block. affects is a YAML list of `  - glob` lines.
function loadAdrs() {
  const dir = join(ROOT, "docs/architecture");
  const out = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    const text = readFileSync(join(dir, file), "utf8");
    const m = text.match(/^---\n([\s\S]*?)\n---/);
    if (!m) continue;
    const fm = m[1];
    const id = (fm.match(/^id:\s*(.+)$/m) ?? [])[1]?.trim();
    const title = (fm.match(/^title:\s*(.+)$/m) ?? [])[1]?.trim();
    const affects = [];
    const affectsBlock = fm.match(/^affects:\n((?:[ \t]+-[^\n]*\n?)+)/m);
    if (affectsBlock) {
      for (const line of affectsBlock[1].split("\n")) {
        const g = line.match(/^\s*-\s*(.+)$/);
        if (g) affects.push(g[1].trim());
      }
    }
    if (id) out.push({ id, title, affects, file: `docs/architecture/${file}` });
  }
  return out;
}

// ---- inputs ----

function readInputs() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (args.length) return args;
  try {
    return readFileSync(0, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const paths = readInputs();
if (paths.length === 0) {
  console.error("usage: context-for-paths.mjs <path> [<path>...]   (or pipe paths on stdin)");
  process.exit(2);
}

const adrs = loadAdrs();
const roadmap = loadJsonl("docs/structured/roadmap.jsonl");
const lessons = loadJsonl("docs/structured/lessons.jsonl").filter((l) => l.status === "active");

const hitAdrs = adrs.filter((a) => paths.some((p) => matchesAny(a.affects, p)));
const hitParts = roadmap.filter((r) => paths.some((p) => matchesAny(r.affects, p)));
const hitLessons = lessons.filter((l) => paths.some((p) => matchesAny(l.paths, p)));

const covered = new Set();
for (const p of paths) {
  if (
    adrs.some((a) => matchesAny(a.affects, p)) ||
    roadmap.some((r) => matchesAny(r.affects, p)) ||
    lessons.some((l) => matchesAny(l.paths, p))
  )
    covered.add(p);
}

// ---- output ----

console.log(`\nGoverning context for ${paths.length} path(s):\n`);

if (hitAdrs.length) {
  console.log("  Architecture decisions:");
  for (const a of hitAdrs) console.log(`    • ${a.id} — ${a.title}  (${a.file})`);
  console.log();
}
if (hitParts.length) {
  console.log("  Roadmap parts:");
  for (const r of hitParts) console.log(`    • ${r.id} [${r.status}] — ${r.title}  (spec: ${r.spec})`);
  console.log();
}
if (hitLessons.length) {
  console.log("  Active lessons (constraints learned the hard way):");
  for (const l of hitLessons) console.log(`    • ${l.id} — ${l.title}\n        → ${l.constraint.split(". ")[0]}.  (${l.rule})`);
  console.log();
}

if (!hitAdrs.length && !hitParts.length && !hitLessons.length) {
  console.log("  (no governing ADRs, roadmap parts, or lessons matched)\n");
}

const uncovered = paths.filter((p) => !covered.has(p));
if (uncovered.length) {
  console.log(`  ⚠ no governing context found for: ${uncovered.join(", ")}\n`);
}
