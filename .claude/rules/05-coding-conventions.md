---
paths: ["packages/**"]
---

# Rule 05 — Coding conventions: transactions, recovery, types, migrations

How every mutation is written, every recovery path behaves, and every type is
owned.

> **Excerpt.** This file carries only the entries the rest of this repository cites —
> enough to show the shape and the tier discipline. Extend by the same
> pattern: one constraint per entry, tier stated, promoted from a ledger
> scar or an ADR — never authored speculatively — and path-scoped via
> `paths:` frontmatter unless it passes the gate test for the
> always-loaded core.

## The one write path

- `withDomainEvent()` is the **only** sanctioned path for a state mutation
  that emits an event — state + audit row atomic in one transaction, dispatch
  only after commit. Manual `db.transaction()` + a separate dispatch call is
  **banned by a lint rule**: the event would fire even when the transaction
  rolls back, and listeners would react to state that never committed.
  `[BLOCKING]` (`LSN-006`,
  [ADR-002](../../docs/architecture/002-event-sourced-mutations.md),
  [`src/example/withDomainEvent.ts`](../../src/example/withDomainEvent.ts))
- Existence checks live **inside** the transaction: push "does this row
  exist?" into the tx via `.returning()`, throw a typed error on the empty
  result, and map it in the outer catch **before** the idempotency-conflict
  branch. A pre-tx SELECT races with a concurrent DELETE and silently turns
  NOT_FOUND into a successful no-op plus a phantom audit row. `[SILENT-DRIFT]`
  (`LSN-001`)
- The RLS acting-org is bound with `set_config('app.current_org', $1, true)` —
  **never** a parameterized `SET LOCAL`, which is grammar, cannot bind a
  parameter, and invites interpolation (an injection vector). The wrapper's
  leading statement uses the exact `set_config` form the driver-capability
  test proved. `[SILENT-DRIFT]` (`LSN-003`)

## Recovery discipline

- A uniqueness-guarded create wires recover-vs-conflict at **both** collision
  sites — the pre-transaction availability fast-path (the common sequential
  retry) and the in-transaction constraint catch (the rare concurrent race) —
  via **one shared helper**, so the decision is made in exactly one place. A
  catch-only implementation misses the path that happens most.
  `[SILENT-DRIFT]` (`LSN-009`,
  [`src/example/idempotentRecovery.ts`](../../src/example/idempotentRecovery.ts))
- Constraint-violation detectors (`isSlugConflict`, `isIdempotencyConflict`,
  peers) walk the ORM error's `.cause` chain to bounded depth to find the
  SQLSTATE and constraint name — the ORM's top-level message is the query
  text, not the driver error. A top-level-only check goes green through every
  local gate and drops recovery to INTERNAL_ERROR on the real race.
  `[BLOCKING]` — caught by the concurrent-race integration test run under the
  real application role with FORCE RLS on. (`LSN-010`)

## Type ownership and generated artifacts

- Domain constants and their derived types are defined **once** in
  `packages/db` and re-exported via `packages/types` — never an independent
  `as const` copy, which silently diverges from the schema's definition.
  `[SILENT-DRIFT]` ([CLAUDE.md](../../CLAUDE.md) § Key patterns, the
  [example slice plan](../../docs/methodology/example-slice-plan.md))
- DTO mappers map `null` → `undefined` before a result crosses the query
  boundary — consumers otherwise grow divergent null-vs-undefined branches.
  `[SILENT-DRIFT]` (the example slice plan's query contract)
- Migration files are **renamed to describe the change** (from the
  generator's random name) and the journal tag updated in the same commit —
  six months from now, during an incident, the filename should say what
  changed without opening it. `[STYLE]`
- Generated artifacts are **regenerated, never hand-merged**: on a conflict,
  reset to HEAD and re-run the generator. A hand-merge produces output that is
  syntactically valid and semantically half-correct.
  `[SILENT-DRIFT]` ([CLAUDE.md](../../CLAUDE.md) § Auto-generated files)

Genericized from the source system.
