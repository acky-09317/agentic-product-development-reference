---
id: ADR-009
title: Durable context lives in machine-readable, CI-validated artifacts
status: accepted
affects:
  - docs/structured/**
  - docs/architecture/**
  - scripts/context-for-paths.mjs
  - scripts/check-lessons-ledger.mjs
---

# ADR-009 — Durable context lives in machine-readable, CI-validated artifacts

## Context

An agent has no long-term memory. Across a months-long build, the knowledge
that keeps the system coherent — *why* a decision was made, *what* went wrong
last time, *which* rules govern this file — has to live somewhere the agent can
reliably retrieve. Prose docs don't cut it: they're not queryable, they drift
from the code, and nobody re-reads a 400-line handbook on batch #40.

The naive alternatives all fail:

- **Put it all in the context window** — doesn't scale; dilutes attention;
  the window ends.
- **Put it in prose docs** — not queryable; drifts silently; unenforced.
- **Keep it in the human's head** — the exact thing we're trying not to depend
  on.

## Decision

Durable context lives in **structured, CI-validated artifacts**, each with a
one-line query and a validator:

| Artifact | Shape | Query | Validator |
| --- | --- | --- | --- |
| Lessons ledger | `docs/structured/lessons.jsonl` (`LSN-NNN`) | `grep -F '"status":"active"'` | `check:lessons` (hard) |
| Roadmap spine | `docs/structured/roadmap.jsonl` (one per part) | `grep -F '"status":"in-flight"'` | `check:context-citation` (warn) |
| ADR front matter | `docs/architecture/*.md` (`affects:` globs) | `head -20 <adr>` | the path resolver |
| Path → context | ADR + roadmap + lesson globs | `git diff --name-only \| context-for-paths.mjs` | consumes the three above |
| Commit trailers | `Plan-Ref:` / `Decision-Ref:` / `Lesson:` | `git log --grep='^Lesson: '` | commit-msg hook (source system; hook not shipped here) |

The unifying idea: **the write side and the read side share one schema.** A
lesson is written once (via the `/lesson` flow) into a format the path resolver
can read back the moment a related file is touched. An ADR's `affects:` globs
are both documentation *and* the index the resolver queries.

## The path resolver is the keystone

[`scripts/context-for-paths.mjs`](../../scripts/context-for-paths.mjs) turns a
set of changed files into the exact ADRs, roadmap parts, and lessons that
govern them. This inverts the usual flow: instead of loading everything and
hoping the relevant rule is in context, the agent *asks* "what governs these
paths?" and loads only that. It's the read-side complement to the tiered,
path-scoped rules — same principle (load by relevance, not by default),
different mechanism.

## Commit trailers close the why-gap

A commit records *what* changed; the diff shows it. It does not record *why* —
that's lost the moment the PR is merged, unless it's captured. Structured
commit trailers (`Plan-Ref:`, `Decision-Ref:`, `Lesson:`) link a commit back to
the plan, decision, or lesson that motivated it, so `git log --grep='^Lesson: '`
reconstructs the reasoning trail months later.

## Consequences

- The agent can answer "what governs this file?" mechanically, in milliseconds,
  without a human in the loop.
- The knowledge base is validated by CI, so it can't silently rot: a malformed
  lesson blocks; a broken reference warns.
- New context is cheap to add (append one JSONL line) and impossible to add
  malformed (the validator rejects it).
- The system degrades gracefully: even with zero lessons, the resolver still
  returns ADRs and roadmap parts; even offline, everything is greppable.

## Status

Accepted. This is the substrate the whole methodology assumes.
