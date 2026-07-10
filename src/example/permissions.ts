// Illustrative — the three-axis authorization model (ADR-001, rule 02).
//
// Every authorization decision composes exactly three orthogonal axes:
//   • Role       — what you can do as a member of this org
//   • Capability — what features this org has (an entitlement)
//   • Resource   — does this org own this specific row?
//
// There is deliberately NO fourth axis. This file is the shape of the enforcers
// and the role matrix; it's a teaching sketch, not wired to a real DB.

export type Role = "owner" | "admin" | "member";

// Capabilities are org entitlements, granted at org creation / plan tier.
export type Capability =
  | "MANAGE_CATALOG"
  | "MANAGE_BUYERS"
  | "CREATE_ORDERS"
  | "MANAGE_MEMBERS";

export interface AuthContext {
  userId: string;
  orgId: string;
  role: Role;
  capabilities: Capability[];
}

export class AuthError extends Error {
  constructor(public code: "FORBIDDEN" | "NOT_IN_ORG") {
    super(code);
  }
}

// ---- Axis 1: Role — the permission matrix ----
//
// The matrix is the single source of truth for who can do what in each domain.
// Owner-only escalation is a CELL VALUE, not an inline `if (role !== "owner")`
// guard scattered through handlers. Adding a precise action (invite-owner vs.
// invite-admin) is one cell, not a new authorization axis.
const PERMISSION_MATRIX = {
  catalog: {
    "update-product": ["owner", "admin"],
    "delete-product": ["owner"],
  },
  members: {
    "invite-admin": ["owner", "admin"],
    "invite-owner": ["owner"],
  },
} as const satisfies Record<string, Record<string, readonly Role[]>>;

type Domain = keyof typeof PERMISSION_MATRIX;

/** Non-throwing check — for rendering (UI may READ permissions, never DECIDE). */
export function canPerform<D extends Domain>(
  ctx: AuthContext,
  domain: D,
  action: keyof (typeof PERMISSION_MATRIX)[D],
): boolean {
  const allowed = PERMISSION_MATRIX[domain][action] as readonly Role[];
  return allowed.includes(ctx.role);
}

/** Throwing enforcer — for handlers. The `action` arg is per-domain typed, so a
 *  typo fails at compile time, not runtime. */
export function requirePermission<D extends Domain>(
  ctx: AuthContext,
  domain: D,
  action: keyof (typeof PERMISSION_MATRIX)[D],
): void {
  if (!canPerform(ctx, domain, action)) throw new AuthError("FORBIDDEN");
}

// ---- Axis 2: Capability — does this org have the feature? ----
export function requireCapability(ctx: AuthContext, cap: Capability): void {
  if (!ctx.capabilities.includes(cap)) throw new AuthError("FORBIDDEN");
}

// ---- Axis 3: Resource — does this org own this row? ----
export function requireResourceInOrg(ctx: AuthContext, resourceOrgId: string): void {
  // Never skipped because "the row's org already matches" — implicit checks rot
  // into cross-tenant reads (rule 02). The handler is the single, explicit gate.
  if (resourceOrgId !== ctx.orgId) throw new AuthError("NOT_IN_ORG");
}

// ---- Canonical composition: all three axes in one handler ----
//
// Copy this shape for any handler that mutates a per-row resource. This is the
// ONLY place authorization lives — services and queries below this never decide
// access.
declare function updateProductService(
  ctx: AuthContext,
  input: { productId: string; name: string },
): Promise<{ ok: true } | { ok: false; code: string }>;
declare function loadProductOrgId(productId: string): Promise<string>;

export async function handleUpdateProduct(
  ctx: AuthContext,
  input: { productId: string; name: string },
): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    requirePermission(ctx, "catalog", "update-product"); // role
    requireCapability(ctx, "MANAGE_CATALOG"); // capability
    requireResourceInOrg(ctx, await loadProductOrgId(input.productId)); // resource
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, code: err.code };
    throw err;
  }
  return updateProductService(ctx, input);
}
