// Illustrative — the one sanctioned transaction pattern (ADR-002).
//
// This is a teaching sketch, not wired to a real DB. It shows the SHAPE that
// makes two silent failure modes structurally impossible:
//   1. state written without its audit row (or vice versa)
//   2. an event dispatched even though the transaction rolled back
//
// The whole point of routing every mutation through one helper is that the
// correct ordering — state + audit atomic, THEN dispatch after commit — becomes
// the *only* ordering. Hand-rolling db.transaction() + dispatch() is banned by a
// lint rule precisely because it's easy to get this ordering wrong in a way that
// passes every test (the race only shows up under rollback).

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string };

interface Tx {
  execute(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  insertEventLog(row: EventLogRow): Promise<void>;
}

interface EventLogRow {
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  streamKey: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  metadata: { userId: string; orgId: string; source: "console" | "api" | "worker" };
}

interface Dispatch {
  name: string;
  data: Record<string, unknown>;
}

interface WithDomainEventArgs<T> {
  event: EventLogRow;
  /** Omit for audit-only mutations with no cross-domain effect. */
  dispatch?: Dispatch;
  /**
   * The acting org for RLS. Defaults to event.metadata.orgId. Pass explicitly
   * only when the actor's org differs from the data's org (admin acting on a
   * target tenant).
   */
  scopeOrgId?: string;
  transaction: (tx: Tx) => Promise<T>;
}

// Stubs standing in for the real infrastructure.
declare const db: {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
};
declare const jobRunner: { send(dispatch: Dispatch): Promise<void> };
declare function isIdempotencyConflict(err: unknown): boolean;

/**
 * The single write path for any state mutation that emits an event.
 *
 * Ordering contract (this is the load-bearing part):
 *   1. open ONE transaction
 *   2. set the RLS acting-org (leading statement) so every write is tenant-checked
 *   3. write business state AND the event_log row — atomic, same tx
 *   4. commit
 *   5. ONLY THEN dispatch to the async job runner
 *
 * If the callback throws, state + audit roll back together and nothing was
 * dispatched. If the idempotency key collides, the caller maps it to success —
 * the operation already happened.
 */
export async function withDomainEvent<T>(
  args: WithDomainEventArgs<T>,
): Promise<ServiceResult<T>> {
  const scope = args.scopeOrgId ?? args.event.metadata.orgId;
  try {
    const data = await db.transaction(async (tx) => {
      // Leading statement: bind the acting org for row-level security.
      // set_config(...) — NOT `SET LOCAL x = $1`, which is grammar and can't
      // bind a parameter (lesson LSN-003).
      await tx.execute("select set_config('app.current_org', $1, true)", [scope]);

      // Business state mutation runs inside the same tx as the audit write.
      const result = await args.transaction(tx);

      // Audit row — written here, never outside this helper.
      await tx.insertEventLog(args.event);

      return result;
    });

    // Dispatch happens AFTER commit — so a rolled-back tx can never fan out.
    if (args.dispatch) {
      await jobRunner.send(args.dispatch);
    }

    return { ok: true, data };
  } catch (err) {
    // A retry submitting the same idempotency key already succeeded once.
    if (isIdempotencyConflict(err)) {
      return { ok: false, code: "CONFLICT" };
    }
    throw err;
  }
}
