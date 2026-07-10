// Regression tests for the path → governing-context resolver.
//
// Pins the affects-parser fix: the original front-matter regex used a lazy
// capture with a multiline `$` in its lookahead, so it stopped after the FIRST
// glob line of every `affects:` block — shipping 9 of this repo's 12 ADR globs
// dead while the resolver looked perfectly healthy on first-glob paths. These probes hit
// globs that only the fixed parser reaches.
//
// Run: npm test   (node --test scripts/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "context-for-paths.mjs");
const resolve = (path) => execFileSync(process.execPath, [CLI, path], { encoding: "utf8" });

test("a packages/db/src/rls/** path resolves ADR-001 (second affects glob)", () => {
  const out = resolve("packages/db/src/rls/policies.ts");
  assert.match(out, /ADR-001/);
});

test("a packages/server/src/domain/** path resolves ADR-002 (second affects glob)", () => {
  const out = resolve("packages/server/src/domain/orders/commands.ts");
  assert.match(out, /ADR-002/);
});

test("a catalog schema path resolves its roadmap part and lesson", () => {
  const out = resolve("packages/db/src/schema/domains/catalog/listings.ts");
  assert.match(out, /PART-C/);
  assert.match(out, /LSN-002/);
});
