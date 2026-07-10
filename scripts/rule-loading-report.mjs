#!/usr/bin/env node
// Rule-loading telemetry — the empirical complement to context engineering.
//
//   node scripts/rule-loading-report.mjs [logfile] [--json]
//   npm run rules:report
//
// The context-engineering pillar (docs/methodology/context-engineering.md)
// ARGUES that rules should load by relevance — a small always-loaded core, the
// rest path-scoped so a batch only pays for the rules its files invoke. This
// script MEASURES whether that's actually happening.
//
// The pipeline (mirrors a real setup): a hook appends one JSONL line per loaded
// instruction file per session to an InstructionsLoaded log; this script reads
// it. Each line: { session, phase, file, tier, tokens }. The ambient/scoped
// split is derived from disk (the rule's `paths:` frontmatter) so the report
// self-updates as rules are re-scoped — it never hard-codes the roster.
//
// It reports four signals and grades them against PRE-REGISTERED thresholds
// (committed in CONFIG below, before the data — moving a threshold is a
// deliberate re-registration, not a per-run judgment call):
//
//   1. Tier + ambient floor  — the fixed cost every fresh session pays
//   2. Realized per-session cost — median / p90 total tokens loaded
//   3. Fire rates — PROMOTE-BACK (a scoped rule firing in >80% of sessions is
//      effectively ambient) and ZERO-FIRE (never fired → likely a glob gap)
//   4. Flip regressions — a scoped rule loading at session_start is a fault
//
// Report-only. Whether to promote/demote a rule is an operator call against
// these signals — this instrument measures COST, not whether fidelity held
// (that's the eval's job). Same separation the real system draws.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Pre-registered thresholds. Changing one is a re-registration, not a per-run call.
// expectedAmbientFloorTokens is the COMMITTED baseline the measured floor is
// compared against (± ambientTolerancePct).
const CONFIG = { promoteBackFireRate: 0.8, ambientTolerancePct: 10, expectedAmbientFloorTokens: 600 };

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const logFile =
  args.find((a) => !a.startsWith("--")) ?? "scripts/telemetry/instructions-loaded.sample.jsonl";

// ---- roster: classify each numbered rule ambient vs scoped, from disk ----
function loadRoster() {
  const dir = join(ROOT, ".claude/rules");
  const roster = {};
  for (const f of readdirSync(dir)) {
    const m = f.match(/^(\d{2})-.*\.md$/);
    if (!m) continue; // skip README etc.
    const text = readFileSync(join(dir, f), "utf8");
    const hasPaths = /^---\n[\s\S]*?\bpaths:/m.test(text);
    roster[`.claude/rules/${f}`] = hasPaths ? "scoped" : "ambient";
  }
  return roster;
}

// ---- load events ----
const events = readFileSync(join(ROOT, logFile), "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const roster = loadRoster();
const sessions = [...new Set(events.map((e) => e.session))];
const scopedFiles = Object.entries(roster).filter(([, t]) => t === "scoped").map(([f]) => f);
const ambientFiles = Object.entries(roster).filter(([, t]) => t === "ambient").map(([f]) => f);

// 1. ambient floor — sum of ambient tokens loaded at session_start (dedup per file)
const ambientTokens = {};
for (const e of events) {
  if (roster[e.file] === "ambient") ambientTokens[e.file] = e.tokens;
}
const ambientFloor = Object.values(ambientTokens).reduce((a, b) => a + b, 0);

// 2. per-session total token cost
const perSession = sessions.map((s) => ({
  session: s,
  tokens: events.filter((e) => e.session === s).reduce((a, e) => a + e.tokens, 0),
}));
const totals = perSession.map((p) => p.tokens).sort((a, b) => a - b);
const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];
const median = pct(totals, 50);
const p90 = pct(totals, 90);

// 3. fire rates per scoped rule
const fireRates = scopedFiles.map((f) => {
  const firedIn = new Set(events.filter((e) => e.file === f).map((e) => e.session));
  const rate = firedIn.size / sessions.length;
  let signal = "ok";
  if (firedIn.size === 0) signal = "ZERO-FIRE";
  else if (rate > CONFIG.promoteBackFireRate) signal = "PROMOTE-BACK";
  return { file: f, firedIn: firedIn.size, rate, signal };
});

// 4. flip regressions — scoped rule loaded at session_start
const flipRegressions = events
  .filter((e) => roster[e.file] === "scoped" && e.phase === "session_start")
  .map((e) => ({ session: e.session, file: e.file }));

const report = {
  sessions: sessions.length,
  ambientFloor,
  ambientFiles,
  cost: { median, p90 },
  fireRates,
  flipRegressions,
  thresholds: CONFIG,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

// ---- human report ----
const short = (f) => f.replace(".claude/rules/", "");
const line = "─".repeat(72);
console.log(`\n  Rule-loading telemetry   (${sessions.length} sessions, log: ${logFile})\n${line}`);

console.log(`\n  [1] Ambient floor — the fixed cost every fresh session pays`);
console.log(`      ${ambientFloor} tokens  (${ambientFiles.map(short).join(", ") || "none"})`);
const floorDrift =
  ((ambientFloor - CONFIG.expectedAmbientFloorTokens) / CONFIG.expectedAmbientFloorTokens) * 100;
if (Math.abs(floorDrift) <= CONFIG.ambientTolerancePct) {
  console.log(
    `      OK — within ${CONFIG.ambientTolerancePct}% of the committed baseline (${CONFIG.expectedAmbientFloorTokens} tokens)`,
  );
} else {
  console.log(
    `      ⚠ AMBIENT FLOOR GREW — ${ambientFloor} vs committed baseline ${CONFIG.expectedAmbientFloorTokens} (${floorDrift > 0 ? "+" : ""}${floorDrift.toFixed(0)}%)`,
  );
}
console.log(`      Scoped rules (${scopedFiles.length}) load only on a matching read.`);

console.log(`\n  [2] Realized per-session cost`);
console.log(`      median ${median} · p90 ${p90} tokens`);
for (const p of perSession) console.log(`      ${p.session.padEnd(12)} ${p.tokens}`);

console.log(`\n  [3] Fire rates (scoped rules) — pre-registered signals`);
for (const r of fireRates) {
  const flag =
    r.signal === "PROMOTE-BACK"
      ? `  ⤴ PROMOTE-BACK (>${CONFIG.promoteBackFireRate * 100}% — effectively ambient)`
      : r.signal === "ZERO-FIRE"
        ? "  ⚠ ZERO-FIRE (never fired — likely a glob gap)"
        : "";
  console.log(`      ${short(r.file).padEnd(38)} ${(r.rate * 100).toFixed(0).padStart(3)}%  (${r.firedIn}/${sessions.length})${flag}`);
}

console.log(`\n  [4] Flip regressions — a scoped rule at session_start is a fault`);
if (flipRegressions.length === 0) {
  console.log(`      ✓ none — every scoped rule loaded on-read, not ambiently`);
} else {
  for (const r of flipRegressions)
    console.log(`      ✗ ${short(r.file)} loaded at session_start in ${r.session}  — FAULT`);
}

console.log(`\n${line}`);
console.log(`  Report only. Promote/demote is an operator call against these signals;`);
console.log(`  this measures COST — whether fidelity held is the eval's job (npm run eval).\n`);
