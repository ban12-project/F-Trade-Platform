import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DatabaseTransaction } from "../db/client";
import type { FleetState } from "./policy";

export type SandboxLifecycle = {
  node_id: string;
  sandbox_name: string;
  phase: "stopped" | "starting" | "running" | "stopping" | "unknown";
  session_id: string | null;
  operation_id: string | null;
  operation_kind: "start" | "stop" | null;
};

// Internal transaction helpers, not request handlers. The caller must authorize
// the owner/task and enqueue its run in the same transaction before starting.
// Always lock the broker node first, matching the existing command lock order.
async function lock(tx: DatabaseTransaction, nodeId: string) {
  const node = await tx.execute(sql`SELECT status, document FROM browser_fleet_node
    WHERE id = ${nodeId} FOR UPDATE`);
  if (!node.rows.length) throw new Error("browser_node_unavailable");
  const result = await tx.execute(sql`SELECT * FROM browser_sandbox
    WHERE node_id = ${nodeId} FOR UPDATE`);
  const lifecycle = result.rows[0] as SandboxLifecycle | undefined;
  const broker = node.rows[0] as { status: string; document: FleetState };
  if (broker.document.version !== 1) throw new Error("browser_node_unavailable");
  return { lifecycle, broker };
}

/** Registration stores metadata only: no SDK import or cloud computation. */
export async function registerBrowserSandbox(tx: DatabaseTransaction, nodeId: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(nodeId))
    throw new Error("sandbox_node_invalid");
  const { lifecycle, broker } = await lock(tx, nodeId);
  if (broker.status !== "active") throw new Error("node_revoked");
  if (lifecycle) return lifecycle;
  const result = await tx.execute(sql`INSERT INTO browser_sandbox (node_id, sandbox_name)
    VALUES (${nodeId}, ${`ftrade-browser-${nodeId}`}) RETURNING *`);
  return result.rows[0] as SandboxLifecycle;
}

function queued(state: FleetState) {
  return state.runs.some((run) => run.status === "queued" && !run.stopRequested);
}

/** The winner alone dispatches this operation AFTER commit. A crash leaves a
 * durable operation for reconciliation, never permission to create another VM.
 */
export async function beginBrowserSandboxStart(tx: DatabaseTransaction, nodeId: string) {
  const { lifecycle, broker } = await lock(tx, nodeId);
  if (lifecycle?.phase !== "stopped" || broker.status !== "active") return null;
  if (!queued(broker.document)) return null;
  const result = await tx.execute(sql`UPDATE browser_sandbox SET phase = 'starting',
    operation_id = ${randomUUID()}::uuid, operation_kind = 'start', updated_at = now()
    WHERE node_id = ${nodeId} RETURNING *`);
  return result.rows[0] as SandboxLifecycle;
}

/** Call after observing this exact Agent has exited. It cannot claim new work,
 * so stop even if a request just arrived. The queue is never cleared here;
 * requests before/during stop remain available for the next start.
 */
export async function beginBrowserSandboxStop(
  tx: DatabaseTransaction,
  nodeId: string,
  sessionId: string,
) {
  const { lifecycle } = await lock(tx, nodeId);
  if (lifecycle?.phase !== "running" || lifecycle.session_id !== sessionId) return null;
  const result = await tx.execute(sql`UPDATE browser_sandbox SET phase = 'stopping',
    operation_id = ${randomUUID()}::uuid, operation_kind = 'stop', updated_at = now()
    WHERE node_id = ${nodeId} RETURNING *`);
  return result.rows[0] as SandboxLifecycle;
}

/** Only an observation of the provider operation may settle it. A timeout is
 * unknown, not stopped; retain the same name/operation for read-only recovery.
 */
export async function settleBrowserSandboxOperation(
  tx: DatabaseTransaction,
  nodeId: string,
  operationId: string,
  result: { status: "unknown" } | { status: "running"; sessionId: string } | { status: "stopped" },
) {
  const { lifecycle } = await lock(tx, nodeId);
  if (!lifecycle || lifecycle.operation_id !== operationId) return false;
  if (result.status === "unknown") {
    await tx.execute(sql`UPDATE browser_sandbox SET phase = 'unknown', updated_at = now()
      WHERE node_id = ${nodeId}`);
    return true;
  }
  if (
    (result.status === "running" && lifecycle.operation_kind !== "start") ||
    (result.status === "stopped" && lifecycle.operation_kind !== "stop")
  )
    throw new Error("sandbox_operation_result_mismatch");
  if (result.status === "running" && !/^[A-Za-z0-9_-]{1,200}$/.test(result.sessionId))
    throw new Error("sandbox_session_invalid");
  await tx.execute(sql`UPDATE browser_sandbox SET phase = ${result.status},
    session_id = ${result.status === "running" ? result.sessionId : null},
    operation_id = NULL, operation_kind = NULL, updated_at = now() WHERE node_id = ${nodeId}`);
  return true;
}
