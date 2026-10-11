import "server-only";

import { sql } from "drizzle-orm";
import type { Database, DatabaseTransaction } from "../db/client";
import type { FleetState } from "./policy";
import { enqueueManualBrowserSandboxStart } from "./sandbox-outbox";

async function reservePublicationStart(tx: DatabaseTransaction, nodeId: string) {
  const result = await tx.execute(sql`SELECT document FROM browser_fleet_node
    WHERE id = ${nodeId} AND status = 'active' FOR UPDATE SKIP LOCKED`);
  const state = result.rows[0]?.document as FleetState | undefined;
  if (state?.version !== 1) return null;
  const { schedulePublications } = await import("./publication");
  // Lock waits can outlive a page scope; schedule against the current time.
  await schedulePublications(tx, nodeId, state, Date.now());
  await tx.execute(sql`UPDATE browser_fleet_node SET document = ${JSON.stringify(state)}::jsonb
    WHERE id = ${nodeId}`);
  return enqueueManualBrowserSandboxStart(tx, nodeId);
}

/** Reserve current publication demand and persist its start intent in the same
 * transaction as the business submission. Dispatch remains a separate, at
 * least-once delivery step so provider I/O never blocks a Server Action commit.
 * A busy node is left to recovery: waiting while holding business rows would
 * invert the controller's node -> business lock order. The queued job itself
 * remains durable demand even when this immediate reservation is skipped.
 */
export async function enqueuePublicationSandboxDemand(
  tx: DatabaseTransaction,
  publicationId: string,
) {
  if (process.env.BROWSER_SANDBOX_ENABLED !== "1") return [];
  const nodes = await tx.execute(sql`SELECT DISTINCT n.id FROM browser_fleet_node n
    JOIN browser_sandbox s ON s.node_id = n.id
    JOIN browser_fleet_binding b ON b.node_id = n.id
    JOIN social_publication p ON p.channel_ref = b.channel_ref AND p.account_ref = b.account_ref
    JOIN social_browser_job j ON j.id = p.browser_job_id
    JOIN workspace_project w ON w.id = p.project_id AND w.status = 'active'
    WHERE n.status = 'active' AND s.phase = 'stopped' AND j.kind = 'publish'
    AND j.status = 'queued' AND p.id = ${publicationId} ORDER BY n.id`);
  const enqueued = [];
  for (const node of nodes.rows) {
    const nodeId = String(node.id);
    const operation = await reservePublicationStart(tx, nodeId);
    if (operation) enqueued.push(operation);
  }
  return enqueued;
}

/** Recover committed publication demand, including a crash between submission
 * and dispatch. This only reserves existing jobs and records an outbox intent;
 * the controller independently reauthorizes before every external start.
 */
export async function enqueueQueuedPublicationSandboxes(db: Database, nodeId?: string) {
  if (process.env.BROWSER_SANDBOX_ENABLED !== "1") return;
  const scope = nodeId ? sql`AND n.id = ${nodeId}` : sql``;
  const nodes = await db.execute(sql`SELECT DISTINCT n.id FROM browser_fleet_node n
    JOIN browser_sandbox s ON s.node_id = n.id
    JOIN browser_fleet_binding b ON b.node_id = n.id
    JOIN social_browser_job j ON j.channel_ref = b.channel_ref AND j.account_ref = b.account_ref
    JOIN social_publication p ON p.browser_job_id = j.id
    JOIN workspace_project w ON w.id = p.project_id AND w.status = 'active'
    WHERE n.status = 'active' AND s.phase = 'stopped' AND j.kind = 'publish'
    AND j.status = 'queued' ${scope} ORDER BY n.id LIMIT 100`);
  for (const node of nodes.rows) {
    await db.transaction((tx) => reservePublicationStart(tx, String(node.id)));
  }
}
