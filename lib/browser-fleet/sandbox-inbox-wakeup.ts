import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../db/client";
import type { FleetState } from "./policy";
import { requestStop, scheduleInbox } from "./policy";
import { authorizedInboxAccounts, hasAuthorizedInboxDemand } from "./sandbox-inbox-demand";
import { enqueueManualBrowserSandboxStart } from "./sandbox-outbox";

/** Recover due inbox polls after a Sandbox stops. This records only a durable
 * start intent; dispatch and credential release recheck the grant. */
export async function enqueueDueInboxSandboxes(db: Database, nodeId?: string) {
  if (process.env.BROWSER_SANDBOX_ENABLED !== "1") return;
  const scope = nodeId ? sql`AND n.id = ${nodeId}` : sql``;
  const now = Date.now();
  const nodes = await db.execute(sql`SELECT n.id FROM browser_fleet_node n
    JOIN browser_sandbox s ON s.node_id = n.id
    WHERE n.status = 'active' AND s.phase = 'stopped' ${scope}
      AND n.document->'capabilities' ? 'inbox'
      AND (EXISTS (SELECT 1 FROM jsonb_array_elements(n.document->'accounts') a
        WHERE COALESCE((a->>'pollSeconds')::int, 0) >= 300
          AND COALESCE((a->>'nextPollAt')::bigint, 0) <= ${now})
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(n.document->'runs') r
          WHERE r->>'kind' = 'inbox' AND r->>'status' = 'queued'))
    ORDER BY n.id LIMIT 100`);
  for (const node of nodes.rows) {
    await db.transaction(async (tx) => {
      const result = await tx.execute(sql`SELECT document FROM browser_fleet_node
        WHERE id = ${node.id} AND status = 'active' FOR UPDATE`);
      const state = result.rows[0]?.document as FleetState | undefined;
      if (state?.version !== 1) return;
      const allowed = await authorizedInboxAccounts(tx, String(node.id), state, Date.now());
      for (const run of state.runs)
        if (run.kind === "inbox" && run.status === "queued" && !allowed.has(run.accountId))
          requestStop(state, run);
      scheduleInbox(state, Date.now(), randomUUID, allowed);
      await tx.execute(sql`UPDATE browser_fleet_node SET document = ${JSON.stringify(state)}::jsonb
        WHERE id = ${node.id}`);
      if (!(await hasAuthorizedInboxDemand(tx, String(node.id), state, Date.now()))) return;
      await enqueueManualBrowserSandboxStart(tx, String(node.id));
    });
  }
}
