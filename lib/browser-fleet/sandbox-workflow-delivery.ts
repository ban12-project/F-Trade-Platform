import "server-only";

import { start } from "workflow/api";
import { runManualBrowserSandbox } from "@/workflows/browser-sandbox";
import { getDatabase } from "../db/client";
import { deliverBrowserSandboxOutbox } from "./sandbox-outbox";

export async function deliverQueuedBrowserSandboxes(nodeId?: string) {
  return deliverBrowserSandboxOutbox(
    getDatabase(),
    async (node, operation) => (await start(runManualBrowserSandbox, [node, operation])).runId,
    nodeId,
    nodeId ? 1 : 10,
  );
}
