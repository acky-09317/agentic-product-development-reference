# Rule 00 — Meta: tiers, the gate test, and the ledger flow

How every other rule earns its place, states its enforcement, and stays small
enough to load on every session.

> **Excerpt.** This file carries only the entries the rest of this repository cites —
> enough to show the shape and the tier discipline. Extend by the same
> pattern: one constraint per entry, tier stated, promoted from a ledger
> scar or an ADR — never authored speculatively — and path-scoped via
> `paths:` frontmatter unless it passes the gate test for the
> always-loaded core.

## The three enforcement tiers

Every rule entry states, on the entry itself, what happens when it's violated
(see [ENGINEERING_METHOD](../../ENGINEERING_METHOD.md) §3):

- **`[BLOCKING]`** — a typecheck error, a lint error, or a CI failure. Can't
  ship without an explicit override.
- **`[SILENT-DRIFT]`** — passes every automated gate and surfaces later as a
  bug. A human reviewer is the only defense; the tag says so explicitly.
- **`[STYLE]`** — convention, no functional impact.

The tag is the tier's definition, not a severity opinion: if no machine gate
catches the violation, the entry is `[SILENT-DRIFT]` no matter how dangerous.

## The gate test

- A proposed rule earns always-loaded text only if the batch's own
  verification gate goes green on the broken state — the failure would ship
  because nothing in the gate notices. If a typecheck error, a failing test,
  or a STOP already catches it, the rule is redundant with the gate and files
  as backlog instead. `[SILENT-DRIFT]` — nothing enforces the discipline but
  the review of the rule PR itself. (See the
  [slice loop](../../docs/methodology/slice-loop.md) § Post-action ledgers.)

## The post-action ledger flow

Every batch that produces a commit triages what it surfaced
([slice loop](../../docs/methodology/slice-loop.md)):

| Surfaced… | Goes to… |
| --- | --- |
| A real deviation, out of scope to fix now | tech-debt ledger |
| A discovered future capability | scope-backlog |
| A recurring pattern with < 3 instances | compression-triggers (rule-of-three) |
| A closed correction with a discovered constraint | the [lessons ledger](../../docs/structured/lessons.jsonl) |
| A candidate always-loaded rule (passes the gate test) | a rule edit |

- Ledger records are single-grain, dated, **closed** corrections — a lesson
  records a constraint already discovered and closed, with evidence; it has no
  trigger field because there is nothing left to do, only something to know.
  An open fix is tech-debt; a future capability is scope-backlog.
  `[SILENT-DRIFT]` — the ledger validator checks the schema, not the grain.
- Price an experiment by the residual judgment a live run would exercise,
  never by a clean static analysis of the already-gated deterministic parts —
  and treat high confidence it will pass as an argument FOR running, because
  the author shares the blind spot the run would catch. `[SILENT-DRIFT]`
  (`LSN-013`)
- A gate lands **before** the first change of the class it polices — a gate
  wired inside or after the change it watches protects nothing, since its
  first real catch would already have shipped ungated. At finer grain: the
  roster/scope addition lands before the PR whose edits it must watch.
  `[SILENT-DRIFT]` (`LSN-017`)

## Rules are tiered by load cost

- The always-loaded core stays tiny — only what the gate test proves must be
  ambient. Everything else is **path-scoped** via `paths:` frontmatter and
  enters context only when a governed file is read. `[SILENT-DRIFT]` — an
  over-ambient corpus dilutes attention without failing anything.
- Scoping is **measured, never assumed**: a hook logs each instruction-file
  load (the `InstructionsLoaded` log), and `npm run rules:report` grades the
  pre-registered signals — **PROMOTE-BACK** (a "scoped" rule firing in >80% of
  sessions is ambient in disguise), **ZERO-FIRE** (a rule that never fires has
  a glob gap), a flip fault on any scoped rule loading at session start, and
  an ambient floor compared against its committed baseline. `[SILENT-DRIFT]` —
  the report is an instrument, not a gate. (See
  [context engineering](../../docs/methodology/context-engineering.md).)

Genericized from the source system.
