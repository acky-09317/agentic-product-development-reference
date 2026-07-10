# Context engineering

The context window is a scarce, shared resource, and attention within it is not
uniform — the more you load, the less weight each load-bearing instruction
carries. So context is a **budget you spend deliberately**, not a bucket you
fill. The goal isn't minimal context; it's high signal-to-noise context. A
reference the agent doesn't need is worse than one it needs but doesn't have,
because it dilutes attention on the ones that matter.

## Three techniques

### 1. Tiered loading

Rules are organized by load cost:

- **Always-loaded core** — the two things needed on *every* task: mode
  discipline and the method itself. Kept deliberately small.
- **Path-scoped** — a rule enters context only when the agent reads a file it
  governs. The authorization rules load when an auth file is opened; the UI
  rules load when a component is opened. A backend batch never pays for the UI
  rules, and vice versa.
- **On-demand deep references** — heavy architecture docs (tens of KB) are
  pulled in by explicit reference only when a task matches their trigger, never
  kept resident.

The discipline that keeps the always-loaded tier small is the **gate test** (see
the [slice loop](./slice-loop.md)): a rule earns always-loaded text only if its
own verification gate would go green on the broken state. Everything a gate
already catches stays out of the window.

### 2. Path → context resolution

Instead of loading everything and hoping the relevant rule is present, the agent
*queries* for what governs the files it's touching:

```bash
npm run context -- packages/server/src/domain/orders/commands.ts
```

The [resolver](../../scripts/context-for-paths.mjs) reads ADR `affects:` globs,
roadmap `affects` globs, and active-lesson `paths` globs, and returns the
precise set that applies. This is the read-side of the
[machine-readable context](../architecture/machine-readable-context.md) — the
agent pulls the right rules on demand rather than carrying all of them.

### 3. On-demand deep references

A router (task → which rules to load) sits in the always-loaded core; the deep
material each rule points to loads only when a task matches its trigger. Seed
prompt templates, agent-design guides, and per-surface playbooks all live
on-demand. The router is tiny; the material it routes to is large and lazy.

## The trade-off, made concrete

| If you… | You get… |
| --- | --- |
| Load every rule every time | High cost, diluted attention, the load-bearing rule competes with 400 lines of irrelevant ones |
| Load nothing, hope for the best | The agent invents conventions, drifts from the codebase |
| Load by relevance (path-scoped + resolver) | Each batch sees exactly the rules its files invoke — small window, high signal |

## Measure it — don't assume the scoping works

Path-scoping is a hypothesis: "these rules load only when relevant, so the
window stays small." Like any hypothesis about an agent, it needs a measurement,
or it quietly rots — a rule's globs drift, a rule fires on every session, and you
never notice because nothing counts.

So a hook logs one line per loaded instruction file per session (an
`InstructionsLoaded` log), and [`scripts/rule-loading-report.mjs`](../../scripts/rule-loading-report.mjs)
(`npm run rules:report`) turns it into four signals:

- **Ambient floor** — the fixed cost every fresh session pays. Watch it not grow.
- **Realized per-session cost** — median / p90 tokens actually loaded.
- **Fire rates** — per scoped rule: **PROMOTE-BACK** (a "scoped" rule that
  fires in >80% of sessions is effectively ambient; stop pretending it's
  scoped) and **ZERO-FIRE** (a rule that never fires is either dead or has a
  glob gap that misses the work it's meant to govern).
- **Flip regressions** — a scoped rule loading at `session_start` is a fault in
  the scoping, full stop.

The thresholds are **pre-registered** (committed before the data), so you can't
move the goalposts to whatever a run happened to produce. And the split is
deliberate: this instrument measures **cost** (what loaded, how much), while the
[eval](./evals.md) measures **quality** (did the agent still produce correct
output with less in context?). Cost without quality is a false economy; quality
without cost is unmeasured spend. You want both dials.

## Why a product person cares

Context budget is a cost/quality lever. Every token of irrelevant context is
paid for twice: once in dollars, once in the attention it steals from the
instruction that actually prevents the bug. Deciding *what the agent sees for
this task* is the same kind of decision as deciding what a user sees on a
screen — you're designing for focus, and focus is what makes the output
reliable.
