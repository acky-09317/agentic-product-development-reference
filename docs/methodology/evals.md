# Evals: measure the agent, don't trust it

You cannot improve what you don't measure, and "looks right" is not a
measurement. The [eval harness](../../scripts/eval/) scores an agent's code
diffs against task specs, so "is this change good?" has a number behind it and a
gate you can put in CI.

> Run it: `npm run eval`. Read the harness: [`scripts/eval/`](../../scripts/eval/).

## What gets scored

Each recorded attempt is scored across five weighted dimensions:

| Dimension | Question | How it's scored |
| --- | --- | --- |
| **Correctness** | Did it satisfy the acceptance criteria? | fraction of criteria met |
| **Tenant safety** | Did every new query keep its tenant filter? | **blocking** — 0 fails the task outright |
| **Blast radius** | Did it touch only what it should? | in-scope vs. over-budget file penalty |
| **Convention** | Does it match the codebase's patterns? | penalty per named violation |
| **Coverage** | Did it test the behavior it introduced? | tests present / absent |

The deterministic dimensions are scored by static analysis of the diff. The
borderline cases — where a weighted score lands between the fail and pass
thresholds — route to an **LLM-as-judge** with a rubric, because "is this wide
diff justified by the task?" is a judgment call, not a checklist.

## The weights are a risk model

This is the part worth internalizing. The weights aren't arbitrary — they
**encode what the team considers dangerous**:

- **Tenant safety carries the same weight as correctness, and it's blocking.**
  A silent cross-tenant leak is categorically worse than a missing edge-case
  test. So a diff that satisfies every acceptance criterion but drops an
  `orgId` filter *fails* — no weighted average rescues it. (This dimension
  exists because of lesson `LSN-005`: an agent shipped exactly that, green
  typecheck and all.) It also catches subtler disclosures — `task-004` is an
  agent that makes signup idempotent (a genuinely requested improvement) but
  gates the recover-vs-conflict decision on the client-supplied dedup key, so a
  replayed key recovers *another tenant's* org and returns its internal ids.
  Correct-looking, tested, and a cross-tenant leak — exactly the shape the
  blocking dimension exists for (lesson `LSN-007`).
- **Blast radius is weighted at all** because an unexpectedly wide diff is a
  smell even when every line is correct — it means the agent left its slice,
  and every extra file is review burden and latent risk.

Tuning these numbers is a **product decision**. Weighting blast radius up says
"we value tight, reviewable changes over speed"; weighting coverage up says
"we're in a phase where regressions hurt more than velocity." The eval makes
that judgment explicit and enforceable instead of leaving it to reviewer mood.

## Deterministic first, judge only where it pays

Running an LLM judge on every diff would be slower, costlier, and *less*
consistent on the clear-cut cases. So the harness decides structurally where it
can:

- **Blocking failure** (tenant leak) → fail, no judge call. The security floor
  is not a matter of opinion.
- **Clear pass / clear fail** (weighted score outside the borderline band) →
  decided by threshold, no judge call.
- **Borderline** → *this* is where the LLM judge earns its cost.

The judge runs offline via a deterministic heuristic when no API key is
present, so the shape of the eval is always demonstrable; with a key it calls
the model with a rubric and structured output. Either way, a blocking failure
never reaches the judge — you don't ask an opinion about a security regression.

## Taking the judge to CI (what it actually taught)

Wiring the judge into CI surfaced a cluster of lessons that stay invisible until
the judge is *live* on real diffs:

- **Split the surfaces by cost and trust.** The per-PR check runs **floor-only** —
  deterministic, no model, no credential, no DB — so every PR gets a fast,
  reproducible signal and fork PRs run it fine. The **graded judge runs on the
  audit cadence** (a dispatch / scheduled surface), **excluded from the merge
  path by design**: you don't gate a merge on a stochastic opinion. The cost also
  concentrates there — the spend is the full corpus sweep (dozens of judge calls),
  not the per-PR check — which makes **model-tier selection a first-class cost
  lever**, not an afterthought.
- **Gate a credential on validity, not presence (`LSN-016`).** The install step
  checked that the model credential was *set*, not that it *authenticated* — a
  present-but-invalid subscription token passed the check and the judge failed
  only at run-time. A plain API key beats subscription-OAuth as a CI credential;
  the trade is metered-cost-vs-fragility.
- **Measure before blaming the model (`LSN-019`) — the most transferable one.** A
  localization metric scored a run 1/14, reading as a judge regression. The raw
  evidence showed the judge cited the *correct* file all 14 times; the misses were
  a **cite-parser regex** that couldn't read the judge's richer `file:14-19:
  <prose>` format. A machinery-only parser fix flipped the *identical* run to
  14/14 with zero variance — the "non-determinism" that had motivated a whole
  determinism recalibration was **evidence-format variance a parser couldn't read,
  not the model being random.** Trace a low metric to its source before it drives
  a conclusion — and don't wire a `--temperature` flag the CLI silently ignores
  (`LSN-018`): verify the capability, not the flag's presence.
- **You don't make the judge deterministic — you quarantine its
  non-determinism.** The deterministic floor is the merge-gate authority; the
  judge is advisory; a majority-of-M vote characterizes the residual noise; and
  genuine drift triggers a *reviewed, diff-visible re-baseline*, never a silent
  threshold softening. An advisory check must **rest green or fail loud**
  (`LSN-014`) — a persistent-red advisory muted to a "neutral" check is a bug
  wearing a design label, and it goes gate-green on the broken state.

## How this fits the loop

The eval is a gate you can run per-batch (report mode, always green so the demo
works) or in CI (`--gate`, fails on any ❌). It's the check that answers "is the
agent's output good?" without a human reading every line — which is what makes
delegating to the agent at scale safe. Combined with the
[verification matrix](./verification-matrix.md) (which answers "does it work?"),
you have both halves: does it work, and is it good.

## The product framing

Evals are how you turn "the AI seems pretty good" into a defensible claim. When
someone asks "how do you know your agent isn't shipping subtle bugs?", the
answer isn't "we review carefully" — it's "here's the eval corpus, here are the
weighted dimensions, here's the regression it caught last week, and here's the
CI gate that blocks it." That's the difference between vibes and a measured
system.
