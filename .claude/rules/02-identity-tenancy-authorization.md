---
paths: ["packages/auth/**", "packages/http/**", "packages/server/src/queries/**"]
---

# Rule 02 — Identity, tenancy & authorization

Who may do what, decided in exactly one place, on exactly three axes.

> **Excerpt.** This file carries only the entries the rest of this repository cites —
> enough to show the shape and the tier discipline. Extend by the same
> pattern: one constraint per entry, tier stated, promoted from a ledger
> scar or an ADR — never authored speculatively — and path-scoped via
> `paths:` frontmatter unless it passes the gate test for the
> always-loaded core.

## The three axes, composed at the handler — and only the handler

From [ADR-001](../../docs/architecture/001-tenancy-boundary.md) and the sketch
in [`src/example/permissions.ts`](../../src/example/permissions.ts):

- Every authorization decision is a composition of exactly three orthogonal
  axes — **role** (what you can do as a member of this org), **capability**
  (what features this org has), **resource** (does this org own this specific
  row?) — enforced at the handler, and *only* at the handler. UI may read
  permissions for rendering; it never decides access. `[SILENT-DRIFT]` — a
  check moved below the handler passes typecheck and rots into an implicit
  assumption.
- The **resource check is an explicit call at the gate**, never skipped
  because "the row's orgId matches anyway". Implicit checks rot; the explicit
  call is what keeps the audit surface obvious. `[SILENT-DRIFT]`
- **No fourth axis.** Every pressure for one ("team permissions", "delegated
  access", "time-limited access") decomposes into a role on some membership, a
  capability on some org, or a scope on some resource. If it can't, the *data
  model* is wrong, not the auth model. `[SILENT-DRIFT]` — a fourth axis ships
  as ordinary code and calcifies.

## Authentication vs authorization

- **Authentication lives in `packages/http`; authorization lives in
  handlers. Never mix** ([CLAUDE.md](../../CLAUDE.md) § Request chain).
  `[SILENT-DRIFT]`
- Services and queries **never make access decisions and never read
  cookies** — they receive the resolved auth context from the request
  boundary (ADR-001 § Consequences). `[SILENT-DRIFT]` — a cookie read below
  the boundary is a second, unaudited resolution path.
- Row-Level Security is the storage-layer boundary *beneath* the handler gate
  — defense-in-depth, never a replacement for it. Both apply (ADR-001).
  `[SILENT-DRIFT]` — reading RLS as "the handler check is optional" is the
  drift this entry exists to stop.

Genericized from the source system.
