import "server-only";

import { sql } from "drizzle-orm";
import type { Database } from "../db/client";
import type { FleetState } from "./policy";
import { schedulePublications } from "./publication";
import { enqueueManualBrowserSandboxStart } from "./sandbox-outbox";

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
    WHERE n.status = 'active' AND s.phase = 'stopped' AND j.kind = 'publish'
    AND j.status = 'queued' ${scope} ORDER BY n.id LIMIT 100`);
  for (const node of nodes.rows) {
    await db.transaction(async (tx) => {
      const result = await tx.execute(sql`SELECT document FROM browser_fleet_node
        WHERE id = ${node.id} AND status = 'active' FOR UPDATE`);
      const state = result.rows[0]?.document as FleetState | undefined;
      if (state?.version !== 1) return;
      await schedulePublications(tx, String(node.id), state, Date.now());
      await tx.execute(sql`UPDATE browser_fleet_node SET document = ${JSON.stringify(state)}::jsonb
        WHERE id = ${node.id}`);
      await enqueueManualBrowserSandboxStart(tx, String(node.id));
    });
  }
}
