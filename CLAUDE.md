# CLAUDE.md

The operating manual the coding agent loads on every session. In the real
system this file is large; here it's a genericized, trimmed version that shows
the *shape* — especially the preservation-boundary drift-canary system, which is
the part most people haven't seen before.

> Placeholder domain: "Acme Commerce", a multi-tenant B2B marketplace. Nothing
> here is real product code.

## Commands

```bash
npm run eval                 # score agent diffs against the corpus
npm run check                # run the machine-readable-context gates
npm run context -- <path>    # what governs this file?
```

## Monorepo shape

```
apps/web                 the app (routes only; imports from http)
packages/http            server actions + query functions (the consumption layer)
packages/server          handlers, commands, services, queries, events, workflows
packages/auth            session validation, org resolution, the three ABAC guards
packages/db              schema + migrations + RLS declarations (single DB source of truth)
packages/types           shared types (re-exports domain constants from db)
packages/ui              primitives + patterns (no data fetching, no server imports)
packages/lib             cross-cutting: env, logging, rate-limit (leaf)
```

Dependency direction and the no-cycle rule live in
[rule 01](./.claude/rules/01-domain-architecture.md).

## Request chain (non-negotiable)

1. **Session** — validate via the framework helper (never parse cookies by hand).
2. **Org** — resolve from the URL, verify active membership, get `orgId` or 404.
3. **Auth context** — load role + capabilities at the request boundary.
4. **Handler** — enforce the three axes (role / capability / resource).
5. **Command / query** — business logic / reads; receives the context, never
   reads cookies itself.

Authentication lives in `http`. Authorization lives in handlers. Never mix.

## Key patterns

- **Every mutation** goes through `withDomainEvent()` — state + audit atomic,
  dispatch after commit ([ADR-002](./docs/architecture/002-event-sourced-mutations.md)).
- **RLS is the tenant boundary** beneath the handler gate — both apply
  ([ADR-001](./docs/architecture/001-tenancy-boundary.md)).
- **Every slice** follows the [slice loop](./docs/methodology/slice-loop.md),
  behind a feature flag.
- **Types** are owned once in `packages/db` and re-exported — never redefined.

## On-demand references

Load per task, not by default (see
[context engineering](./docs/methodology/context-engineering.md)):

- The path-scoped rules under [`.claude/rules/`](./.claude/rules/) load when you
  read a file they govern. Run `npm run context -- <path>` to see which.
- The seed templates in [`.claude/seeds/`](./.claude/seeds/) instantiate a Plan
  or Direct batch.

---

## Preservation boundaries (the drift-canary system)

> The full rationale is in
> [docs/methodology/preservation-boundaries.md](./docs/methodology/preservation-boundaries.md).
> Two tables follow: the source system's enforcement table (an excerpt, shown
> for shape) and this repo's own live boundaries (enforced here by
> `npm run check`).

Each directory has an enforcement class. A check compares the current file
count to the baseline; drift in a hard class fails the build. This is how an
agent's out-of-scope edit trips a canary at commit time instead of at review
time three days later (lesson `LSN-004`).

### The enforcement table from the source system (excerpt, shown for shape)

#### Frozen — count must match exactly (CI-enforced)

Production source observed stable across a phase. Drift fails the build.

| Directory | Count | Note |
| --- | --- | --- |
| `packages/auth/src/` | 13 | session + org resolution + the three ABAC guards |
| `packages/lib/src/` | 11 | env, logging, rate-limit |

#### Append-only — shrink fails (CI-enforced)

Lower-bound enforcement; new files fine, deletions are a scope breach.

| Directory | Baseline | Note |
| --- | --- | --- |
| `packages/db/migrations/` | 6 | one file per migration above the baseline |
| `docs/` | 20 | handbook + ADRs + method docs + plans |

#### Watch — drift reported, never blocks (graduation period)

Looks stable but hasn't been observed long enough to freeze. Drift logs as
`[WATCH-DRIFT]`; graduates to frozen after a clean phase.

| Directory | Count | Note |
| --- | --- | --- |
| `packages/server/src/` | 31 | active growth across the current phase |
| `packages/ui/src/` | 242 | primitives + patterns |

#### Tracked — active growth, baseline moves at phase boundaries

Drift expected; CI prints actuals but never fails.

| Directory | Baseline | Note |
| --- | --- | --- |
| `apps/web/src/` | 115 | routes under the current URL grammar |

**If a task requires editing a frozen file not in the current batch's scope:
STOP and confirm.** The count is a crude signal on purpose — it can't tell you
*what* drifted, only *that* something did. That's enough to make the review fire;
precision is the review's job.

### This repo's own live boundaries

Enforced here by `npm run check`
([`scripts/check-preservation.mjs`](./scripts/check-preservation.mjs)) — the
mechanism above, running for real against this repository:

| Directory | Class | Baseline |
| --- | --- | --- |
| `src/example/` | frozen | 6 |
| `scripts/eval/lib/` | frozen | 4 |
| `scripts/eval/corpus/` | append-only | ≥ 6 |
| `docs/` | append-only | ≥ 13 |

## Auto-generated files

Never hand-edit these; regenerate them. On a merge conflict, reset to HEAD and
re-run the generator — hand-merging a generated artifact produces something
syntactically valid but semantically half-correct.

| Artifact | Regenerate with |
| --- | --- |
| migration SQL + journal | the schema generator, then rename per the runbook |
| the schema doc | the schema-doc generator |
