# Changelog

Notable changes to the Agentic Product Development Reference, newest first. The
domain throughout is a placeholder ("Acme Commerce", a multi-tenant B2B
marketplace); the method is real. This changelog begins at V6 — earlier version
deltas predate it.

## V6 — Agent authority + two deeper tenancy/audit primitives

Adds the chapter on the agent's *authority* alongside the existing chapters on
its *output*, and extends the tenancy and event-sourcing ADRs with two new
primitives.

**Counts:** lessons 20 → 28 · roadmap parts 8 → 9 (PART-I) · eval corpus 5 → 7
tasks · example sketches 5 → 7 · files 54 → 59. No files removed; the `.claude/`
rules and seeds are unchanged.

### Added

- **`docs/methodology/agent-identity-and-guardrails.md`** — new chapter:
  least-privilege agent identity (*an agent that can edit the ruleset gating it
  is not gated*).
- **`src/example/claimDiscovery.ts`** — a second connection-scoping variable for
  a verified-principal discovery scan, a dedicated read wrapper, the
  wrappers-never-nest doctrine, and per-edge scope matching.
- **`src/example/writeSurface.ts`** — the actor axis plus a write-surface
  registry enforced by a conformance test (a probe that must not be able to
  write).
- **`scripts/eval/corpus/task-006-claim-discovery-scope-union.json`** — eval
  task: setting both connection-scoping variables in one transaction OR-unions
  two tenant scopes (a *blocking* cross-tenant fail).
- **`scripts/eval/corpus/task-007-actor-class-omitted.json`** — eval task: an
  admin-initiated write that omits the actor class and skips the write-surface
  registry.

### Changed

- **`docs/architecture/001-tenancy-boundary.md`** — added the fifth
  authorization source and the second, narrower connection-scoping variable for
  the cross-seller discovery scan.
- **`docs/architecture/002-event-sourced-mutations.md`** — added the actor-axis
  and write-surface conformance sections.
- **`docs/structured/lessons.jsonl`** — eight new lessons (**LSN-021 → LSN-028**):
  least-privilege identity; gate definitions human-authored by construction;
  verify enforcement across every overlapping system; revert self-inflicted
  symptoms before tooling; mint pre-checks vs. recovery gates; a probe that can
  write is not a probe; a completeness census can't distinguish fixture debris
  from a bug; a schema-const addition triggers doc regeneration without a
  migration.
- **`docs/structured/roadmap.jsonl`** — added **PART-I** (least-privilege agent
  identity); widened **PART-G** (verified-email discovery scan) and **PART-B**
  (write-surface) affects.
- **`src/example/withDomainEvent.ts`** — added an actor class to the audit-row
  metadata.
- **`src/example/README.md`** — indexed the two new example sketches.
- **`ENGINEERING_METHOD.md`** — new §10 (identity); prior closing section
  renumbered to §11.
- **`README.md`** — headline, methodology index, and example index updated.
- **`CITATION.cff`** — abstract now names least-privilege agent identity.
