// Illustrative — idempotency recovery + the identity-discrimination gate.
//
// Extracted (and genericized) from a real shipped reshape. Two primitives live
// here, and the second is the one worth studying:
//
//   1. Recover-not-conflict — a retry of a create returns { ok: true, data }
//      reconstructed from a recovery read, NOT { ok: false, CONFLICT }. A
//      double-click / refresh / second-device retry is a success, not an error.
//
//   2. The identity-discrimination gate — the recover-vs-conflict decision is
//      made on SERVER-SET identity, never on a client-supplied value. This is a
//      security decision disguised as an idempotency one: gate it on the wrong
//      primitive and "make signup idempotent" quietly becomes "disclose another
//      tenant's ids".
//
// Teaching sketch — stubbed, not wired to a real DB.

import type { ServiceResult } from "./withDomainEvent";

// input.userId is SERVER-STAMPED from the session at the action boundary — the
// input type deliberately exposes no client-settable userId. That stamping is
// the load-bearing invariant: a client-settable userId here would reintroduce
// the exact flaw the gate exists to close, one layer up. Pin it with a test
// that the action ignores any client-supplied userId.
interface SetupOrgInput {
  userId: string; // server-stamped, NOT from the request body
  orgSlug: string;
  orgName: string;
}

interface SetupOrgResult {
  orgId: string;
  orgSlug: string;
}

// Recovery context read from the existing org's `Org.Created` audit row. The
// ownerUserId is the server-set metadata.userId written when the org was first
// created — the authenticated owner, recoverable and trustworthy.
interface OrgRecoveryContext {
  orgId: string;
  orgSlug: string;
  ownerUserId: string;
}

// Stubs.
declare function getOrgSlugAvailability(slug: string): Promise<{ available: boolean }>;
declare function getOrgRecoveryContextBySlug(slug: string): Promise<OrgRecoveryContext | null>;
declare function isSlugConflict(err: unknown): boolean; // orgs_slug_uniq 23505
declare function provisionOrgInOneTransaction(input: SetupOrgInput): Promise<SetupOrgResult>;

/**
 * The security decision. Fires at BOTH collision sites (the pre-tx availability
 * check and the unique-constraint catch) via this one helper, so recover-vs-
 * conflict is decided in exactly one place, on authenticated identity.
 *
 * Recovers to { ok: true } ONLY for the same authenticated owner (the double-
 * click / refresh / second-device case). Everything else is CONFLICT — and the
 * two CONFLICT responses are byte-identical, so recovery leaks no information
 * about whether the slug is yours or someone else's.
 */
async function recoverOrConflictBySlug(
  input: SetupOrgInput,
): Promise<ServiceResult<SetupOrgResult>> {
  // The recovery read runs in the OUTER catch, AFTER the transaction rolled
  // back — so the transaction-local tenant scope is already gone. It must read
  // only bootstrap (policy-free) sources: the `Org.Created` audit row and the
  // `orgs` row. Reconstructing from a tenant-scoped table here would zero-row
  // under RLS (no scope set) and silently return partial data. (See LSN-020 /
  // the RLS recovery-read constraint.)
  const ctx = await getOrgRecoveryContextBySlug(input.orgSlug);

  // Fail-safe: the org exists but has no recoverable audit trail (legacy /
  // seeded row). Never silently recover something we can't attribute.
  if (!ctx) return { ok: false, code: "CONFLICT" };

  // The gate. A DIFFERENT authenticated owner picked a taken slug → CONFLICT.
  // Identical response to the fail-safe above — no disclosure.
  if (ctx.ownerUserId !== input.userId) return { ok: false, code: "CONFLICT" };

  // Same authenticated owner retrying → recover to the existing org's identity.
  return { ok: true, data: { orgId: ctx.orgId, orgSlug: ctx.orgSlug } };
}

/**
 * Idempotent org provisioning. A retry with a taken slug recovers instead of
 * 500-ing — but only for the owner. Both collision sites route through the same
 * identity gate.
 */
export async function setupOrg(
  input: SetupOrgInput,
): Promise<ServiceResult<SetupOrgResult>> {
  // Site 1 — the SEQUENTIAL retry (the common case: double-click, refresh).
  // Cheaper than the DB roundtrip and gives a clean recover/conflict before the
  // transaction even opens. A catch-only implementation would MISS this path.
  const { available } = await getOrgSlugAvailability(input.orgSlug);
  if (!available) return recoverOrConflictBySlug(input);

  try {
    const data = await provisionOrgInOneTransaction(input);
    return { ok: true, data };
  } catch (err) {
    // Site 2 — the CONCURRENT race: two requests both passed the availability
    // check, one lost the unique-constraint insert. Same gate.
    if (isSlugConflict(err)) return recoverOrConflictBySlug(input);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// WHAT NOT TO DO — the reshape an eval must catch (scripts/eval/corpus/task-004)
//
// "Make signup idempotent" invites gating the recover-vs-conflict decision on
// the client-supplied idempotency key (a per-request UUID from the browser):
//
//   async function recoverOrConflictWRONG(input, clientKey) {
//     const ctx = await getOrgRecoveryContextBySlug(input.orgSlug);
//     if (ctx?.idempotencyKey === clientKey) {          // ← WRONG PRIMITIVE
//       return { ok: true, data: { orgId: ctx.orgId } };
//     }
//     return { ok: false, code: "CONFLICT" };
//   }
//
// This is wrong BOTH ways:
//   • cross-user same key (replay or collision) → matches → recovers a
//     NON-owner → discloses another tenant's internal orgId. A tenant leak.
//   • same owner retrying from a second device → fresh key → mismatch → wrongly
//     CONFLICTed. Broken for honest clients too.
//
// The dedup key answers "is this the same request?" — never "is this the same
// principal?" Authorization is identity, and identity is server-set. That is
// why the real reshape DELETED the client key from the whole chain (service →
// action → form) rather than repurposing it. (See LSN-007.)
