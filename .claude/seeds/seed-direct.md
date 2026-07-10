# Seed — Direct batch

Template excerpt — instantiate per [modes.md](../../docs/methodology/modes.md)
and extend by the same pattern. Every architectural decision was already made
in the confirmed plan this executes; a question requiring judgment mid-batch
means STOP and return to Plan, never guess and proceed.

---

MODE: Direct — write code, plan already confirmed.

**Plan:** <link/path to the confirmed Plan output this batch executes>
**Batch type:** <Direct backend | Direct UI | Direct admin | … — see the
[verification matrix](../../docs/methodology/verification-matrix.md)>

## Steps

### Step 1 — <unit of work>

<the contract this step satisfies, from the plan>

Show me the file. STOP. I'll verify <the specific invariants checked at this
gate — e.g. migration renamed, org filter present, typed error mapped before
the idempotency branch>.

### Step 2 — <unit of work>

<contract>

Show me the file. STOP. I'll verify <named checks>.

<!-- more steps; each STOP names what will be checked — the gate is a
contract, not a vague pause -->

## Verification surface (must match the batch type)

<the matrix row for this batch type, instantiated — e.g. Direct backend:
typecheck + integration test + structural greps; include the concurrent
variant when correctness depends on a constraint firing under race>

## Out of scope for this batch (do NOT touch)

- <files/directories adjacent to the slice that belong to other batches>
- Never on this list: tests for the code this batch introduces — they share
  this batch's verification gate.

## Post-actions (before commit)

Run the ledger triage per
[the slice loop](../../docs/methodology/slice-loop.md) § Post-action ledgers:
tech-debt / scope-backlog / compression-triggers / lessons / rule-edit.
