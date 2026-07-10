#!/usr/bin/env node
// Validates the lessons ledger (docs/structured/lessons.jsonl) against its
// schema. This is a HARD gate — the ledger is machine-readable context the
// agent and other checks consume, so a malformed record is a broken pointer,
// not a cosmetic slip. Exit 1 on any violation.
//
//   node scripts/check-lessons-ledger.mjs
//   CHECK_FORMAT=json node scripts/check-lessons-ledger.mjs
//
// Contrast with check-context-citation.mjs, which is deliberately warn-only:
// a ledger with a bad record must block; adoption metrics should not.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = join(ROOT, "docs/structured/lessons.jsonl");
const asJson = process.env.CHECK_FORMAT === "json";

const STATUSES = new Set(["active", "superseded", "retired"]);
const ID_RE = /^LSN-\d{3}$/;
const DATE_RE = /^\d{4}-\d{2}$/; // month precision — day-level dates are a correlatable time series
const REQUIRED = ["id", "status", "surfaced", "title", "constraint", "evidence", "paths", "rule"];

const violations = [];
const seenIds = new Set();

const raw = readFileSync(LEDGER, "utf8");
const lines = raw.split("\n").filter((l) => l.trim().length > 0);

lines.forEach((line, i) => {
  const n = i + 1;
  let rec;
  try {
    rec = JSON.parse(line);
  } catch (err) {
    violations.push({ line: n, id: null, problem: `not valid JSON: ${err.message}` });
    return;
  }
  for (const field of REQUIRED) {
    if (!(field in rec)) violations.push({ line: n, id: rec.id ?? null, problem: `missing required field "${field}"` });
  }
  if (rec.id && !ID_RE.test(rec.id))
    violations.push({ line: n, id: rec.id, problem: `id must match LSN-NNN` });
  if (rec.id) {
    if (seenIds.has(rec.id)) violations.push({ line: n, id: rec.id, problem: `duplicate id` });
    seenIds.add(rec.id);
  }
  if (rec.status && !STATUSES.has(rec.status))
    violations.push({ line: n, id: rec.id, problem: `status "${rec.status}" not in {${[...STATUSES].join(", ")}}` });
  if (rec.surfaced && !DATE_RE.test(rec.surfaced))
    violations.push({ line: n, id: rec.id, problem: `surfaced must be YYYY-MM` });
  if (rec.paths && !Array.isArray(rec.paths))
    violations.push({ line: n, id: rec.id, problem: `paths must be an array` });
});

const activeCount = lines.filter((l) => {
  try {
    return JSON.parse(l).status === "active";
  } catch {
    return false;
  }
}).length;

if (asJson) {
  console.log(JSON.stringify({ ok: violations.length === 0, records: lines.length, active: activeCount, violations }, null, 2));
} else if (violations.length === 0) {
  console.log(`✓ lessons ledger valid — ${lines.length} records (${activeCount} active)`);
} else {
  console.error(`✗ lessons ledger: ${violations.length} violation(s)`);
  for (const v of violations) console.error(`  line ${v.line}${v.id ? ` (${v.id})` : ""}: ${v.problem}`);
}

process.exit(violations.length === 0 ? 0 : 1);
