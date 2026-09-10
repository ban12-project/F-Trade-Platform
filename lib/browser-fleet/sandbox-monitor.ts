import "server-only";

import { sql } from "drizzle-orm";
import { hasPermission } from "../authz";
import { getDatabase } from "../db/client";
import { beginBrowserSandboxStop, settleBrowserSandboxOperation } from "./sandbox-lifecycle";
import { inspectBrowserSandbox } from "./sandbox-provider";
import { stopIdleBrowserSandboxSession, stopRevokedBrowserSandboxSession } from "./sandbox-session";

const dependencies = {
  async current(nodeId: string, sessionId: string) {
    const rows = await getDatabase().execute(sql`SELECT node_id FROM browser_sandbox
      WHERE node_id = ${nodeId} AND session_id = ${sessionId} AND phase IN ('running', 'stopping')`);
    return rows.rows.length === 1;
  },
  inspect: inspectBrowserSandbox,
  retire: stopIdleBrowserSandboxSession,
  revoke: stopRevokedBrowserSandboxSession,
  async revoked(nodeId: string) {
    const rows = await getDatabase().execute(sql`SELECT n.status, u.role, u.banned
      FROM browser_fleet_node n LEFT JOIN "user" u ON u.id = n.owner_id WHERE n.id = ${nodeId}`);
    const row = rows.rows[0] as
      | { status: string; role: string | null; banned: boolean | null }
      | undefined;
    return row?.status !== "active" || !!row.banned || !hasPermission(row.role, "settings:manage");
  },
  async recordStopped(nodeId: string, sessionId: string) {
    return getDatabase().transaction(async (tx) => {
      // Same node-first lock order as owner commands and dispatch.
      await tx.execute(sql`SELECT id FROM browser_fleet_node WHERE id = ${nodeId} FOR UPDATE`);
      const rows = await tx.execute(sql`SELECT phase, session_id, operation_id FROM browser_sandbox
        WHERE node_id = ${nodeId} FOR UPDATE`);
      const row = rows.rows[0] as
        | { phase: string; session_id: string; operation_id: string | null }
        | undefined;
      if (row?.session_id !== sessionId) return false;
      const operation =
        row.phase === "running" ? await beginBrowserSandboxStop(tx, nodeId, sessionId) : null;
      const operationId =
        operation?.operation_id ?? (row.phase === "stopping" ? row.operation_id : null);
      if (!operationId) return false;
      const stopped = await settleBrowserSandboxOperation(tx, nodeId, operationId, {
        status: "stopped",
      });
      if (stopped)
        await tx.execute(
          sql`UPDATE browser_fleet_node SET gateway_origin = NULL, updated_at = now() WHERE id = ${nodeId}`,
        );
      // No lease is released here. Agent recover must still confirm containers
      // stopped, especially for publication outcomes which may be unknown.
      return stopped;
    });
  },
};
export type BrowserSandboxMonitorDependencies = typeof dependencies;

/** One bounded observation. No sleep, resume, timeout extension or new instance.
 * A Workflow schedules later observations without keeping compute resident.
 */
export async function monitorBrowserSandboxSession(
  nodeId: string,
  sessionId: string,
  overrides: Partial<BrowserSandboxMonitorDependencies> = {},
) {
  const deps = { ...dependencies, ...overrides };
  try {
    if (!(await deps.current(nodeId, sessionId))) return "superseded" as const;
    const sandbox = await deps.inspect(nodeId);
    const session = sandbox.currentSession();
    if (session.sessionId !== sessionId) return "superseded" as const;
    if (sandbox.status === "running" && session.status === "running") {
      const result = await ((await deps.revoked(nodeId)) ? deps.revoke : deps.retire)(
        session,
        nodeId,
        sessionId,
      );
      if (result === "busy") return "active" as const;
      // Confirm provider metadata even after a successful stop response.
      if (result !== "stopped") return "pending" as const;
      const stopped = await deps.inspect(nodeId);
      if (stopped.currentSession().sessionId !== sessionId) return "superseded" as const;
      if (stopped.status !== "stopped") return "pending" as const;
    } else if (sandbox.status !== "stopped") return "pending" as const;
    return (await deps.recordStopped(nodeId, sessionId))
      ? ("stopped" as const)
      : ("superseded" as const);
  } catch {
    // Retry observation, not provisioning. Provider timeout is a final compute
    // bound if status remains unavailable; report unresolved state separately.
    return "pending" as const;
  }
}
