import "server-only";

import { sql } from "drizzle-orm";
import { runManualBrowserSandbox } from "@/workflows/browser-sandbox";
import { getDatabase } from "../db/client";
import { dispatchQueuedBrowserSandboxes } from "./sandbox-wakeup";

export async function deliverQueuedBrowserSandboxes(nodeId?: string) {
  return dispatchQueuedBrowserSandboxes(runManualBrowserSandbox, nodeId);
}

/** Best-effort immediate delivery for one committed submission. The existing
 * authenticated cron recovers its durable job if this process exits early. */
export async function deliverPublicationSandbox(publicationId: string) {
  if (process.env.BROWSER_SANDBOX_ENABLED !== "1") return;
  const bindings = await getDatabase().execute(sql`SELECT b.node_id FROM browser_fleet_binding b
    JOIN social_publication p ON p.channel_ref = b.channel_ref AND p.account_ref = b.account_ref
    WHERE p.id = ${publicationId}`);
  for (const binding of bindings.rows) await deliverQueuedBrowserSandboxes(String(binding.node_id));
}
