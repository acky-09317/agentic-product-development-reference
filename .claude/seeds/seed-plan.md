# Seed — Plan batch

Template excerpt — instantiate per [modes.md](../../docs/methodology/modes.md)
and extend by the same pattern. A completed instantiation:
[the example slice plan](../../docs/methodology/example-slice-plan.md).

---

MODE: Plan only — derive contracts, write nothing.

## Goal

<what capability this slice adds, one sentence>
**Why:** <the product reason — what breaks or is missed without it>

## Context consulted

```
npm run context -- <the paths this slice touches>
→ <paste the resolver output verbatim — the governing ADRs / parts / lessons>
```

## Contracts

### Schema (DDL only)

```sql
<ALTER/CREATE statements — no data manipulation>
```

### Type ownership

<which constants/types are defined in packages/db, and where they re-export>

### Signatures (no bodies)

<command / handler / query / DTO signatures — types only; a function body here
is a mode violation>

## File inventory

| File | Create / modify |
| --- | --- |
| <path> | <create \| modify (what)> |

Blast-radius budget: **N files.** (The eval flags anything wider.)

## Decomposition by verification gate

<which single coherent gate proves this slice done; if two gates are needed,
name the two batches>

## Verification checklist

- [ ] <the specific checks the Direct batch must go green on>

## Pushback

<contradictions with existing conventions, footguns (silent null writes, races,
authorization bypasses, transaction-ordering errors), or unverifiable
assumptions found while planning — raised here, before any code>

## Out of scope for this slice

- <adjacent work this plan deliberately does NOT include>
