import { sleep } from "workflow";
import {
  configuredBrowserSandboxRuntime,
  dispatchManualBrowserSandbox,
} from "@/lib/browser-fleet/sandbox-controller";
import { monitorBrowserSandboxSession } from "@/lib/browser-fleet/sandbox-monitor";

async function dispatch(nodeId: string, operationId: string) {
  "use step";
  return dispatchManualBrowserSandbox(nodeId, operationId, configuredBrowserSandboxRuntime());
}
async function observe(nodeId: string, sessionId: string) {
  "use step";
  return monitorBrowserSandboxSession(nodeId, sessionId);
}

/** One committed manual start operation. Only non-secret identifiers and status
 * values enter the durable history. sleep suspends Workflow execution; it does
 * not start or extend a Sandbox. Recovery of ambiguous dispatch is separate.
 */
export async function runManualBrowserSandbox(nodeId: string, operationId: string) {
  "use workflow";
  const started = await dispatch(nodeId, operationId);
  if (started.status !== "running") return started;
  // 25 minutes covers the provider's 20-minute bound plus snapshot/stop latency.
  for (let observation = 0; observation < 100; observation++) {
    await sleep("15 seconds");
    const status = await observe(nodeId, started.sessionId);
    if (status === "stopped" || status === "superseded") return { status };
  }
  return { status: "needs-reconciliation" as const };
}
