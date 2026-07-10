# Machine-readable context

Context windows end. Decisions don't. This directory holds the durable,
queryable memory that keeps a months-long, agent-driven build coherent — the
things a human would otherwise have to remember and re-explain every session.

The design principle: **if the agent (or CI) needs to know it, put it in a
format they can query — not in prose nobody re-reads.**

## The artifacts

| File | What it holds | Consumed by |
| --- | --- | --- |
| [`lessons.jsonl`](./lessons.jsonl) | One record per *closed* correction — a constraint learned the hard way, with commit evidence | the agent (via the path resolver); hard-gated by [`check:lessons`](../../scripts/check-lessons-ledger.mjs) |
| [`roadmap.jsonl`](./roadmap.jsonl) | One record per part, with status and the globs it `affects` | the path resolver; the citation report |

Alongside these, [ADRs](../architecture/) carry `affects:` globs in their front
matter, and the [path resolver](../../scripts/context-for-paths.mjs) stitches
all three together.

## The read path

```bash
# "What governs the file I'm about to change?"
npm run context -- packages/server/src/domain/orders/commands.ts

# In CI: feed the changed files, get the governing ADRs / parts / lessons
git diff --name-only origin/main... | node scripts/context-for-paths.mjs
```

This is the whole point. Instead of trusting that the right rule happens to be
in the context window, the agent *asks* which ADRs, roadmap parts, and lessons
govern the paths it's touching — and gets a precise answer.

## Lessons: backward-looking by construction

A lesson is not a to-do. It records a constraint that's already been
discovered and closed, with the commit that closed it as evidence. It has no
`Trigger` field — there's nothing left to do, only something to *know*. That's
what separates it from tech-debt (an open fix) or a scope-backlog item (a
future capability).

A lesson earns its place when a correction revealed a constraint: an approach
that failed *after* passing its gate, a reviewer catch that exposed a wrong
assumption, a reversal of a shipped decision. See the real-shaped records
(LSN-001 through LSN-020) in [`lessons.jsonl`](./lessons.jsonl) — each one is
a scar, and each one points at the rule or method doc it hardened into.

One deliberate outlier: `LSN-004`'s `paths` glob is `"**"` — scope discipline
governs every path, so it is the one intentionally ambient lesson; every other
record scopes itself to the paths where its constraint is local.

## Why JSONL

One record per line means: append without merge conflicts, grep without a
parser, and validate line-by-line. `grep -F '"status":"active"' lessons.jsonl`
is the whole query language. The [validator](../../scripts/check-lessons-ledger.mjs)
enforces the schema so the grep-ability never rots.

## The gate/warn split

- [`check:lessons`](../../scripts/check-lessons-ledger.mjs) is a **hard gate**
  — a malformed lesson breaks the consumers that read it, so it blocks.
- [`check:context-citation`](../../scripts/check-context-citation.mjs) is
  **warn-only** — "is every reference wired and every part documented?" is an
  adoption metric, and gating adoption metrics just teaches people to game
  them.

That split — block what breaks a consumer, warn on what's merely incomplete —
is the same judgment the rule tiers make ([BLOCKING] vs [SILENT-DRIFT]).
