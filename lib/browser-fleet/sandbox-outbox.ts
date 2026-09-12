import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database, DatabaseTransaction } from "../db/client";
import { authorizeManualSandboxStart } from "./sandbox-authorization";
import { beginBrowserSandboxStart } from "./sandbox-lifecycle";

/** Called after saving queued demand in the SAME transaction. No provider I/O.
 * Unmanaged nodes and empty/unauthorized demand cannot produce an outbox item.
 */
export async function enqueueManualBrowserSandboxStart(tx: DatabaseTransaction, nodeId: string) {
  if (process.env.BROWSER_SANDBOX_ENABLED !== "1") return null;
  const operation = await beginBrowserSandboxStart(tx, nodeId);
  if (!operation?.operation_id) return null;
  const operationId = operation.operation_id;
  if (!(await authorizeManualSandboxStart(tx, nodeId, operationId))) {
    // No dispatch has happened: undo only our newly created intent while still
    // holding the node lock. Existing uncertain operations are never reset.
    await tx.execute(sql`UPDATE browser_sandbox SET phase = 'stopped', operation_id = NULL,
      operation_kind = NULL, updated_at = now() WHERE node_id = ${nodeId}`);
    return null;
  }
  await tx.execute(sql`INSERT INTO browser_sandbox_outbox (operation_id, node_id)
    VALUES (${operationId}::uuid, ${nodeId})`);
  return { nodeId, operationId };
}

export async function claimBrowserSandboxDelivery(db: Database, nodeId?: string) {
  if (process.env.BROWSER_SANDBOX_ENABLED !== "1") return null;
  const claimId = randomUUID();
  const scope = nodeId ? sql`AND node_id = ${nodeId}` : sql``;
  const rows = await db.execute(sql`WITH candidate AS (
    SELECT operation_id FROM browser_sandbox_outbox
    WHERE workflow_run_id IS NULL AND (claim_until IS NULL OR claim_until < now()) ${scope}
    AND EXISTS (SELECT 1 FROM browser_sandbox s WHERE s.node_id = browser_sandbox_outbox.node_id
      AND s.phase <> 'stopped' AND (s.operation_id = browser_sandbox_outbox.operation_id
        OR s.dispatch_operation_id = browser_sandbox_outbox.operation_id))
    ORDER BY created_at, operation_id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE browser_sandbox_outbox o SET claim_id = ${claimId}::uuid,
    claim_until = now() + interval '5 minutes' FROM candidate c
    WHERE o.operation_id = c.operation_id RETURNING o.node_id, o.operation_id`);
  const row = rows.rows[0] as { node_id: string; operation_id: string } | undefined;
  return row ? { nodeId: row.node_id, operationId: row.operation_id, claimId } : null;
}

export async function recordBrowserSandboxDelivery(
  db: Database,
  operationId: string,
  claimId: string,
  workflowRunId: string,
) {
  const rows = await db.execute(sql`UPDATE browser_sandbox_outbox
    SET workflow_run_id = ${workflowRunId}, claim_id = NULL, claim_until = NULL
    WHERE operation_id = ${operationId}::uuid AND claim_id = ${claimId}::uuid
    AND workflow_run_id IS NULL RETURNING operation_id`);
  return rows.rows.length === 1;
}

/** At-least-once Workflow delivery, at-most-once provider dispatch. A lost start
 * response retains the lease for five minutes instead of immediately retrying.
 * Workflow and provider objects never enter this durable record.
 */
export async function deliverBrowserSandboxOutbox(
  db: Database,
  start: (nodeId: string, operationId: string) => Promise<string>,
  nodeId?: string,
  limit = 10,
) {
  let delivered = 0;
  for (let count = 0; count < Math.min(Math.max(limit, 0), 10); count++) {
    const claim = await claimBrowserSandboxDelivery(db, nodeId);
    if (!claim) break;
    try {
      const runId = await start(claim.nodeId, claim.operationId);
      if (await recordBrowserSandboxDelivery(db, claim.operationId, claim.claimId, runId))
        delivered++;
    } catch {
      // Uncertain delivery will be retried after lease expiry with the same
      // operation ID. Never undo its provider claim or queued browser demand.
    }
  }
  return { delivered };
}
