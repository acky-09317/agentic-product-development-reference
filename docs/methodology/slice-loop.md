# The slice loop

The unit of feature work is a **vertical slice** — one capability taken from
schema to UI, built through a repeatable loop. Slices are how you keep an
agent's output reviewable: each slice is small enough that a single coherent
verification gate tells you it's done, and each follows the same shape so the
review is muscle memory. For a complete worked instantiation of the loop — a
real slice plan, end to end — see the
[example slice plan](./example-slice-plan.md).

## The loop

1. **Activate the schema.** Uncomment the domain's export (one line). This is
   the slice-activation gesture.
2. **Design the migration + event(s).** What state changes, and what event does
   the mutation emit? Decide the event name and payload before writing the
   command.
3. **Command.** Business operation: writes state + the audit row in one
   transaction via the sanctioned helper, returns a typed result. (See
   [ADR-002](../architecture/002-event-sourced-mutations.md).)
4. **Handler.** Authorization, then delegate. The three-axis gate
   (role/capability/resource) lives here and *only* here.
5. **Query.** Reads only, returning DTOs shaped for screens — never raw schema
   types. Every read carries its tenant filter.
6. **Consumption layer.** Server actions and query functions the app imports;
   rate limiting applied here, once, not per-app.
7. **Cross-domain reactions.** Wire any reaction as an event listener in the
   *consuming* domain's folder. Never a direct service-to-service call.
8. **UI.** Render the DTOs; send intents. No data fetching in components.
9. **Integration tests.** These **share the slice's verification gate** — they
   are never "a separate batch". A batch that defers its own tests has an
   incomplete verification surface by construction.
10. **Run the verification surface** for this batch type (see the
    [verification matrix](./verification-matrix.md)).
11. **Post-action ledgers** (below).

## Decomposition by verification gate

The loop is split into batches by **what check proves the batch done**, not by
file count. A batch is scoped so that one coherent gate — typecheck +
integration test, or build + render check — is a complete answer to "did this
work?" If two parts of a change need different gates (a backend mutation and a
UI page), they're two batches. Running the wrong gate on a batch (integration
tests on a UI change) both wastes time and misses the real failure modes.

The default is the **smallest verification-coherent slice**. Only split further
when a step carries a genuinely heavy audit (a schema phantom-value sweep, a
multi-paragraph analysis). Transcription-with-citation collapses into its
parent; substantive judgment earns its own batch.

## Post-action ledgers

Every batch that produces a commit runs a short triage of what it surfaced:

| Surfaced… | Goes to… |
| --- | --- |
| A real deviation, out of scope to fix now | tech-debt ledger |
| A discovered future capability | scope-backlog |
| A pattern recurring but with < 3 instances | compression-triggers (rule-of-three) |
| A closed correction with a discovered constraint | the [lessons ledger](../structured/lessons.jsonl) |
| A candidate always-loaded rule (passes the gate test) | a rule edit |

**The gate test** decides whether a surfaced rule-candidate earns always-loaded
text: *does this batch's own verification gate go green on the broken state?* If
yes — the failure ships because nothing in the gate notices — it earns a rule.
If no — a typecheck error, a failing test, a STOP fires — it's redundant with
the gate and gets filed as backlog. This keeps the always-loaded rule set small
and every entry load-bearing.

These ledgers are a **flow, not a sink**: durable content promotes up and out —
a closed correction becomes a lesson, a durable rule becomes always-loaded text
or an ADR, an entitlement becomes a capability. What stays behind is
self-owning bookkeeping. An entry that has hardened into durable guidance is a
promotion candidate, not a permanent resident.

## Why this shape

A slice is the largest unit of work an agent can do that a human can still
review in one sitting against one gate. Smaller and you drown in ceremony;
larger and the review degrades — the reviewer starts skimming, which is exactly
when the silent bugs (the dropped tenant filter, the dispatch-on-rollback) slip
through. The loop's uniformity is what lets the review be fast *and* thorough:
you're checking the same five things in the same order every time.
