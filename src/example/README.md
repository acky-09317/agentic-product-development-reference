# Illustrative source

Small, self-contained sketches of the load-bearing patterns the whole
methodology leans on. These are **teaching examples**, not a runnable app —
they're deliberately stubbed (no real DB) so the *shape* is legible without the
infrastructure. In the real system these are the canonical files an agent reads
to learn the local idiom (real examples outweigh markdown rules).

| File | Pattern | Rule / ADR |
| --- | --- | --- |
| [`withDomainEvent.ts`](./withDomainEvent.ts) | The one sanctioned transaction helper — state + audit atomic, then dispatch | [ADR-002](../../docs/architecture/002-event-sourced-mutations.md), [rule 05](../../.claude/rules/05-coding-conventions.md) |
| [`permissions.ts`](./permissions.ts) | The three-axis authorization model (role / capability / resource) | [ADR-001](../../docs/architecture/001-tenancy-boundary.md), [rule 02](../../.claude/rules/02-identity-tenancy-authorization.md) |
| [`idempotentRecovery.ts`](./idempotentRecovery.ts) | Recover-not-conflict + the identity-discrimination gate (recover-vs-conflict on server identity, never a client key) | [ADR-002](../../docs/architecture/002-event-sourced-mutations.md), [rule 09](../../.claude/rules/09-security-rules.md) |
| [`listener.ts`](./listener.ts) | A cross-domain listener extracted for testability (named-export handler + thin wiring; the Tier-2 test contract) | [ADR-002](../../docs/architecture/002-event-sourced-mutations.md) |
| [`rlsPolicies.ts`](./rlsPolicies.ts) | The three RLS classes: bootstrap (no policy) · ownership (direct org_id) · **deferred-ownership** (FK-inherited EXISTS) | [ADR-001](../../docs/architecture/001-tenancy-boundary.md), [rule 09](../../.claude/rules/09-security-rules.md) |

## Why show code at all in a methodology repo

Because the methodology's payoff *is* code, and the fastest way to teach an
agent (or a reviewer) a convention is a canonical example, not a paragraph. Both
files encode a "silent failure made structural":

- `withDomainEvent.ts` makes dispatch-on-rollback impossible by *ordering* —
  the dispatch physically can't run before commit.
- `permissions.ts` makes "forgot the owner-only check" a matrix cell instead of
  an inline guard that drifts, and makes "skipped the resource check" a visible,
  explicit call at the single gate.

Read them alongside the ADRs they implement — the ADR explains *why* the shape
is the way it is; the code shows *what* to copy.
