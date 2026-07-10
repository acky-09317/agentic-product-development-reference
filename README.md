# Agentic Product Development Reference

An AI coding agent is fast, capable, and unreliable. This repository
demonstrates the operating system that makes one safe to delegate to on a
multi-tenant SaaS codebase: rules enforced by machines instead of memory, an
eval that scores the agent's diffs, and a memory that outlives any context
window. Everything here is either runnable in place or explicitly labeled as
described-from-the-source-system.

It is the short-form counterpart of
[ENGINEERING_METHOD.md](./ENGINEERING_METHOD.md), which walks the whole method
in one read.

## Run it

```bash
npm install

npm run eval               # score the corpus of recorded agent diffs, print a scorecard
npm run check              # lessons gate + citation check + preservation canary + examples typecheck
npm run context -- packages/server/src/domain/orders/commands.ts
                           # print the ADRs, roadmap parts, and lessons that govern a path
```

## What runs here vs. what is described

| Live in this repo | Described from the source system |
| --- | --- |
| Lessons-ledger gate (`npm run check:lessons`) | The RLS coverage gate wired into CI |
| Citation check (`npm run check:context-citation`) | The commit-msg hook validating trailers |
| The eval harness (`npm run eval`, LLM-judge with offline fallback) | The source system's preservation table ([CLAUDE.md](./CLAUDE.md), shown for shape) |
| Preservation canary for this repo (`npm run check:preservation`) | The full rule corpus — excerpted here per [`.claude/rules/`](./.claude/rules/) |
| Examples typecheck (`npm run check:examples`) | The hook wiring that emits the instruction-load log (the appender + format contract ship here: [`scripts/telemetry/`](./scripts/telemetry/)) |
| Resolver regression tests (`npm test`) | |
| Rule-loading telemetry report (`npm run rules:report`) | |

## The tree

| Where | What |
| --- | --- |
| [`docs/structured/`](./docs/structured/) | Machine-readable memory: the lessons ledger + roadmap spine (JSONL) |
| [`docs/architecture/`](./docs/architecture/) | ADRs with `affects:` front matter the path resolver reads |
| [`docs/methodology/`](./docs/methodology/) | Modes · slice loop · context engineering · evals · verification matrix · preservation boundaries · a worked example plan |
| [`scripts/`](./scripts/) | The gates, the resolver, the eval harness, the telemetry report — plain Node, zero runtime deps |
| [`src/example/`](./src/example/) | Teaching sketches of the load-bearing code patterns (transaction helper, three-axis authorization, idempotency recovery, testable listener, the three RLS classes) |
| [`.claude/`](./.claude/) | The agent's rule excerpts (tiered, path-scoped) and seed templates |
| [`CLAUDE.md`](./CLAUDE.md) | The agent's operating manual, including the drift-canary tables |

## Licensing

Code (`scripts/**`, `src/**`, embedded code blocks) is [MIT](./LICENSE). Prose
documentation (`docs/**` and root Markdown) is
[CC BY-SA 4.0](./LICENSE-docs) — reuse it freely, with attribution, under the
same license. If this repository informs your own methodology writing, a link
back is the attribution asked for ([CITATION.cff](./CITATION.cff)).

## Provenance

The product domain throughout is a placeholder — "Acme Commerce", a
multi-tenant B2B marketplace. The method is real and extracted from a
production system; the entities, examples, and sample records are invented for
the placeholder domain. Nothing here is production data or production code.
