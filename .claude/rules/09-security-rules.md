---
paths: ["packages/auth/**", "packages/db/src/rls/**", "packages/server/src/services/**"]
---

# Rule 09 — Security: identity gates, recovery reads, and the RLS census

The constraints whose violations are silent until exploited.

> **Excerpt.** This file carries only the entries the rest of this repository cites —
> enough to show the shape and the tier discipline. Extend by the same
> pattern: one constraint per entry, tier stated, promoted from a ledger
> scar or an ADR — never authored speculatively — and path-scoped via
> `paths:` frontmatter unless it passes the gate test for the
> always-loaded core.

## Identity is the authorization primitive

- The recover-vs-conflict decision on an idempotent create is an
  **authorization** decision: gate it on **server-set identity** (the existing
  row's server-stamped owner id versus the caller's session-stamped id) —
  never on a client-supplied dedup key, which recovers a non-owner on a
  replayed/colliding key (a cross-tenant disclosure) and wrongly rejects the
  real owner retrying from a second device. The fix deletes the client key
  from the whole chain rather than repurposing it. `[SILENT-DRIFT]` — the
  eval's blocking tenant-safety dimension exists precisely because no other
  automated gate reliably catches this class. (`LSN-007`,
  [ADR-002](../../docs/architecture/002-event-sourced-mutations.md) §
  Idempotency recovery,
  [`src/example/idempotentRecovery.ts`](../../src/example/idempotentRecovery.ts))
- Every CONFLICT response on a recovery path is **byte-identical** — whether
  the slug is yours, someone else's, or unattributable — so recovery leaks no
  ownership information. `[SILENT-DRIFT]` (`LSN-007`)

## Recovery reads and tenant scope

- A recovery read in the outer catch runs **after the transaction rolled
  back**, so the transaction-local acting-org is gone; an RLS-scoped read
  there silently zero-rows. Recover only from **bootstrap (policy-free)
  sources** — the creation audit row and the parent row — or re-establish
  scope explicitly before the read. `[SILENT-DRIFT]` (`LSN-020`,
  [ADR-002](../../docs/architecture/002-event-sourced-mutations.md) §
  Idempotency recovery)

## The storage-layer census

- A **denormalized scope column** carries a composite FK to its parent's
  `(id, org_id)` all the way up the ownership ladder — or the column is
  dropped and scope derived through the parent join. A drifted scope column
  makes FORCE RLS filter on a wrong-but-self-consistent value: a silent
  cross-tenant read no test catches. `[SILENT-DRIFT]` (`LSN-002`,
  [ADR-001](../../docs/architecture/001-tenancy-boundary.md) § The
  denormalization trap)
- Every live table is declared into one of the **three RLS classes** —
  bootstrap (no policy; the handler or a verified token is the gate),
  ownership (direct `org_id` equality), deferred-ownership (a differently
  named scope column, or an FK-inherited `EXISTS` through the parent) — and
  the coverage gate **fails closed**: a new table absent from the declaration
  fails CI, never default-allows. `[BLOCKING]` (ADR-001 § Three RLS classes,
  [`src/example/rlsPolicies.ts`](../../src/example/rlsPolicies.ts)
  `assertRlsCoverage`)

Genericized from the source system.
