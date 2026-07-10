// Illustrative — the three RLS classes, including deferred-ownership.
//
// Row-Level Security is the tenant boundary beneath the handler (ADR-001). The
// naive model is "every tenant table has an org_id column and the policy filters
// on it." Real schemas break that assumption, and the interesting primitive is
// what you do when a tenant table has NO direct org_id.
//
// Three classes (a declaration drives policy generation; this is a sketch of the
// shapes, not a live generator):

export type RlsClass = "bootstrap" | "ownership" | "deferred-ownership";

// The acting org is set transaction-locally before any query (see withDomainEvent
// / dbForOrg): `set_config('app.current_org', $1, true)`. Policies filter on it.
// missing_ok (the trailing `true`): an unset scope reads NULL, so policies filter
// to zero rows (silent, fail-closed) instead of erroring — this is what makes the
// recovery-read lesson's "silently zero-rows" true.
const GUC = "current_setting('app.current_org', true)";

// ── class 1: bootstrap (no policy) ─────────────────────────────────────
// Tables read/written BEFORE an acting org can be set, or that legitimately
// carry no org (an anonymous contact form; an append-only audit log whose org
// lives in a JSON metadata field and is sometimes absent). No RLS policy — the
// handler or a verified token is the gate. These are exactly the tables a
// post-rollback recovery read may touch unscoped (idempotentRecovery.ts).
//   e.g. event_log, invites, contact_submissions

// ── class 2: ownership (direct org_id) ─────────────────────────────────
// The common case: the table has its own org_id column. The policy is a direct
// equality against the acting-org GUC.
export function ownershipPolicy(table: string): string {
  return `CREATE POLICY ${table}_tenant ON ${table}
    USING (org_id = ${GUC})
    WITH CHECK (org_id = ${GUC});`;
}

// ── class 3: deferred-ownership (no direct org_id) ─────────────────────
// The primitive worth studying. A real tenant table whose scope is NOT a local
// org_id column. Two shapes:
//
//  (a) a differently-named scope column (a buyer_orgs row is scoped to the
//      SELLER org that owns it, via seller_org_id — not org_id):
export function scopeColumnPolicy(table: string, scopeColumn: string): string {
  return `CREATE POLICY ${table}_tenant ON ${table}
    USING (${scopeColumn} = ${GUC})
    WITH CHECK (${scopeColumn} = ${GUC});`;
}

//  (b) FK-INHERITED EXISTS — the table carries no scope column at all; tenancy
//      is reached only by walking a foreign key to a parent that has it. A
//      buyer_org_contacts row is a tenant of whatever seller owns its
//      buyer_org. The policy is an EXISTS subquery through the parent:
export function fkInheritedPolicy(
  table: string,
  fkColumn: string,
  parent: string,
  parentScopeColumn: string,
): string {
  return `CREATE POLICY ${table}_tenant ON ${table}
    USING (EXISTS (
      SELECT 1 FROM ${parent} p
      WHERE p.id = ${table}.${fkColumn}
        AND p.${parentScopeColumn} = ${GUC}
    ))
    WITH CHECK (EXISTS (
      SELECT 1 FROM ${parent} p
      WHERE p.id = ${table}.${fkColumn}
        AND p.${parentScopeColumn} = ${GUC}
    ));`;
}

// A declaration table names the class per table; the coverage gate
// (assertRlsCoverage, below) fails closed if any live tenant table is missing
// from it.
export const RLS_DECLARATIONS: Record<string, RlsClass> = {
  event_log: "bootstrap",
  invites: "bootstrap",
  products: "ownership", // org_id local
  buyer_orgs: "deferred-ownership", // seller_org_id
  buyer_org_contacts: "deferred-ownership", // FK-inherited via buyer_org_id → buyer_orgs.seller_org_id
};

// Generate the policy for a declared table.
export function policyFor(table: string): string | null {
  switch (RLS_DECLARATIONS[table]) {
    case "bootstrap":
      return null; // no policy — handler/token is the gate
    case "ownership":
      return ownershipPolicy(table);
    case "deferred-ownership":
      // shape chosen per table by its schema; two examples:
      if (table === "buyer_orgs") return scopeColumnPolicy(table, "seller_org_id");
      if (table === "buyer_org_contacts")
        return fkInheritedPolicy(table, "buyer_org_id", "buyer_orgs", "seller_org_id");
      return null;
    default:
      return null;
  }
}

// ── Why the third class is load-bearing, not academic ──────────────────
// The "every tenant table has org_id" assumption isn't just incomplete — acting
// on it is dangerous. A generator that only knows the ownership shape would,
// facing buyer_org_contacts (no org_id), either (a) emit a broken policy on a
// non-existent column, or (b) skip the table — leaving a real tenant table with
// NO storage-layer boundary at all. Naming deferred-ownership as its own class,
// and forcing every live table into the declaration via a fail-closed coverage
// gate, is what prevents a silently-unprotected tenant table.

// The fail-closed coverage gate: every live table must appear in
// RLS_DECLARATIONS — a new table absent from the census fails, never
// default-allows.
export function assertRlsCoverage(liveTables: string[]): void {
  const missing = liveTables.filter((t) => !(t in RLS_DECLARATIONS));
  if (missing.length > 0)
    throw new Error(`tables missing an RLS declaration: ${missing.join(", ")}`);
}
