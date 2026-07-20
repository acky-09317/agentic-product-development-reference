# Agent identity: a guardrail an agent can edit isn't a guardrail

Every other chapter here is about making an agent's *output* safe — the eval
scores its diffs, the rules fail loud on a bad pattern, the preservation canary
catches drift. This chapter is about making its *authority* safe. The moment an
agent can open pull requests on its own, a second question appears alongside "is
this change correct?": **what is this agent allowed to do to the machinery that
judges it?**

The answer has to be *nothing*. An agent that can edit — or bypass — the gate
that reviews it is not gated. It is trusted, wearing a gate as decoration.

## The identity is the boundary, not the prompt

You cannot instruct your way to a safe autonomy level. "Don't touch the CI
config" in a system prompt is a request, and an agent tracing a plausible fix
will edit whatever file the fix points at. The boundary has to be **structural**:
the credential the agent runs under must *lack the power* to weaken its own
guardrails, so that "don't" is enforced by a `403`, not by good behavior.

Concretely, run the agent under a dedicated, least-privilege machine identity:

- It can **write code and open pull requests** — enough to do the work.
- It **cannot administer the repository** — it cannot edit branch-protection
  rules, merge-gate definitions, or reviewer requirements. A request to change
  the ruleset that gates it returns a hard authorization failure, proven by
  probing it (attempt the privileged call once, confirm it is refused).
- It **cannot self-approve.** Merge stays behind human code-owner review, so
  even a perfectly-formed PR that quietly relaxes a gate needs a human to say
  yes. Autonomy on *authoring*; a human on *merging*.

This is the same least-privilege instinct that puts a service on a role with
only the grants it needs — applied to the agent as a first-class actor. Raising
an agent's autonomy is not "trust it more." It is "shrink what it *can* do until
the things it must not do are impossible," and only then let it move faster
inside that smaller box.

`LSN-021` is exactly this: an agent that ran under an owner-level credential sat
in the bypass list of the very ruleset meant to gate it — free to merge past
required checks and to edit the ruleset itself. The fix was not a better prompt.
It was a new identity with the administrative power removed.

## Gate definitions are human-authored by construction

A happy consequence of the least-privilege identity: the files that *define* the
guardrails — the CI workflow definitions, the merge-gate config — are ones the
agent's credential is refused permission to push at all. So gate changes are
human-authored **by construction**, not by discipline. The agent proposes
product diffs; a human evolves the rules that judge them. If you ever want the
agent to *open* (never merge) a gate-definition PR, that is a separate,
deliberate scope grant — a decision, not a default (`LSN-022`).

This is the property you actually want from "the agent can't weaken its
guardrails": it should not require anyone to *remember* to stop it. The
enforcement layer and the thing it enforces sit on opposite sides of a
permission the agent doesn't hold.

## Verify the enforcement you think you have — across every system

Before you *change* any enforcement setting, read the complete current state —
and modern platforms enforce through more than one overlapping system at once
(a legacy branch-protection surface *and* a newer ruleset surface can both be
live). A "not found" from one API is not "unprotected"; it can simply mean the
enforcement lives in the *other* system. Acting on that partial read — adding a
redundant protection layer because you think there's none — doesn't just waste
effort, it manufactures new failure modes: a second, conflicting layer that
strips a bypass you needed or makes a required check flake (`LSN-023`).

The verify-before-you-act discipline this repo applies to code diffs (drive the
change, observe the behavior — see the [verification matrix](./verification-matrix.md))
extends unchanged to the settings and infrastructure layer. Read *all* of the
current state, from *every* system that could be enforcing it, before you mutate
any of it.

## When a gate starts flaking, suspect yourself first

A corollary that saves the most wasted work: when a required check suddenly
starts failing intermittently, **confirm the flakiness isn't self-inflicted by
a recent enforcement change before you build tooling to work around it.** Revert
the suspect change and re-observe first. A workaround built on top of a
self-inflicted, revertible root cause is pure surface area — it outlives the
problem it was meant to solve, or gets repurposed later under a confusing
rationale nobody remembers (`LSN-024`). Fix the cause; don't scaffold around the
symptom.

## Why this belongs in the method, not the ops runbook

It is tempting to file "give the agent a scoped credential" under
infrastructure and move on. But identity *is* the method here, for the same
reason the three-axis authorization model is: the safety of the whole system
rests on an actor being unable to do the thing you're relying on it not to do.
For a human that's a role on a membership; for the agent it's the scope on its
credential. Get it wrong and every other guardrail in this repository is
advisory — the agent could, in principle, edit the eval, relax the rule, and
merge its own bypass. Get it right and the guardrails are load-bearing, because
the actor holding the pen structurally cannot rewrite the ruler.
