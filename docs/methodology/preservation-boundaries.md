# Preservation boundaries: drift canaries

The most subtle failure mode of an eager coding agent is **scope creep** — it
"helpfully" edits a file adjacent to its slice (a shared primitive, a config, a
sibling domain), the edit passes typecheck, and nothing catches it until review,
days later (lesson `LSN-004`). Vigilance doesn't scale against this. Structure
does.

## The mechanism

Directories are assigned an **enforcement class**, and a CI check compares each
directory's current file count against a declared baseline. Drift in a
hard-enforced class fails the build.

| Class | Rule | On drift |
| --- | --- | --- |
| **frozen** | count must match exactly | **fails CI** |
| **append-only** | count may only grow (deletion = breach) | **fails CI** |
| **watch** | drift reported, doesn't block (a graduation period) | logged as `[WATCH-DRIFT]` |
| **tracked** | drift expected; baseline moves at phase boundaries | logged only |

A frozen directory that an agent wanders into trips a canary **at commit time**,
not at review time three days later. The file count is a cheap, deterministic
signal that beats forgotten discipline every time.

## Why a file count, of all things

It's crude on purpose. A file-count canary can't tell you *what* drifted, only
*that* something did — but that's enough to make the agent's out-of-scope edit
loud instead of silent, and it costs one `find -type f | wc -l` per directory. The point isn't
precision; it's that the cheapest deterministic signal beats the most
well-intentioned reviewer attention. Precision is what the review is for; the
canary just guarantees the review gets triggered.

## Graduation

A directory earns its way up the strictness ladder by proving it's stable:

1. New/volatile code starts as **tracked** (drift is expected during active
   growth).
2. Once it stops changing, it moves to **watch** — drift is now surprising and
   gets logged, but doesn't block, for one phase.
3. If it stays clean through a phase, it graduates to **frozen** — now any drift
   fails CI.

Frozen directories don't demote back except by deliberate decision (a planned
refactor that will churn the directory). The ratchet only tightens.

## The pairing with out-of-scope lists

The canary is the structural half; the **out-of-scope list** in every
[Direct batch prompt](./modes.md) is the intent half. The prompt says "do NOT
touch these files"; the canary enforces it even if the agent ignores the prompt.
Belt and suspenders — because the whole premise of delegating to an agent is
that you can't assume it will honor the prompt perfectly, so the structural
guarantee has to exist independently.

## The general principle

This is one instance of the method's core move: **make the invariant a machine
can't-not-notice, rather than a paragraph a human is supposed to remember.** The
tenant-safety eval dimension does it for cross-tenant leaks; the transaction
helper does it for dispatch-on-rollback; the preservation boundary does it for
scope creep. In every case, the failure mode was silent, so the defense had to
be structural.
