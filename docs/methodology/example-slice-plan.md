# Example Plan output — "Add a currency field to listings"

This is what a **Plan** batch produces: contracts, not code. It's the confirmed
artifact a Direct batch then executes against. (It corresponds to
[`task-001`](../../scripts/eval/corpus/task-001-add-listing-currency.json) in the
eval corpus — the two are the same slice seen from the plan side and the
scored-diff side.)

Note what's here (DDL, signatures, file inventory, a decomposition by gate) and
what's deliberately absent (function bodies, query chains). That cleavage is the
Plan-mode invariant.

---

## Goal

Add an ISO-4217 `currency` to listings so prices can be denominated per listing.
**Why:** the marketplace is onboarding non-USD sellers; today currency is
implicit-USD, which will silently misprice the moment a EUR seller lists.

## Context consulted

`npm run context -- packages/db/src/schema/domains/catalog/listings.ts` prints,
verbatim:

```
Governing context for 1 path(s):

  Architecture decisions:
    • ADR-001 — The tenant boundary is multi-layered and fails closed  (docs/architecture/001-tenancy-boundary.md)

  Roadmap parts:
    • PART-C [shipped] — Catalog identity spine (Product → Variant → SKU)  (spec: docs/methodology/example-slice-plan.md)

  Active lessons (constraints learned the hard way):
    • LSN-002 — Denormalized org_id drifted from its parent's scope under RLS
        → A denormalized org_id column that isn't pinned to its parent lets a row's tenant scope diverge from its parent's.  (.claude/rules/09-security-rules.md)
    • LSN-004 — Eager agent edited an adjacent frozen file, green typecheck
        → An agent will 'helpfully' edit a file adjacent to its slice — a shared primitive, a config — and the edit passes typecheck, so nothing catches it until review, days later.  (docs/methodology/preservation-boundaries.md)
```

## Contracts

### Schema (DDL only)

```sql
ALTER TABLE listings ADD COLUMN currency text NOT NULL DEFAULT 'USD';
-- CURRENCIES const defined once in packages/db, re-exported via packages/types.
-- No composite FK needed: currency is not a scope column (LSN-002 does not apply).
```

### Type ownership

```ts
// packages/db/src/schema/.../listings.ts
export const CURRENCIES = ["USD", "EUR", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];
// packages/types re-exports — never an independent `as const` (rule 05).
```

### Query / DTO signature (no body)

```ts
// ListingDTO gains: currency: Currency
// getListing(ctx, id) keeps its org filter; maps null → undefined (rule 05).
```

## File inventory

| File | Create / modify |
| --- | --- |
| `packages/db/src/schema/domains/catalog/listings.ts` | modify (column + const) |
| `packages/db/migrations/NNNN_listings_currency_column.sql` | create (renamed from the generator's random name) |
| `packages/server/src/queries/catalog.queries.ts` | modify (projection + DTO) |
| `packages/types/src/catalog.ts` | modify (re-export) |
| `packages/server/src/__tests__/integration/catalog-currency.test.ts` | create |

Blast-radius budget: **6 files.** (The eval flags anything wider.)

## Decomposition by verification gate

One coherent gate covers this whole slice (typecheck + one integration test),
so it's a **single Direct batch**, not several. If the DTO change rippled into a
UI page, that page would be a *second* batch (a render-check gate, not an
integration-test gate).

## Verification checklist

- [ ] migration renamed to describe the change; journal tag updated
- [ ] `CURRENCIES` defined once in db, re-exported (no `as const` in types)
- [ ] DTO exposes `currency`; query maps null → undefined; org filter intact
- [ ] integration test asserts default backfill + round-trip
- [ ] `npm run eval` scores the resulting diff ✅ (expect a clean pass)

## Pushback

No contradictions. `currency` is a plain attribute, not a scope column — so
LSN-002's composite-FK requirement does **not** apply here; calling it out so a
Direct batch doesn't over-engineer a needless FK.

## Out of scope for this slice

- Price *conversion* / FX (a separate Commerce concern).
- Any UI surfacing of currency (a separate render-gated batch).
