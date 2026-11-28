import "server-only";

import { start } from "workflow/api";
import { getDatabase } from "../db/client";
import { deliverBrowserSandboxOutbox, enqueueManualBrowserSandboxStart } from "./sandbox-outbox";
import { reconcileStoppedBrowserSandboxes } from "./sandbox-reconcile";

type SandboxWorkflow = (nodeId: string, operationId: string) => Promise<unknown>;

export async function dispatchQueuedBrowserSandboxes(workflow: SandboxWorkflow, nodeId?: string) {
  await reconcileStoppedBrowserSandboxes(nodeId);
  const { enqueueDueInboxSandboxes } = await import("./sandbox-inbox-wakeup");
  const { enqueueQueuedPublicationSandboxes } = await import("./sandbox-publication-wakeup");
  await enqueueDueInboxSandboxes(getDatabase(), nodeId);
  await enqueueQueuedPublicationSandboxes(getDatabase(), nodeId);
  return deliverBrowserSandboxOutbox(
    getDatabase(),
    async (node, operation) => (await start(workflow, [node, operation])).runId,
    nodeId,
    nodeId ? 1 : 10,
  );
}

/** Run only after a normal session's terminal observation. Stop settlement is
 * already committed, so missing credentials cannot roll it back. Replays find
 * the same pending outbox; they never authorize overlapping provider sessions.
 */
export async function wakeQueuedManualBrowserSandbox(nodeId: string, workflow: SandboxWorkflow) {
  await getDatabase().transaction((tx) => enqueueManualBrowserSandboxStart(tx, nodeId));
  return dispatchQueuedBrowserSandboxes(workflow, nodeId);
}
