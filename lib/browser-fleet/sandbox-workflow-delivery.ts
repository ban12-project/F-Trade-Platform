import "server-only";

import { sql } from "drizzle-orm";
import { start } from "workflow/api";
import { runManualBrowserSandbox } from "@/workflows/browser-sandbox";
import { getDatabase } from "../db/client";
import { deliverBrowserSandboxOutbox } from "./sandbox-outbox";
import { reconcileStoppedBrowserSandboxes } from "./sandbox-reconcile";

export async function deliverQueuedBrowserSandboxes(nodeId?: string) {
  await reconcileStoppedBrowserSandboxes(nodeId);
  const { enqueueDueInboxSandboxes } = await import("./sandbox-inbox-wakeup");
  const { enqueueQueuedPublicationSandboxes } = await import("./sandbox-publication-wakeup");
  await enqueueDueInboxSandboxes(getDatabase(), nodeId);
  await enqueueQueuedPublicationSandboxes(getDatabase(), nodeId);
  return deliverBrowserSandboxOutbox(
    getDatabase(),
    async (node, operation) => (await start(runManualBrowserSandbox, [node, operation])).runId,
    nodeId,
    nodeId ? 1 : 10,
  );
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
