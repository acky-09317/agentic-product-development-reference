---
id: ADR-001
title: The tenant boundary is multi-layered and fails closed
status: accepted
affects:
  - packages/auth/**
  - packages/db/src/rls/**
  - packages/db/src/schema/**
  - packages/server/src/queries/**
  - packages/http/src/queries/admin/**
---

# ADR-001 — The tenant boundary is multi-layered and fails closed

> Placeholder domain: "Acme Commerce", a multi-tenant B2B marketplace. Every
> row of business data belongs to exactly one org (tenant). The whole system's
> correctness rests on org A never reading or writing org B's data.

## Context

Multi-tenant SaaS has exactly one unforgivable bug class: a cross-tenant data
leak. It is unforgivable because it's silent — no error, no crash, no failing
test. The failure mode *is* the discovery, in production, by someone who
shouldn't have had access. An AI agent writing queries makes this worse: it
will faithfully write a query without a tenant filter if the spec doesn't
mention one (see lesson `LSN-005`).

So the boundary can't rest on any single layer — least of all on remembering
to write a `WHERE orgId = ?` clause.

## Decision

Enforce tenancy in **depth**, with each layer failing closed:

1. **Authorization (the decision layer).** A three-axis model composed at the
   handler, and *only* at the handler:
   - **Role** — what you can do as a member of this org (owner/admin/member).
   - **Capability** — what features this org has (an entitlement).
   - **Resource** — does this org own this specific row?

   The three are orthogonal. There is deliberately **no fourth axis** — every
   pressure for one ("team permissions", "delegated access", "time-limited
   access") decomposes into a role on some membership, a capability on some
   org, or a scope on some resource. If it can't, the *data model* is wrong,
   not the auth model.

2. **Row-Level Security (the storage layer).** Postgres RLS (FORCE) is the
   tenant boundary *beneath* the handler gate — defense-in-depth, not a
   replacement. Every transaction sets a session variable to the acting org,
   and every policy filters on it. A wrong-org read returns zero rows; a
   wrong-org write fails the check constraint. The database fails closed even
   if a query forgets its filter.

3. **The multi-channel rule.** The tenant boundary applies to *every* channel
   that stores or transmits org-scoped data — not just Postgres. Cache keys
   are prefixed with the org id; error-reporting and log payloads carry scalar
   identifiers only, never DTOs or domain objects. A leak through the log
   stream is the same incident as a leak through the database. Admin reads
   never route through a telemetry or cache channel — those carry no tenant
   scope at all.

## The denormalization trap (why `LSN-002` exists)

If a table denormalizes `org_id` for a read path, that column can *drift* from
its parent's scope. Under FORCE RLS a drifted `org_id` makes the policy filter
on a wrong-but-self-consistent value — a silent cross-tenant read no test
catches. So: any table that denormalizes a scope column carries a composite
foreign key to its parent's `(id, org_id)`, all the way up the ownership
ladder. If the composite FK isn't being added, the column is dropped and scope
is derived through the parent join. The structural guarantee replaces the hope
that the column stays consistent.

## Three RLS classes — not every tenant table has an `org_id`

The naive RLS model assumes every tenant table has its own `org_id` column and
the policy filters on it. Real schemas break that, and acting on the assumption
is dangerous: a table with no `org_id` either gets a broken policy on a
non-existent column, or gets skipped — leaving a genuine tenant table with *no
storage-layer boundary at all*. So tenancy is a declared, three-class model, and
a fail-closed coverage gate forces every live table into one class (a new table
absent from the declaration fails CI — never default-allowed):

1. **bootstrap** — no policy; the handler or a verified token is the gate. For
   tables read/written *before* an acting org can be set, or that legitimately
   carry no org (an anonymous contact form; an append-only audit log whose org
   lives in metadata and is sometimes absent). These are exactly the tables a
   post-rollback recovery read may touch unscoped (`LSN-020`).

2. **ownership** — the table has its own `org_id`; the policy is a direct
   equality against the acting-org session variable.

3. **deferred-ownership** — a real tenant table whose scope is *not* a local
   `org_id`. Two shapes: a differently-named scope column (a buyer-org is scoped
   to the *seller* org that owns it, via `seller_org_id`), or — when the table
   carries no scope column at all — an **FK-inherited `EXISTS`** policy that
   reaches tenancy by walking a foreign key to a parent that has it (a
   buyer-org-contact is a tenant of whatever seller owns its buyer-org). This is
   the shape "buyer-first-class" needs: buyers and their contacts/addresses are
   tenants of the seller org, not first-class org owners, so their boundary is
   *inherited* through the FK chain, not stored locally.

Sketch of all three policy shapes:
[`src/example/rlsPolicies.ts`](../../src/example/rlsPolicies.ts).

The deferred-ownership class is what lets the marketplace add a whole
counterparty subtree (buyers under sellers) without either denormalizing
`org_id` down the tree (the drift trap above) or leaving those tables
unprotected. The FK-inherited policy costs a subquery per row-check; that's the
price of a correct boundary on a table that has no business owning a scope
column of its own.

## Develop under the boundary, not around it

RLS is only a real safety net if you develop *against* it. Connect to the local
database as the owner role and FORCE RLS is bypassed — every query returns every
org's rows, and a missing tenant filter looks perfectly fine right up until it
ships. So a one-command dev bootstrap (`db:dev:setup`) provisions the local
branch to mirror production: migrate, apply the policies, and repoint the local
connection at the *application* role (the one RLS actually constrains), not the
owner. Develop as the role the attacker would be.

This is what turns "the recovery read forgot its scope" or "the constraint
detector reads the wrong error field" from a production incident into a local red
test — `LSN-010` is exactly that bug: a detector that went green locally (owner
connection, RLS bypassed) and failed only once the integration suite ran under
the real application role with FORCE on. The boundary you don't develop against
is the boundary you discover in prod.

## Consequences

- The handler is the single authorization gate; services and queries never
  make access decisions or read cookies. This keeps the audit surface small
  and obvious.
- RLS makes "forgot the filter" a fail-closed zero-rows bug instead of a
  fail-open leak — but the handler guard still exists, because RLS is depth,
  not the decision.
- The tenant-safety **eval dimension** is blocking (see
  [evals](../methodology/evals.md)) precisely because this boundary is the one
  no other automated gate reliably catches.

## Status

Accepted. Shipped as roadmap part `PART-A`.
