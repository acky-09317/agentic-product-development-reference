# The Engineering Method

*How to develop a production multi-tenant SaaS primarily through an AI coding
agent, without the speed turning into unreviewable risk.*

This is the long-form version of the [README](./README.md). It's written for
someone deciding whether the person who wrote it understands AI-assisted
development as a discipline, not a novelty.

---

## 0. The premise

A modern coding agent can write a correct function faster than I can. It cannot
be *trusted* to:

- remember a decision made three weeks ago,
- know which of 200 files it's allowed to touch,
- notice that its change quietly broke a tenant-isolation invariant,
- tell me when the spec I gave it is wrong,
- or measure whether its own output is any good.

So the human's leverage isn't in the typing. It's in building the **operating
environment** that makes those five failure modes structurally hard. Everything
below is one of those five, addressed.

The organizing principle: **every invariant that matters is enforced by a
machine, and every invariant a machine can't enforce is labeled as such so a
human knows to look.**

---

## 1. Modes: separate deciding from doing

The single highest-leverage rule. Every unit of work is one of three modes,
declared on the first line of the prompt:

- **Plan** — derive contracts, write *no* implementation. Output is file lists,
  type signatures, schema DDL, decision tables, and a verification checklist.
  The invariant: nothing produced in Plan commits to an implementation. If the
  model writes a function body, that's a mode violation and a signal the spec
  was underspecified.
- **Direct** — execute a *confirmed* plan. Every architectural decision was
  already made. If a Direct batch surfaces a question requiring judgment, it
  **stops and returns to Plan** rather than guessing.
- **Maintenance** — a single small change (bug fix, rename, styling, a test).
  No planning ceremony, but the universal invariants and the pushback clause
  still apply.

Why this matters: mixing deciding and doing is how you get plausible code built
on a wrong assumption. Cheap to catch in Plan; expensive to unwind after three
dependent batches. Full contract: [`docs/methodology/modes.md`](./docs/methodology/modes.md).

### The pushback clause

The agent is explicitly instructed to **refuse to faithfully implement a broken
spec**. Before writing code it scans for: contradictions with existing
conventions, known footguns (silent null writes, race conditions, authorization
bypasses, transaction-ordering errors), and assumptions it can't verify. If it
finds one, it raises it *before* writing.

Without an explicit invitation to dissent, an LLM treats the prompt as
authoritative and implements known-broken specs cheerfully. Naming concrete
failure categories gives it criteria for when to interrupt. The reciprocal human
duty: when the agent pushes back on something that's actually fine, confirm and
continue — don't relitigate. A few wasted round-trips are the price of catching
the specs that were genuinely wrong.

---

## 2. The slice loop: the unit of feature work

New capability = a **vertical slice** built through a repeatable loop:

1. Activate the schema (one line).
2. Design the migration + the event(s) the mutation emits.
3. Write the command (state + audit-log write in one transaction).
4. Write the handler (authorization, then delegate).
5. Write the read/query layer (DTOs shaped for screens).
6. Write the consumption layer (server actions, rate limiting).
7. Wire cross-domain reactions as event listeners (never direct calls).
8. Build the UI against the DTOs.
9. Write the integration tests — *these share the slice's verification gate;
   they are never "a separate batch".*
10. Run the verification surface for this batch type.
11. Run the post-action ledgers (below).

The loop is **decomposed by verification gate**: each batch is scoped so that
one coherent check (typecheck + integration test, or build + render check) tells
you it's done. Full loop: [`docs/methodology/slice-loop.md`](./docs/methodology/slice-loop.md).

---

## 3. Rules that fail loud

Prose guidance decays — nobody re-reads a 400-line style doc on batch #40. So
the rules are organized by **enforcement tier**, and the tier is stated on every
rule:

- **`[BLOCKING]`** — typecheck error, ESLint error, or CI failure. Can't ship.
- **`[SILENT-DRIFT]`** — passes every automated gate, surfaces later as a bug.
  A human reviewer is the only defense; the rule says so explicitly.
- **`[STYLE]`** — convention, no functional impact.

The discipline that makes this real: when a new rule is proposed, it must pass
the **gate test** — *does this batch's own verification gate go green on the
broken state?* If yes, the failure ships silently and the rule earns
always-loaded text. If no (typecheck catches it, a test fails), the rule is
redundant with the gate and gets filed as backlog instead. This keeps the
always-loaded rule set small and every entry load-bearing.

Rules are also **tiered by load cost**: a tiny always-loaded core (mode
discipline + this method), and the rest **path-scoped** — a rule about
authorization only enters the context window when the agent reads an auth file.
See [`.claude/rules/`](./.claude/rules/) and
[`docs/methodology/context-engineering.md`](./docs/methodology/context-engineering.md).

---

## 4. Context engineering: spend the budget deliberately

The context window is a scarce, shared resource. Three techniques keep it
focused:

1. **Tiered loading.** Always-loaded = the two files an agent needs on *every*
   task. Everything else loads on demand via `@`-reference or path-scoping.
2. **Path → context resolution.** A small resolver
   ([`scripts/context-for-paths.mjs`](./scripts/context-for-paths.mjs)) maps the
   files a change touches to the ADRs, rules, and lessons that govern them. The
   agent asks "what governs this file?" instead of hoping it's in context.
3. **On-demand deep references.** Heavy architecture docs (~20KB each) are
   pulled in only when a task matches their trigger, not kept resident.

The goal isn't minimal context — it's *high signal-to-noise* context. A
reference the agent doesn't need is worse than one it needs but doesn't have,
because it dilutes attention on the load-bearing ones.

And it's **measured, not assumed.** Path-scoping is a hypothesis, and hypotheses
about an agent rot silently unless something counts. A hook logs what loads per
session; `npm run rules:report` turns that into signals — the ambient floor, the
realized per-session token cost, a `PROMOTE-BACK` flag on any "scoped" rule that
fires in >80% of sessions (it's ambient in disguise), a `ZERO-FIRE` flag on a
rule whose globs miss its own work, and a fault on any scoped rule that loads at
session start. The thresholds are pre-registered, so a run can't move its own
goalposts. This instrument measures **cost**; the eval (§5) measures **quality** —
you need both, because cheap-but-wrong and correct-but-bloated are both failures.

---

## 5. Evals: measure the agent, don't trust it

You cannot improve what you don't measure, and "looks right" is not a
measurement. The eval harness ([`scripts/eval/`](./scripts/eval/)) scores an
agent's code diff against a task spec across weighted dimensions:

- **Correctness** — did it satisfy the acceptance criteria?
- **Tenant safety** — blocking: a dropped tenant scope fails the task outright
  (weighted equal to correctness).
- **Blast radius** — did it touch only what it should? (An unexpectedly wide
  diff is a smell even when every line is correct.)
- **Convention adherence** — does it match the codebase's patterns?
- **Test coverage** — did it test the behavior it introduced?

Deterministic dimensions are scored by static analysis of the diff; the
borderline, judgment-heavy dimensions go to an **LLM-as-judge** with a rubric.
The harness runs offline via a deterministic heuristic fallback when no API key
is present, so the *shape* of the eval is always demonstrable.

The product lens: **the eval weights are a risk model.** Weighting blast-radius
and tenant-scope violations heavily encodes "a quiet cross-tenant leak is far
worse than a missing edge-case test." Read the philosophy in
[`docs/methodology/evals.md`](./docs/methodology/evals.md).

A concrete catch shows why this matters. Asked to "make signup idempotent" (a
real, reasonable request), an agent will reach for the obvious primitive: gate
the recover-vs-conflict decision on the client's idempotency key. That's a
security bug wearing an idempotency costume — a replayed or colliding key
recovers a *non-owner's* org and discloses its internal ids. The diff compiles,
has a test, and satisfies most acceptance criteria. Nothing but the
tenant-safety dimension flags it (`scripts/eval/corpus/task-004`). The lesson it
enforces — *authorization is identity; a dedup key answers "same request?", never
"same principal?"* — is exactly the kind of hard-won primitive
([`src/example/idempotentRecovery.ts`](./src/example/idempotentRecovery.ts),
[ADR-002](./docs/architecture/002-event-sourced-mutations.md)) that a
methodology repo should make legible instead of leaving in one engineer's head.

Taking the judge **live in CI** was its own education, because a class of lessons
stays invisible until the judge runs on real diffs. Three worth carrying: (1)
**split surfaces by cost and trust** — a deterministic, credential-free *floor*
gates the merge on every PR; the stochastic judge runs advisory on an audit
cadence, off the merge path, where its spend (a full corpus sweep) and its
model-tier choice actually live. (2) **Gate a credential on validity, not
presence** — a present-but-invalid subscription token sailed past a
"is-it-set?" check and failed only at run-time; a plain API key beats
subscription-OAuth for CI. (3) The transferable one: **measure before you blame
the model.** A run that scored 1/14 on one dimension read as a judge regression;
the raw evidence showed the judge had cited the *correct* file all 14 times and a
cite-parser regex simply couldn't read its richer output. A machinery-only fix
flipped the identical run to 14/14 with zero variance — the "non-determinism"
was evidence-format variance a parser couldn't read, not the model being random.
The full arc is in [`docs/methodology/evals.md` § Taking the judge to
CI](./docs/methodology/evals.md).

---

## 6. Machine-readable memory

Context windows end. Decisions don't. So durable knowledge lives in formats both
the agent and CI can query:

- **Lessons ledger** ([`docs/structured/lessons.jsonl`](./docs/structured/lessons.jsonl))
  — one record per *closed* correction: an approach that failed after passing
  its gate, a reviewer catch that exposed a wrong assumption. Schema-validated
  ([`npm run check:lessons`](./scripts/check-lessons-ledger.mjs)). Backward-looking:
  the constraint plus commit evidence, no open to-do.
- **Roadmap spine** ([`docs/structured/roadmap.jsonl`](./docs/structured/roadmap.jsonl))
  — one record per part, with status and the globs it `affects`.
- **ADRs with front matter** ([`docs/architecture/`](./docs/architecture/)) —
  every decision carries an `affects:` glob set so the path resolver can find it.
- **Commit trailers** — `Plan-Ref:`, `Decision-Ref:`, `Lesson:` link a commit
  back to the plan/decision/lesson that motivated it. The *what* is in the diff;
  the *why* is in the trailer.

Together these turn "tribal knowledge held by one human" into "a graph the agent
can traverse." Full model:
[`docs/architecture/machine-readable-context.md`](./docs/architecture/machine-readable-context.md).

---

## 7. Preservation boundaries: drift canaries

The most subtle failure mode of an eager agent is **scope creep** — "helpfully"
editing an adjacent file that wasn't in scope. The defense is a set of
**enforcement classes** on directories, checked in CI:

- **frozen** — file count must match exactly; any drift fails the build.
- **append** — count may only grow; a deletion is a scope breach.
- **watch** — drift is reported but doesn't block (a graduation period).
- **track** — drift is expected; the baseline moves at phase boundaries.

A directory that's been stable for a phase graduates from `watch` to `frozen`.
The point: an agent that wanders outside its slice trips a canary at commit time,
not at review time three days later. See
[`docs/methodology/preservation-boundaries.md`](./docs/methodology/preservation-boundaries.md).

---

## 8. Post-action ledgers: capture what the batch surfaced

Every batch that produces a commit runs a short triage:

| The batch surfaced… | Goes to… |
| --- | --- |
| A real deviation, out of scope to fix now | tech-debt ledger |
| A discovered future capability | scope-backlog |
| A pattern recurring but < 3 instances | compression-triggers (rule-of-three) |
| A closed correction with a discovered constraint | the **lessons ledger** |
| A candidate always-loaded rule (passes the gate test) | a rule edit |

These ledgers are a **flow, not a sink**: durable content promotes *up and out*
(a lesson becomes a rule; an entitlement becomes a capability). What stays is
self-owning bookkeeping. Full discipline:
[`.claude/rules/00-meta.md`](./.claude/rules/00-meta.md).

---

## 9. The verification matrix

Different work has different failure modes, so the check that proves "done"
differs by batch type (abridged — the full matrix adds Direct marketing and
Direct API):

| Batch type | Verification surface |
| --- | --- |
| Plan | Contract review, schema-field existence, completeness |
| Direct backend | Typecheck + integration test + structural greps |
| Direct UI | Typecheck + build (client-boundary) + render check |
| Direct admin | Above + authz probes + audit-log inspection |
| Maintenance | Typecheck + lint + targeted test + invariant greps |

Running the wrong surface (integration tests on a UI batch) wastes time and
misses the real risks. Full matrix:
[`docs/methodology/verification-matrix.md`](./docs/methodology/verification-matrix.md).

---

## 10. Identity: an agent that can edit its guardrails isn't gated

Every mechanism above makes the agent's *output* safe. One more makes its
*authority* safe — and it's the one that makes the rest load-bearing instead of
advisory. The moment an agent opens its own pull requests, ask not just "is this
change correct?" but "what can this agent do to the machinery that judges it?"

The answer must be *nothing*, and it can't be a prompt — "don't touch the CI
config" is a request an agent will trace right past. It has to be **structural**:
run the agent under a dedicated least-privilege machine identity that can write
code and open PRs but **cannot administer the repo** — cannot edit the
merge-gate, the branch protection, or the reviewer rules. A request to weaken
its own guardrails returns a hard `403`, proven by probing it. Merge stays
behind human code-owner review, so even a perfectly-formed PR that quietly
relaxes a gate needs a human to say yes.

Two properties fall out for free: the files that *define* the gates are ones the
agent's credential is refused permission to push at all, so gate changes are
human-authored **by construction**, not by discipline; and nobody has to
*remember* to stop the agent, because the enforcement layer sits on the other
side of a permission it doesn't hold. Raising autonomy isn't "trust it more" —
it's "shrink what it *can* do until the forbidden things are impossible," then
let it move fast inside the smaller box. Full chapter:
[`docs/methodology/agent-identity-and-guardrails.md`](./docs/methodology/agent-identity-and-guardrails.md).

---

## 11. What I'd tell a skeptic

> "Isn't this a lot of process for using an autocomplete?"

It's the opposite of process-for-its-own-sake. Every mechanism here exists
because a *specific* failure happened once and I refused to let it happen
silently again. The lessons ledger literally records those incidents. The rules
are the scar tissue. The evals are how I know a change is good without reading
every line. The result is that a single product person can drive a large,
security-sensitive, multi-tenant codebase with an AI agent and still sleep at
night — because the environment, not my vigilance, is what catches the mistakes.

That's the skill: **not prompting an LLM, but engineering the system that makes
an LLM safe to delegate to.**
