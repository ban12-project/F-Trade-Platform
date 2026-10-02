import "server-only";

import { sql } from "drizzle-orm";
import { getDatabase } from "../db/client";
import { beginBrowserSandboxStop, settleBrowserSandboxOperation } from "./sandbox-lifecycle";
import { enqueueManualBrowserSandboxStart } from "./sandbox-outbox";
import { inspectBrowserSandbox } from "./sandbox-provider";

type Candidate = { node_id: string; session_id: string };

/** An external stop must not strand already queued work behind a stale running
 * row. Provider history is evidence for the exact recorded session; a stopped
 * latest session alone is insufficient after an out-of-band resume.
 */
export async function recordedSessionIsStopped(
  sandbox: Awaited<ReturnType<typeof inspectBrowserSandbox>>,
  sessionId: string,
) {
  if (sandbox.status !== "stopped" || sandbox.currentSession().status !== "stopped") return false;
  let inspected = 0;
  for await (const session of await sandbox.listSessions({ limit: 50 })) {
    if (++inspected > 200) return false;
    if (session.id === sessionId) return session.status === "stopped";
  }
  return false;
}

export async function reconcileStoppedBrowserSandboxes(nodeId?: string) {
  if (process.env.BROWSER_SANDBOX_ENABLED !== "1") return { reconciled: 0 };
  const db = getDatabase();
  const scope = nodeId ? sql`AND node_id = ${nodeId}` : sql``;
  const rows = await db.execute(sql`SELECT node_id, session_id FROM browser_sandbox
    WHERE phase = 'running' AND session_id IS NOT NULL
      AND updated_at < now() - interval '2 minutes' ${scope}
    ORDER BY updated_at LIMIT 10`);
  let reconciled = 0;
  for (const candidate of rows.rows as Candidate[]) {
    try {
      const sandbox = await inspectBrowserSandbox(candidate.node_id);
      if (
        sandbox.name !== `ftrade-browser-${candidate.node_id}` ||
        !sandbox.persistent ||
        sandbox.tags?.["ftrade-node"] !== candidate.node_id ||
        !(await recordedSessionIsStopped(sandbox, candidate.session_id))
      )
        continue;
      const settled = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT id FROM browser_fleet_node WHERE id = ${candidate.node_id} FOR UPDATE`,
        );
        const current = await tx.execute(sql`SELECT phase, session_id, operation_id
          FROM browser_sandbox WHERE node_id = ${candidate.node_id} FOR UPDATE`);
        const row = current.rows[0] as
          | { phase: string; session_id: string | null; operation_id: string | null }
          | undefined;
        if (row?.phase !== "running" || row.session_id !== candidate.session_id || row.operation_id)
          return false;
        const stop = await beginBrowserSandboxStop(tx, candidate.node_id, candidate.session_id);
        if (!stop?.operation_id) return false;
        if (
          !(await settleBrowserSandboxOperation(tx, candidate.node_id, stop.operation_id, {
            status: "stopped",
          }))
        )
          return false;
        await tx.execute(sql`UPDATE browser_fleet_node SET gateway_origin = NULL, updated_at = now()
          WHERE id = ${candidate.node_id}`);
        await enqueueManualBrowserSandboxStart(tx, candidate.node_id);
        return true;
      });
      if (settled) reconciled++;
    } catch {
      // Provider/history ambiguity retains the fence and leaves the queue intact.
    }
  }
  return { reconciled };
}
