#!/usr/bin/env node
// Append one InstructionsLoaded record. The log format is the contract
// (see README.md); wire your own instruction-read hook to this appender.
//
//   node scripts/telemetry/log-instruction-load.mjs <log> <session> <phase> <file> <tier> <tokens>

import { appendFileSync } from "node:fs";

const [log, session, phase, file, tier, tokens] = process.argv.slice(2);
if (!log || !session || !phase || !file || !tier || !tokens) {
  console.error("usage: log-instruction-load.mjs <log> <session> <phase> <file> <tier> <tokens>");
  process.exit(2);
}

appendFileSync(log, JSON.stringify({ session, phase, file, tier, tokens: Number(tokens) }) + "\n");
