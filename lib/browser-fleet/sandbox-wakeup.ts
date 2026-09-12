import "server-only";

import { getDatabase } from "../db/client";
import { enqueueManualBrowserSandboxStart } from "./sandbox-outbox";

/** Run only after a normal session's terminal observation. Stop settlement is
 * already committed, so missing credentials cannot roll it back. Replays find
 * the same pending outbox; they never authorize overlapping provider sessions.
 */
export async function wakeQueuedManualBrowserSandbox(nodeId: string) {
  await getDatabase().transaction((tx) => enqueueManualBrowserSandboxStart(tx, nodeId));
  const { deliverQueuedBrowserSandboxes } = await import("./sandbox-workflow-delivery");
  return deliverQueuedBrowserSandboxes(nodeId);
}
