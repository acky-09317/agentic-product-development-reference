#!/usr/bin/env node
// Diff-scorer — the entry point for the eval harness.
//
//   node scripts/eval/score-diff.mjs <corpus-dir> [--format=json] [--gate]
//
// Loads every task record in the corpus directory, scores each recorded agent
// attempt across the weighted dimensions, routes borderline cases to the judge,
// and prints a scorecard. Zero external dependencies — runs on plain Node ≥20.
//
// Flags:
//   --format=json   emit machine-readable results instead of the table
//   --gate          exit non-zero if any task fails (for CI). Default is
//                   report mode (always exit 0) so a demo run always "works"
//                   while still visibly surfacing a seeded regression.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scoreDimensions, weightedScore } from "./lib/dimensions.mjs";
import { judge } from "./lib/judge.mjs";

const args = process.argv.slice(2);
const corpusDir = args.find((a) => !a.startsWith("--")) ?? "scripts/eval/corpus";
const asJson = args.includes("--format=json");
const gate = args.includes("--gate");

const VERDICT_GLYPH = { pass: "✅", borderline: "🟡", fail: "❌" };

async function main() {
  const files = readdirSync(corpusDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  if (files.length === 0) {
    console.error(`No task records (*.json) found in ${corpusDir}`);
    process.exit(2);
  }

  const results = [];
  for (const file of files) {
    const task = JSON.parse(readFileSync(join(corpusDir, file), "utf8"));
    const dims = scoreDimensions(task);
    const weighted = weightedScore(dims);
    const verdict = await judge(task, dims, weighted);
    results.push({ id: task.id, title: task.title, weighted, dims, verdict });
  }

  if (asJson) {
    console.log(JSON.stringify({ results }, null, 2));
  } else {
    renderTable(results);
  }

  const failed = results.filter((r) => r.verdict.verdict === "fail");
  if (gate && failed.length > 0) process.exit(1);
}

function renderTable(results) {
  const line = "─".repeat(72);
  console.log(`\n  Agentic Eval — diff scorecard   (${results.length} tasks)\n${line}`);

  for (const r of results) {
    const g = VERDICT_GLYPH[r.verdict.verdict] ?? "•";
    console.log(
      `\n${g}  ${r.title}` +
        `\n   score ${r.weighted.toFixed(2)}   verdict ${r.verdict.verdict.toUpperCase()}` +
        `  (${r.verdict.source})`,
    );
    for (const d of r.dims) {
      const bar = renderBar(d.score);
      const flag = d.blocking && d.score === 0 ? "  ⛔ BLOCKING" : "";
      console.log(
        `     ${d.key.padEnd(13)} ${bar} ${d.score.toFixed(2)}  ${d.note}${flag}`,
      );
    }
    console.log(`     ↳ ${r.verdict.rationale}`);
  }

  const pass = results.filter((r) => r.verdict.verdict === "pass").length;
  const border = results.filter((r) => r.verdict.verdict === "borderline").length;
  const fail = results.filter((r) => r.verdict.verdict === "fail").length;
  console.log(
    `\n${line}\n  ${pass} pass · ${border} borderline · ${fail} fail` +
      `   —   run with --gate to fail CI on any ❌\n`,
  );
}

function renderBar(score) {
  const filled = Math.round(score * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
