// Illustrative — a cross-domain listener, extracted for testability.
//
// Cross-domain reactions happen by CHOREOGRAPHY: the emitting domain commits its
// state + event and knows nothing about who reacts; the consuming domain owns a
// listener that reacts to the event. (See ADR-002.) This file shows the shape
// that makes such a listener integration-testable — the primitive a retrofit
// pass applied to three inlined listeners.
//
// The move: extract the handler as a NAMED EXPORT ({verb}Fn) and keep the job-
// runner wiring (registerListener) as a thin shell below it. The handler is then a
// plain async function a Tier-2 integration test can call directly with a fake
// event — no job-runner harness needed. An inlined handler (logic buried inside
// registerListener) can only be exercised end-to-end, so in practice it never is.
//
// Teaching sketch — stubbed, not wired to a real runner.

import type { ServiceResult } from "./withDomainEvent";
import { withDomainEvent } from "./withDomainEvent";

// The three listener shapes, distinguished by directory (not by convention):
//   listeners/{domain}/            domain-bridge  — reacts with a domain write
//   listeners/integrations/{prov}/ integration    — reacts with an external SDK call
//   listeners/webhooks/{prov}/     webhook         — ingests an inbound webhook
// This one is a domain-bridge: "when an org is created, provision its settings".

interface OrgCreatedEvent {
  data: { orgId: string; kind: string };
}

// Stubs.
declare function getOrgSettings(orgId: string): Promise<{ exists: boolean } | null>;

/**
 * The handler — the testable unit. A named export, callable directly.
 *
 * The four-rule contract inside every step (ADR-002):
 *   1. Re-read current state — never trust mutable event-payload values.
 *   2. Idempotency guard at the top — skip if the work is already done, because
 *      the step may be delivered more than once (at-least-once delivery).
 *   3. Write via withDomainEvent — state + audit atomic.
 *   4. Derive any idempotency key from the triggering event, never from
 *      Date.now() (the step may retry minutes later).
 */
export async function createSettingsOnOrgCreatedFn(
  event: OrgCreatedEvent,
): Promise<ServiceResult<{ orgId: string }> | { ok: true; skipped: true }> {
  const { orgId, kind } = event.data;

  // Guard: only certain org kinds get settings. A decision the emitting command
  // already encoded — the listener does not invent business rules.
  if (kind !== "SELLER") return { ok: true, skipped: true };

  // Idempotency: re-read state; if settings already exist, this is a redelivery.
  const existing = await getOrgSettings(orgId);
  if (existing?.exists) return { ok: true, skipped: true };

  return withDomainEvent({
    event: {
      eventType: "settings.provisioned",
      aggregateId: orgId,
      aggregateType: "org_settings",
      streamKey: `org_settings:${orgId}`,
      idempotencyKey: `provision-settings:${orgId}`, // from the event, not Date.now()
      payload: { orgId },
      metadata: { userId: "system", orgId, source: "worker" },
    },
    // Choreography continues: the settings-provisioned event is dispatched
    // (after commit) for whichever domain reacts next — satisfying the Tier-2
    // test contract's step 2 below.
    dispatch: { name: "org/settings.provisioned", data: { orgId } },
    transaction: async (tx) => {
      await tx.execute("insert into org_settings (org_id) values ($1)", [orgId]);
      return { orgId };
    },
  });
}

// The wiring — a thin shell. Everything above is testable without it.
declare const jobRunner: {
  registerListener(opts: { name: string; on: string }, handler: (e: OrgCreatedEvent) => unknown): unknown;
};

export const createSettingsOnOrgCreated = jobRunner.registerListener(
  { name: "create-settings-on-org-created", on: "org/org.created" },
  createSettingsOnOrgCreatedFn,
);

// ─────────────────────────────────────────────────────────────────────────
// The Tier-2 integration test that this shape unlocks (contract, not code):
//
//   1. seed an org, call createSettingsOnOrgCreatedFn({ data: { orgId, kind } })
//      → assert a settings row now exists (the DB state change)
//   2. assert the withDomainEvent dispatch fired with the expected event
//      (a fake job-runner / send mock)
//   3. call the handler a SECOND time with the same event
//      → assert it returns { skipped: true } and writes no second row
//        (re-entrant delivery is a no-op — the at-least-once contract)
//
// None of these is reachable when the handler is inlined inside registerListener.
// Extraction is what turns "we hope the listener is idempotent" into a test.
