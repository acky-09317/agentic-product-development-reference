---
paths: ["packages/**", "apps/**"]
---

# Rule 01 — Domain architecture: layers, dependency direction, request chain

Where code lives, which way imports point, and the chain every request flows
through.

> **Excerpt.** This file carries only the entries the rest of this repository cites —
> enough to show the shape and the tier discipline. Extend by the same
> pattern: one constraint per entry, tier stated, promoted from a ledger
> scar or an ADR — never authored speculatively — and path-scoped via
> `paths:` frontmatter unless it passes the gate test for the
> always-loaded core.

## The layer table

From [CLAUDE.md](../../CLAUDE.md) § Monorepo shape:

| Package | Owns |
| --- | --- |
| `apps/web` | routes only; imports from `http` |
| `packages/http` | server actions + query functions (the consumption layer) |
| `packages/server` | handlers, commands, services, queries, events, workflows |
| `packages/auth` | session validation, org resolution, the three ABAC guards |
| `packages/db` | schema + migrations + RLS declarations (single DB source of truth) |
| `packages/types` | shared types (re-exports domain constants from db) |
| `packages/ui` | primitives + patterns (no data fetching, no server imports) |
| `packages/lib` | cross-cutting: env, logging, rate-limit (leaf) |

## Dependency direction

- Imports point one way down the table: `apps` → `http` → (`auth`, `server`,
  `lib`) → (`db`, `types`); `lib` and `types` are leaves. No package imports
  from an app, and no import cycles between packages. `[SILENT-DRIFT]` — a
  cycle or an uphill import compiles fine and surfaces later as a coupling
  that blocks a refactor.
- `packages/ui` never imports from a server-side package — its bundles ship
  to the client, so a server import leaks env and secrets into the browser
  build. `[SILENT-DRIFT]`
- App routes consume server logic only via `packages/http` — never directly
  from `server`, `db`, or `auth`. Direct imports bypass the single
  session → authorization wiring point. `[SILENT-DRIFT]`

## The request chain (non-negotiable)

From [CLAUDE.md](../../CLAUDE.md) § Request chain:

1. **Session** — validate via the framework helper (never parse cookies by
   hand).
2. **Org** — resolve from the URL, verify active membership, get `orgId` or
   404.
3. **Auth context** — load role + capabilities at the request boundary.
4. **Handler** — enforce the three axes (role / capability / resource).
5. **Command / query** — business logic / reads; receives the context, never
   reads cookies itself.

- Every request flows through this chain in this order; authentication lives
  in `http`, authorization lives in handlers, and no layer below the request
  boundary reads cookies or headers. `[SILENT-DRIFT]` — a skipped step is an
  authorization bypass that no typecheck notices. (Rule 02 owns the
  authorization detail.)

Genericized from the source system.
