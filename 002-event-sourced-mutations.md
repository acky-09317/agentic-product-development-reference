---
id: ADR-002
title: Every state mutation goes through one transaction helper
status: accepted
affects:
  - packages/server/src/events/**
  - packages/server/src/domain/**
  - packages/server/src/listeners/**
---

# ADR-002 — Every state mutation goes through one transaction helper

## Context

Two failure modes recur in event-driven systems, and both are silent:

1. **State/audit divergence.** If you write business state in one transaction
   and the audit-log row in another (or forget the audit row), replay and audit
   break — you have state with no record of how it got there.

2. **Dispatch-on-rollback.** If you dispatch an event to the async job runner
   *inside* a database transaction, the event fires even when the transaction
   rolls back. Downstream listeners then react to state that never
   committed — issuing refunds, granting access, sending notifications for
   things that didn't happen (see lesson `LSN-006`).

An agent hand-rolling `db.transaction()` + `dispatch()` will get the ordering
wrong in a way that passes every test, because the race only shows up under
rollback.

## Decision

There is exactly **one** sanctioned way to perform a state mutation that emits
an event: a single helper, `withDomainEvent()`, that:

1. Opens one transaction.
2. Writes business state **and** the `event_log` row inside it — atomic.
3. Commits.
4. **Only then** dispatches to the async job runner.

Manual `db.transaction()` + `dispatch()` is banned by a lint rule; direct
inserts into `event_log` outside the helper are banned by another. The helper
exists to make the correct ordering the *only* ordering.

Everything else follows the **Command → Event → Workflow** chain:

- **Command** validates input, checks authorization at the handler above it,
  writes state + event atomically via the helper, returns a typed result.
- **Event** is emitted after commit — immutable, versioned, no PII, internal
  IDs only.
- **Workflow** (a listener on the job runner) reacts to the event: it re-reads
  current state from the DB (never trusts the event payload's mutable values),
  checks idempotency, and calls commands for follow-up mutations. Listeners
  **never contain business rules** — a rule inside a listener silently diverges
  from the same rule in a sibling listener on the next bug fix.

Cross-domain reactions happen only through events (choreography), never through
direct service-to-service calls. The emitting domain has no knowledge of who
reacts.

**Listeners are extracted for testability.** A listener whose logic is inlined
inside the job-runner wiring can only be exercised end-to-end — so in practice it
never is, and "is this listener idempotent?" stays a hope. The fix is structural:
extract the handler as a **named export** (`{verb}Fn`) with the `registerListener`
wiring as a thin shell below it. The handler becomes a plain async function a
Tier-2 integration test calls directly with a fake event, asserting three things:
the DB state change, the dispatch fired (a send mock), and that a *second*
delivery of the same event is a no-op (the at-least-once contract). Listeners
sort into three shapes by directory — domain-bridge, integration (external SDK),
and webhook-ingestion — but the extraction contract is the same for all three.
Canonical sketch: [`src/example/listener.ts`](../../src/example/listener.ts).

## Idempotency

Every mutation carries an idempotency key derived from the *natural key* of the
entity being created — never from request context (request id, timestamp,
session). A retry submitting the same key hits a unique constraint inside the
transaction; the caller maps that to success (the operation already happened),
never to an error. Inside a listener, the key derives from the triggering
event, not from `Date.now()` — because the step may be retried minutes later.

## Idempotency recovery: recover, don't conflict

A retry is not an error. When a create is retried (a double-click, a refresh, a
second device, a network retry), the right outcome is `{ ok: true, data }` with
the *existing* row reconstructed — not `{ ok: false, CONFLICT }`. The command's
outer catch detects the constraint violation and performs a **recovery read**
that rebuilds the result from what already committed.

Three things make this subtle, and each is a shipped lesson:

1. **The recovery read runs post-rollback, so its tenant scope is gone.** The
   transaction rolled back on the constraint violation, taking the
   transaction-local acting-org variable with it. A recovery read of a
   tenant-scoped (RLS) table would therefore zero-row and silently return
   partial data. Recover from **bootstrap (policy-free) sources** — the audit
   row and the parent row — or re-establish scope explicitly. (See the RLS
   recovery-read constraint / lesson `LSN-020`.)

2. **Don't blanket-reshape every catch (`LSN-008`).** A *body-mint* stream key —
   a fresh UUID per call — makes the `(stream_key, idempotency_key)` unique index
   structurally unreachable on retry. A generic "any unique-violation" helper
   then only fires on a real *natural-key* conflict (a slug, an email). Recover
   those; leave destructive-op branches as CONFLICT. Confirm the stream key is
   input-derived before flipping. And flip each command's test assertions in the
   *same* commit — the test-existence gate checks a test *exists*, not that its
   assertions match the new shape.

3. **The recover-vs-conflict decision is authorization, and must be gated on
   server-set identity (`LSN-007`) — the security primitive worth internalizing.**
   For a pre-auth mint (signup provisioning an org), a retry and *a different
   user who happened to pick the same slug* both hit the same unique-constraint
   violation. Deciding which one to recover is a question about *who the caller
   is*, not *whether the request is a duplicate* — so gate it on the existing
   row's server-stamped owner id (from its creation audit row) versus the
   caller's session-stamped id. **Never** gate it on the client-supplied
   idempotency key: a replayed or colliding key would recover a non-owner and
   disclose another tenant's internal ids (a cross-tenant leak), while a
   legitimate owner retrying from a second device would send a fresh key and be
   wrongly rejected. The dedup key answers "same request?"; it can never answer
   "same principal?" The correct fix deletes the client key from the whole chain
   rather than repurposing it, and makes every CONFLICT response byte-identical
   so recovery leaks no ownership information.

Canonical sketch: [`src/example/idempotentRecovery.ts`](../../src/example/idempotentRecovery.ts).
The eval scores exactly this failure — an agent that makes signup idempotent but
gates on the client key
([`task-004`](../../scripts/eval/corpus/task-004-idempotency-identity-gate.json))
fails the blocking tenant-safety dimension.

**Verify recovery under race, not just retry.** A sequential retry only exercises
the pre-transaction fast path. To prove the *constraint itself* is the safety
net, a concurrent-retry test fires the same payload twice
(`Promise.all([create(x), create(x)])`) and asserts exactly one row committed and
the loser recovered `{ ok: true, data }` — the unique/natural-key violation
fires under the race it exists to handle, not just the sequential catch.

## The actor axis: who acted is two questions, not one

Every audit row already records *which user* acted. It should also record *what
kind of actor* — a person, a background job, or an unauthenticated guest —
because that is a different question with different consequences, and
reverse-engineering it from the source channel later is lossy and unreliable. So
`metadata` carries a closed-vocabulary **actor class** on every write
(`user` / `system` / `guest`), stamped at the helper, queryable directly. An
admin-initiated write and a member's own write can then be told apart in the
trail even when both target the same tenant's data; a background reconciliation
is never mistaken for a person's action. (An autonomous agent is the natural next
member of this vocabulary — which is the whole reason actor-*kind* is a
first-class field rather than an inference: the substrate is ready for a new
actor class before one exists.)

## Write-surface conformance: a new mutation can't ship un-audited

`withDomainEvent()` closes the audit gap for code that *uses* it — but nothing
stops a new mutation from being added that quietly doesn't conform: no actor
class, an event not in the typed registry, or simply invisible to anyone asking
"what can write in this system?". The fix is a **registry of every write
surface** plus a **conformance test**, together turning that from a review-catch
into a gate:

- The registry names one entry per mutation — its aggregate, the typed event it
  emits, the actor classes allowed to invoke it. A **completeness** check fails
  closed if a mutation exists in the code but not the registry (the same
  never-default-allow shape as the RLS coverage gate in ADR-001).
- A **conformance** probe re-invokes each surface to assert a property — "every
  write stamps an actor class", "every birth event is emitted".

The conformance probe hides a trap worth its own lesson. A probe that re-invokes
*real* domain logic to check "did this mutation emit its event?" can **settle the
very gap it should only detect** — it writes the missing event, so it reds on the
first run and greens on the second, and in doing so breaches the observe-never-
patch fence (`LSN-026`). An observation probe that can mutate is not a probe. The
fix is structural: run it against a **stubbed write path** (mock the emit) and
assert on the *attempt* — "the handler tried to emit, carrying an actor class" —
not on downstream state having grown; then prove non-mutation by asserting row
counts are unchanged across repeated runs.

And the completeness census is only as honest as the data under it. Where two
fixture styles coexist — mint-path fixtures that emit a birth event and
raw-insert fixtures that write a row directly with none — the census cannot tell
a raw-insert fixture's eventless row (legitimate debris) from a genuine mint-path
bug (a real mutation that failed to emit). Its strength as a detector is its
weakness as a signal (`LSN-027`); it runs clean only against a debris-free base.
Sketch: [`src/example/writeSurface.ts`](../../src/example/writeSurface.ts).

> A related gate-honesty trap sits one layer down, at the schema. Adding a new
> `as const` vocabulary (like the actor-class set) to a schema file triggers the
> generated schema-doc regeneration **even with no migration** — and because no
> gate enforces doc freshness (typecheck, lint, and tests all pass on a stale
> doc), an incomplete change ships gate-green and the staleness surfaces only at
> manual review (`LSN-028`). "No migration" never implies "no schema-doc regen".

## Consequences

- State and audit can never diverge; events can never fire for uncommitted
  state. Both failure modes are structurally impossible, not merely tested-for.
- Every audit row carries both *which user* and *what kind of actor* — the trail
  distinguishes admin, system, and guest writes from a member's own action.
- Every mutation is replayable and auditable by construction.
- There is a single, greppable place where mutations happen — which is exactly
  the substrate an agent needs to reason about the system reliably.
- The typed event registry makes a wrong dispatch shape a compile error, not a
  runtime fanout error.

## Status

Accepted. Shipped as roadmap part `PART-B`; consumed by every domain slice.
