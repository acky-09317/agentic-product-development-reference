# Modes: separate deciding from doing

The single highest-leverage discipline in agent-driven development. Every unit
of work runs in one of three modes, declared on the first line of the prompt.
The agent behaves measurably differently on the signal.

```
MODE: Plan only — derive contracts, write nothing.
MODE: Direct — write code, plan already confirmed.
MODE: Maintenance — single-batch fix, follow universal invariants.
```

When the mode is absent and the work might be a new feature, default to **Plan**
and run a short planning batch first. An extra Plan batch is cheap; Direct work
that turned out to need planning is expensive — skipped events, missing audit
trail, an authorization bypass.

---

## Plan

**Use for:** a new feature/slice, a deferred architectural decision, contract
design with multiple downstream consumers, cross-cutting changes, any "should
we…?" question where the answer changes the file inventory.

**Output:** contracts — file lists, type signatures, schema DDL, decision
tables, ASCII layout sketches, a verification checklist. **No implementation:**
no function bodies, no query-builder chains, no non-trivial JSX.

**The invariant:** nothing produced in Plan commits to a specific
implementation. If the model writes a function body, that's a mode violation
*and* a signal the spec is underspecified at the contract layer. Stop and
re-issue with a sharper Plan-only constraint.

Why the hard line: the whole value of Plan is that it separates the expensive,
hard-to-reverse decisions (schema shape, event design, the authorization axis)
from the cheap, mechanical ones (writing the code that satisfies them). Blur
that line and you get plausible code built on an unexamined decision.

---

## Direct

**Use for:** work where a confirmed plan exists, the spec is explicit enough
that the model is composing rather than deciding, the change is scoped to a
single verification gate, or a refactor with an explicit before/after shape.

**Output:** code that satisfies the spec, structured as numbered steps with an
explicit **STOP** between them:

```
### Step 1 — Schema + migration
[contract]
Show me the file. STOP. I'll verify the migration is renamed and the type is re-exported.

### Step 2 — Command + event
[contract]
Show me the command. STOP.
```

Each STOP names what will be checked — that makes the gate a contract, not a
vague pause. Bypassing stop-gates is the failure mode that compresses three
good batches into one bad one: the model reads ahead, builds on assumptions in
later steps, and every step's verification surface degrades.

**The invariant:** every architectural decision was already made in Plan. If a
Direct batch surfaces a question requiring judgment, the answer is to **stop and
run a Plan batch** — never to guess and proceed. This is the *mid-execution
STOP-failure protocol*: when a gate reveals the contract is wrong (wrong path,
wrong return type, a false precondition), the slice halts at that gate, does
not patch in place, and returns to Plan with a divergence summary. Patching a
bad contract in place costs N follow-up batches to unwind.

Every Direct batch ends with an explicit **out-of-scope list** — the exclusion
list is as load-bearing as the inclusion list. Without it the model treats
adjacent work as "helpful context" and builds files that belong in another
batch (see lesson `LSN-004`). The one thing that's never out of scope: tests for
the code the batch introduced — they share the batch's verification gate.

---

## Maintenance

**Use for:** single-file edits that don't change a domain's mutation surface,
bug fixes, renames, comment/styling adjustments, adding tests for existing
behavior, reading code to answer a question.

**Output:** the smallest change that satisfies the request, conforming to
existing conventions and the universal invariants.

**The invariant:** if the request needs a new event, a new mutation surface for
an aggregate that doesn't currently mutate, or a new authorization capability —
that's not maintenance, it's a slice, even if it feels small. Stop and re-issue
as Plan. Schema additions and new pages over existing DTOs do *not* trip this —
they land as maintenance routinely. The trigger is a new
mutation/event/capability surface, not the work around it.

---

## The pushback clause (Direct and Maintenance)

Before writing code, the agent scans the spec for: contradictions with existing
conventions, known footguns (silent null writes, race conditions, authorization
bypasses, transaction-ordering errors), and assumptions it can't verify. If it
finds one, it **raises it before writing** rather than faithfully implementing a
broken spec.

Without an explicit invitation to dissent, an LLM treats the prompt as
authoritative and implements known-broken specs cheerfully. Naming concrete
failure categories gives it criteria for *when* to interrupt versus execute —
generic "push back if needed" is too vague to act on.

The reciprocal human duty: when the agent pushes back on something that's
actually fine, respond "confirm and continue, [why]" and move on — don't
relitigate. A few wasted round-trips are the price of catching the specs that
were genuinely wrong.
