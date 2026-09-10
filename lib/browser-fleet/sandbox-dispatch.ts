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
  if (!(await authorizeManualSandboxStart(tx, nodeId, operationId))) return null;
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
