import "server-only";

import { sql } from "drizzle-orm";
import type { DatabaseExecutor, DatabaseTransaction } from "../db/client";
import { authorizeManualSandboxStart } from "./sandbox-authorization";

/** Replay only a successfully recorded session for this exact dispatched
 * operation. This read does not authorize new compute or release credentials.
 * Even revoked owners need the existing monitor to finish stopping the VM.
 */
export async function recordedBrowserSandboxDispatch(
  db: DatabaseExecutor,
  nodeId: string,
  operationId: string,
) {
  const rows = await db.execute(sql`SELECT session_id FROM browser_sandbox
    WHERE node_id = ${nodeId} AND dispatch_operation_id = ${operationId}::uuid
    AND (phase = 'running' OR (phase = 'stopping' AND operation_id IS DISTINCT FROM dispatch_operation_id))
    AND session_id IS NOT NULL`);
  const row = rows.rows[0] as { session_id: string } | undefined;
  return row ? { status: "running" as const, sessionId: row.session_id } : null;
}

/** Claim BEFORE provider I/O, commit, then invoke the provider once. If the
 * process dies anywhere after commit, recovery inspects the named instance;
 * it cannot take another claim for the same operation even after a timeout.
 * Returns metadata only, so no decrypted key enters durable Workflow history.
 */
export async function claimManualSandboxDispatch(
  tx: DatabaseTransaction,
  nodeId: string,
  operationId: string,
) {
  if (!(await authorizeManualSandboxStart(tx, nodeId, operationId))) {
    await cancelUnclaimedBrowserSandboxStart(tx, nodeId, operationId);
    return null;
  }
  // authorizeManualSandboxStart holds node then Sandbox row locks.
  const rows = await tx.execute(sql`SELECT phase, provider_initialized, dispatch_operation_id
    FROM browser_sandbox WHERE node_id = ${nodeId}`);
  const row = rows.rows[0] as {
    phase: string;
    provider_initialized: boolean;
    dispatch_operation_id: string | null;
  };
  if (row.phase !== "starting" || row.dispatch_operation_id === operationId) return null;
  await tx.execute(sql`UPDATE browser_sandbox SET provider_initialized = true,
    dispatch_operation_id = ${operationId}::uuid, updated_at = now() WHERE node_id = ${nodeId}`);
  return {
    nodeId,
    operationId,
    mode: row.provider_initialized ? ("resume" as const) : ("create" as const),
  };
}

/** Caller has established that manual demand is no longer authorized. Only an
 * intent with no provider dispatch claim or bound session may be cancelled.
 * A timeout after dispatch is not evidence that compute never started.
 */
async function cancelUnclaimedBrowserSandboxStart(
  tx: DatabaseTransaction,
  nodeId: string,
  operationId: string,
) {
  await tx.execute(sql`SELECT id FROM browser_fleet_node WHERE id = ${nodeId} FOR UPDATE`);
  const rows = await tx.execute(sql`UPDATE browser_sandbox SET phase = 'stopped',
    operation_id = NULL, operation_kind = NULL, updated_at = now()
    WHERE node_id = ${nodeId} AND operation_id = ${operationId}::uuid
    AND operation_kind = 'start' AND phase = 'starting' AND session_id IS NULL
    AND dispatch_operation_id IS DISTINCT FROM ${operationId}::uuid RETURNING node_id`);
  return rows.rows.length === 1;
}

/** After an owner mutation, release only an unclaimed start whose remaining
 * queue no longer carries valid manual demand. No provider or Workflow I/O.
 */
export async function cancelInvalidManualSandboxStart(tx: DatabaseTransaction, nodeId: string) {
  await tx.execute(sql`SELECT id FROM browser_fleet_node WHERE id = ${nodeId} FOR UPDATE`);
  const rows = await tx.execute(sql`SELECT operation_id FROM browser_sandbox
    WHERE node_id = ${nodeId} AND phase = 'starting' AND operation_kind = 'start'
    AND session_id IS NULL AND dispatch_operation_id IS DISTINCT FROM operation_id FOR UPDATE`);
  const operationId = rows.rows[0]?.operation_id as string | undefined;
  if (!operationId || (await authorizeManualSandboxStart(tx, nodeId, operationId))) return false;
  return cancelUnclaimedBrowserSandboxStart(tx, nodeId, operationId);
}
