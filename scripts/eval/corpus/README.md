# Eval corpus

Each `task-NNN-*.json` file is a **recorded agent attempt**: a task spec plus
the extracted signals the [diff scorer](../score-diff.mjs) needs to grade it.
The scorer operates on these records — it does not re-run the agent — which is
what makes the eval deterministic, fast, and reviewable.

## Record shape

See [`../lib/types.mjs`](../lib/types.mjs) for the authoritative typedefs. In
brief:

```jsonc
{
  "id": "task-NNN-short-slug",
  "title": "Human-readable task title",
  "prompt": "The instruction the agent was given",
  "acceptanceCriteria": ["...", "..."],      // what 'correct' means
  "expectedFiles": ["path", "glob/**"],      // where a correct change belongs
  "maxBlastRadius": 6,                        // max files a correct change touches
  "attempt": {
    "summary": "one line: what the agent actually did",
    "filesChanged": [{ "path": "...", "additions": 0, "deletions": 0 }],
    "criteriaMet": [true, false],            // aligned 1:1 to acceptanceCriteria
    "hasTests": true,
    "tenantScopePreserved": true,            // blocking dimension
    "conventionViolations": ["..."]
  }
}
```

## How the signals are produced (in the real system)

Here the records are hand-authored to illustrate the range. In practice each
field comes from a cheap extraction pass over the agent's real output:

- `filesChanged` → the git diff (`git diff --numstat`)
- `criteriaMet` → a checklist pass (static checks where possible, a judge where not)
- `tenantScopePreserved` → a grep/AST check for the `orgId` predicate on new queries, plus the identity-gate check on recovery paths (the LSN-007 class)
- `conventionViolations` → the repo's own CI check scripts, run against the diff

The scorer's contract is just the record shape — swap the extraction however
you like.

## Adding a task

Drop a new file in this directory following the shape above. No code change is
needed; `npm run eval` picks it up on the next run. Keep the id prefix
(`task-NNN-`) so the scorecard sorts predictably.
