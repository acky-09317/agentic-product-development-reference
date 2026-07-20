---
id: ADR-001
title: The tenant boundary is multi-layered and fails closed
status: accepted
affects:
  - packages/auth/**
  - packages/db/src/rls/**
  - packages/db/src/schema/**
  - packages/db/src/client.ts
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

## A second scope, for a read the acting org can't express

Every scoping decision so far sets one session variable — `app.current_org` —
from a verified source, and everything filters on it. That covers every read and
write a *member* performs. It does not cover one specific read: a person who has
just verified their email needs to discover *which sellers already hold a record
for them*, before they are a scoped member of any org. In a marketplace where
buyers exist first as records the seller created (the deferred-ownership class
above), this "which sellers know me?" scan deliberately spans sellers, keyed on
the verified email — and there is no acting org to scope it with. Widening
`app.current_org` to cover it would blow the tenant boundary wide open.

The answer is a **second, narrower connection-scoping variable**,
`app.claim_email`, with four properties that keep it from becoming a hole:

1. **One writer, one reader.** It is set only by a dedicated read wrapper
   (`dbForClaimEmail`) and read only by a single policy branch — a
   `claim_discovery` policy that is `FOR SELECT` **only**. Read-only by
   construction, so the second scope can never authorize a write.
2. **Server-derived, never client-asserted.** The value is the email the
   session already verified by one-time code — the same closed-set discipline as
   the acting org. Client input never reaches a scoping variable.
3. **The wrappers never nest.** Reads pick exactly one wrapper per operation
   (`dbForOrg` sets `app.current_org`; `dbForClaimEmail` sets
   `app.claim_email`); writes use the transaction helper. Setting *both*
   variables in one transaction is a **forbidden state, not a feature** —
   Postgres permissive policies OR-compose, so a nested scope would *union*
   seller-scoped and claim-scoped visibility into a superset read neither source
   authorized. There is deliberately no "both" wrapper to reach for; the
   doctrine is the enforcement.
4. **The output is minimal and doesn't leak sideways.** The scan returns only
   the seller-edge set the claim decision needs, and those rows never reach a
   seller-scoped DTO.

This makes the closed set of authorization sources **five**: four scope
`app.current_org` (a verified membership; an audited admin impersonation
session; a platform-admin acting on a target; a guest's signed single-resource
token) and the fifth scopes `app.claim_email` and nothing else. The set is
closed on purpose — adding a source, or a second GUC like this one, is an
architectural review against the whole transport invariant, never a parameter
change.

The payoff is **per-edge scope matching**: the source-5 discovery scan hands
back the seller edges that match the verified email; when the principal claims
one, the follow-up *write* is scoped to *that seller's* org (a normal
acting-org write), matched per-edge to the read that produced it. A narrow read
informs a narrow write, and at no point is a wide scope opened to bridge them.
Sketch: [`src/example/claimDiscovery.ts`](../../src/example/claimDiscovery.ts).

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
