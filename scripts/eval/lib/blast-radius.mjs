import { clamp01, matchesGlob } from "./types.mjs";

// Blast radius: did the change touch only what it should have?
//
// An unexpectedly wide diff is a smell even when every line is individually
// correct — it means the agent wandered outside its slice, and every extra
// file is a file a reviewer now has to read. This dimension penalizes two
// distinct failures:
//
//   1. touching files outside the spec's `expectedFiles` allowlist
//   2. touching more files than `maxBlastRadius`, even if all are in-scope
//
// Returns { score, unexpected, overBudget, touched } so the scorecard can
// explain *why* a diff lost points, not just that it did.
export function scoreBlastRadius(task) {
  const changed = task.attempt.filesChanged ?? [];
  const touched = changed.length;

  const unexpectedFiles = changed
    .map((f) => f.path)
    .filter((p) => !task.expectedFiles.some((pat) => matchesGlob(pat, p)));

  const overBudget = Math.max(0, touched - task.maxBlastRadius);

  // Each out-of-scope file is a hard 0.25 hit; each file over the budget is a
  // softer 0.1 hit. A clean, in-scope diff scores 1.0.
  const score = clamp01(1 - 0.25 * unexpectedFiles.length - 0.1 * overBudget);

  return {
    score,
    touched,
    unexpected: unexpectedFiles,
    overBudget,
  };
}
