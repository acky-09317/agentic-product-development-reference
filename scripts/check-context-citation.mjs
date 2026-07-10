#!/usr/bin/env node
// Context-integrity report — WARN-ONLY by design (always exits 0).
//
// The machine-readable context (roadmap, lessons, ADRs) is only useful if its
// cross-references resolve: a roadmap part's `spec`, a lesson's `rule`, an
// ADR's file. This check verifies those pointers and prints a coverage summary.
//
// It is deliberately NOT a gate. The lessons ledger schema is hard-gated
// (check-lessons-ledger.mjs) because a malformed record breaks consumers; but
// "is every reference perfectly wired and every part documented?" is an
// adoption metric, and gating adoption metrics just teaches people to game
// them. This prints signal; humans act on it. (See the real-world posture:
// the lessons gate blocks, the citation check warns.)
//
//   node scripts/check-context-citation.mjs
//   CHECK_FORMAT=json node scripts/check-context-citation.mjs

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const asJson = process.env.CHECK_FORMAT === "json";

const loadJsonl = (rel) =>
  readFileSync(join(ROOT, rel), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

const roadmap = loadJsonl("docs/structured/roadmap.jsonl");
const lessons = loadJsonl("docs/structured/lessons.jsonl");

const warnings = [];
const exists = (rel) => existsSync(join(ROOT, rel));

for (const part of roadmap) {
  if (part.spec && !exists(part.spec))
    warnings.push(`roadmap ${part.id}: spec "${part.spec}" does not exist`);
}
for (const lesson of lessons) {
  if (lesson.rule && !exists(lesson.rule))
    warnings.push(`lesson ${lesson.id}: rule "${lesson.rule}" does not exist`);
}

const byStatus = (arr, s) => arr.filter((x) => x.status === s).length;
const summary = {
  roadmap: {
    shipped: byStatus(roadmap, "shipped"),
    inFlight: byStatus(roadmap, "in-flight"),
    planned: byStatus(roadmap, "planned"),
  },
  lessons: {
    active: byStatus(lessons, "active"),
    superseded: byStatus(lessons, "superseded"),
  },
  brokenReferences: warnings.length,
};

if (asJson) {
  console.log(JSON.stringify({ ok: true, warnings, summary }, null, 2));
} else {
  console.log("\nContext integrity (warn-only):");
  console.log(
    `  roadmap:  ${summary.roadmap.shipped} shipped · ${summary.roadmap.inFlight} in-flight · ${summary.roadmap.planned} planned`,
  );
  console.log(
    `  lessons:  ${summary.lessons.active} active · ${summary.lessons.superseded} superseded`,
  );
  if (warnings.length === 0) {
    console.log("  ✓ every roadmap spec and lesson rule reference resolves\n");
  } else {
    console.log(`  ⚠ ${warnings.length} broken reference(s) — warn only, not blocking:`);
    for (const w of warnings) console.log(`    - ${w}`);
    console.log();
  }
}

// Warn-only: always succeed.
process.exit(0);
