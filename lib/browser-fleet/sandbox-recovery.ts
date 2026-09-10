import "server-only";

import { sql } from "drizzle-orm";
import { type DatabaseTransaction, getDatabase } from "../db/client";
import { recordedBrowserSandboxDispatch } from "./sandbox-dispatch";
import { settleBrowserSandboxOperation } from "./sandbox-lifecycle";
import { monitorBrowserSandboxSession } from "./sandbox-monitor";
import { inspectBrowserSandbox } from "./sandbox-provider";
import { stopRevokedBrowserSandboxSession } from "./sandbox-session";

/** Fence a failed start before stopping its bound session. Five minutes without
 * a DB update allows recovery of a crashed starting step. A current start gets
 * time to finish; unknown results can be retired immediately. No new operation
 * can start until the provider confirms this session stopped.
 */
export async function claimBrowserSandboxRecovery(
  tx: DatabaseTransaction,
  nodeId: string,
  operationId: string,
) {
  await tx.execute(sql`SELECT id FROM browser_fleet_node WHERE id = ${nodeId} FOR UPDATE`);
  const rows = await tx.execute(sql`SELECT phase, session_id, operation_id, operation_kind,
    dispatch_operation_id, updated_at < now() - interval '5 minutes' AS stale
    FROM browser_sandbox WHERE node_id = ${nodeId} FOR UPDATE`);
  const row = rows.rows[0] as
    | {
        phase: string;
        session_id: string | null;
        operation_id: string | null;
        operation_kind: string | null;
        dispatch_operation_id: string | null;
        stale: boolean;
      }
    | undefined;
  if (!row || row.dispatch_operation_id !== operationId || row.phase === "stopped")
    return { status: "superseded" as const };
  // A concurrent successful dispatch will be picked up by the next observation.
  if (row.phase === "running") return { status: "pending" as const };
  if (row.operation_id !== operationId) return { status: "superseded" as const };
  if (!row.session_id || (row.phase === "starting" && !row.stale))
    return { status: "pending" as const };
  await tx.execute(sql`UPDATE browser_sandbox SET phase = 'stopping', operation_kind = 'stop',
    updated_at = now() WHERE node_id = ${nodeId}`);
  return { status: "captured" as const, sessionId: row.session_id };
}

export async function recordRecoveredBrowserSandboxStop(
  tx: DatabaseTransaction,
  nodeId: string,
  operationId: string,
  sessionId: string,
) {
  await tx.execute(sql`SELECT id FROM browser_fleet_node WHERE id = ${nodeId} FOR UPDATE`);
  const rows = await tx.execute(sql`SELECT node_id FROM browser_sandbox WHERE node_id = ${nodeId}
    AND operation_id = ${operationId}::uuid AND operation_kind = 'stop'
    AND session_id = ${sessionId} FOR UPDATE`);
  if (!rows.rows.length) return false;
  const stopped = await settleBrowserSandboxOperation(tx, nodeId, operationId, {
    status: "stopped",
  });
  if (stopped)
    await tx.execute(sql`UPDATE browser_fleet_node SET gateway_origin = NULL, updated_at = now()
      WHERE id = ${nodeId}`);
  return stopped;
}

const dependencies = {
  recorded: (nodeId: string, operationId: string) =>
    recordedBrowserSandboxDispatch(getDatabase(), nodeId, operationId),
  monitor: monitorBrowserSandboxSession,
  claim: (nodeId: string, operationId: string) =>
    getDatabase().transaction((tx) => claimBrowserSandboxRecovery(tx, nodeId, operationId)),
  inspect: inspectBrowserSandbox,
  drain: stopRevokedBrowserSandboxSession,
  record: (nodeId: string, operationId: string, sessionId: string) =>
    getDatabase().transaction((tx) =>
      recordRecoveredBrowserSandboxStop(tx, nodeId, operationId, sessionId),
    ),
};
export type BrowserSandboxRecoveryDependencies = typeof dependencies;

/** Read-only provider lookup and captured-session stop only. Unbound sessions
 * remain uncertain: a name alone does not prove which session belongs to this
 * operation. Neither keys nor a new create/resume are permitted in recovery.
 */
export async function recoverBrowserSandboxDispatch(
  nodeId: string,
  operationId: string,
  deps: BrowserSandboxRecoveryDependencies = dependencies,
) {
  try {
    const recorded = await deps.recorded(nodeId, operationId);
    if (recorded) return deps.monitor(nodeId, recorded.sessionId);
    const claim = await deps.claim(nodeId, operationId);
    if (claim.status !== "captured") return claim.status;
    const sandbox = await deps.inspect(nodeId);
    if (sandbox.name !== `ftrade-browser-${nodeId}` || !sandbox.persistent) return "pending";
    const session = sandbox.currentSession();
    if (session.sessionId !== claim.sessionId) return "superseded";
    if (sandbox.status === "running" && session.status === "running") {
      try {
        await deps.drain(session, nodeId, claim.sessionId);
      } catch {
        // The Agent may not exist yet. The DB fence and captured ID still allow
        // stopping this VM; no lease or publication result is settled here.
        await session.stop();
      }
      const stopped = await deps.inspect(nodeId);
      if (stopped.currentSession().sessionId !== claim.sessionId) return "superseded";
      if (stopped.status !== "stopped") return "pending";
    } else if (sandbox.status !== "stopped") return "pending";
    return (await deps.record(nodeId, operationId, claim.sessionId)) ? "stopped" : "superseded";
  } catch {
    return "pending";
  }
}
