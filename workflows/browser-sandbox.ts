import { sleep } from "workflow";
import { dispatchManualBrowserSandbox } from "@/lib/browser-fleet/sandbox-controller";
import { monitorBrowserSandboxSession } from "@/lib/browser-fleet/sandbox-monitor";
import { recoverBrowserSandboxDispatch } from "@/lib/browser-fleet/sandbox-recovery";
import { wakeQueuedManualBrowserSandbox } from "@/lib/browser-fleet/sandbox-wakeup";

async function dispatch(nodeId: string, operationId: string) {
  "use step";
  return dispatchManualBrowserSandbox(nodeId, operationId);
}
async function observe(nodeId: string, sessionId: string) {
  "use step";
  return monitorBrowserSandboxSession(nodeId, sessionId);
}
async function recover(nodeId: string, operationId: string) {
  "use step";
  return recoverBrowserSandboxDispatch(nodeId, operationId);
}
async function wake(nodeId: string) {
  "use step";
  return wakeQueuedManualBrowserSandbox(nodeId);
}

/** One committed manual start operation. Only non-secret identifiers and status
 * values enter the durable history. sleep suspends Workflow execution; it does
 * not start or extend a Sandbox. Uncertain bound starts are fenced and retired.
 */
export async function runManualBrowserSandbox(nodeId: string, operationId: string) {
  "use workflow";
  const started = await dispatch(nodeId, operationId);
  // 25 minutes covers the provider's 20-minute bound plus snapshot/stop latency.
  for (let observation = 0; observation < 100; observation++) {
    await sleep("15 seconds");
    const status =
      started.status === "running"
        ? await observe(nodeId, started.sessionId)
        : await recover(nodeId, operationId);
    if (status === "stopped" || status === "superseded") {
      // A replay may observe superseded because the prior observation committed
      // stopped before its step receipt was stored. DB lifecycle checks still
      // prohibit starting until the current session is actually stopped.
      if (started.status === "running") await wake(nodeId);
      return { status };
    }
  }
  return { status: "needs-reconciliation" as const };
}
