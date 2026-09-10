import "server-only";

import { sql } from "drizzle-orm";
import type { DatabaseTransaction } from "../db/client";
import { authorizeManualSandboxStart } from "./sandbox-authorization";

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
