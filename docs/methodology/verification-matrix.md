# The verification matrix

Different work has different failure modes, so the check that proves "done"
differs by batch type. Running the wrong surface — integration tests on a UI
change, a render check on a backend mutation — wastes time *and* misses the real
risks. Every batch declares its verification surface up front, and it must match
the batch type.

| Batch type | Verification surface |
| --- | --- |
| **Plan** | Contract review · schema-field existence · pattern-registry membership · completeness check |
| **Direct backend** | Typecheck + integration test + structural greps for invariants |
| **Direct UI** | Typecheck + build (catches the client/server boundary) + structural greps + render check |
| **Direct admin** | Above + staff/non-staff authorization probes + audit-log row inspection |
| **Direct marketing** | Build + structural greps + visual verification at multiple viewports |
| **Direct API** | Typecheck + integration test against real HTTP + schema generation + probes |
| **Maintenance** | Typecheck + lint + targeted test (if behavior changed) + universal-invariant greps |

## Two questions, two systems

The matrix answers **"does it work?"** The [eval harness](./evals.md) answers
**"is it good?"** They're complementary and you want both:

- A change can *work* (tests green, builds clean) and still be *bad* — a
  correct feature shipped with a 12-file blast radius and no test. The eval
  catches that; the verification surface doesn't.
- A change can *look good* (tight diff, matches conventions) and not *work* — a
  clean-looking query that returns the wrong rows. The integration test catches
  that; the eval, scoring a recorded attempt, assumes the recorded signals are
  honest.

## Structural greps

"Structural greps" are the cheap, specific checks that catch a batch type's
signature failure modes. A backend batch greps for: every new query carries its
tenant filter; no manual transaction + dispatch; event names come from the
typed registry, not string literals. A UI batch greps for: no server imports in
client components; no data fetching in components. They're the same idea as the
eval's deterministic dimensions — encode the known footgun as a mechanical
check rather than trusting the reviewer to remember it.

## Verify the race, not just the happy path

Some invariants only fail under concurrency, and a sequential test sails past
them. The canonical case is **idempotency recovery** (see
[ADR-002](../architecture/002-event-sourced-mutations.md)): a sequential retry
of a create hits the cheap pre-transaction fast path and never exercises the
database constraint that's supposed to be the real safety net. The verification
that actually proves the invariant is a **concurrent-retry test** —
`Promise.all([create(x), create(x)])` — asserting exactly one row committed and
the loser recovered `{ ok: true, data }`. That's the test that distinguishes a
correct implementation from a catch-block that merely *looks* right. When a
batch's correctness depends on a constraint firing under race (idempotency,
lost-update, unique-slug), the verification surface must include the concurrent
variant, not just the sequential one.

## Why declare it up front

Naming the verification surface in the batch prompt turns "I'll check it works"
into a contract: *these* are the checks that will run, and the batch isn't done
until they're green. It also forces the batch to be scoped to a single coherent
gate — if a batch would need two different surfaces to verify, it's two batches
(see [decomposition by verification gate](./slice-loop.md)).
