import "server-only";

import { z } from "zod";
import { getDatabase } from "../db/client";
import { authorizeManualSandboxStart } from "./sandbox-authorization";
import { claimManualSandboxDispatch } from "./sandbox-dispatch";
import { bindBrowserSandboxGateway, settleBrowserSandboxOperation } from "./sandbox-lifecycle";
import { provisionBrowserSandbox } from "./sandbox-provider";
import { startBrowserSandboxRuntime } from "./sandbox-runtime";
import { secureOrigin } from "./security";

const configSchema = z
  .object({
    templateSnapshotId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
    appOrigin: z.string().transform(secureOrigin),
    agentImage: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    browserImage: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();
type Config = z.infer<typeof configSchema>;

const dependencies = {
  claim: (nodeId: string, operationId: string) =>
    getDatabase().transaction((tx) => claimManualSandboxDispatch(tx, nodeId, operationId)),
  authorize: (nodeId: string, operationId: string) =>
    getDatabase().transaction((tx) => authorizeManualSandboxStart(tx, nodeId, operationId)),
  bind: (nodeId: string, operationId: string, sessionId: string, origin: string) =>
    getDatabase().transaction((tx) =>
      bindBrowserSandboxGateway(tx, nodeId, operationId, sessionId, origin),
    ),
  settle: (
    nodeId: string,
    operationId: string,
    result: Parameters<typeof settleBrowserSandboxOperation>[3],
  ) =>
    getDatabase().transaction((tx) =>
      settleBrowserSandboxOperation(tx, nodeId, operationId, result),
    ),
  provision: provisionBrowserSandbox,
  start: startBrowserSandboxRuntime,
};
export type BrowserSandboxControllerDependencies = typeof dependencies;

/** Execute inside one server step. Only IDs leave this function: credentials
 * and SDK objects must not become Workflow arguments/results or Action output.
 * A claimed operation is never dispatched again by a retry of this function.
 */
export async function dispatchManualBrowserSandbox(
  nodeId: string,
  operationId: string,
  config: Config,
  deps: BrowserSandboxControllerDependencies = dependencies,
) {
  const settings = configSchema.parse(config);
  const claim = await deps.claim(nodeId, operationId);
  if (!claim) return { status: "not-dispatched" as const };
  let captured: Awaited<ReturnType<typeof provisionBrowserSandbox>> | undefined;
  try {
    // Claim and provider I/O are separate transactions: recheck after commit.
    if (!(await deps.authorize(nodeId, operationId))) throw new Error("authorization_changed");
    captured = await deps.provision(
      claim.mode === "create"
        ? { ...claim, mode: "create", templateSnapshotId: settings.templateSnapshotId }
        : { ...claim, mode: "resume" },
    );
    const sessionId = captured.session.sessionId;
    if (!(await deps.bind(nodeId, operationId, sessionId, captured.gatewayOrigin)))
      throw new Error("operation_superseded");
    const authorization = await deps.authorize(nodeId, operationId);
    if (!authorization || authorization.sandboxName !== captured.sandboxName)
      throw new Error("authorization_changed");
    const result = await deps.start(captured.session, sessionId, {
      nodeId,
      operationId,
      appOrigin: settings.appOrigin,
      agentImage: settings.agentImage,
      browserImage: settings.browserImage,
      accessKey: authorization.accessKey,
    });
    if (result !== "started" && result !== "already-running")
      throw new Error("runtime_not_running");
    if (!(await deps.settle(nodeId, operationId, { status: "running", sessionId })))
      throw new Error("operation_superseded");
    return { status: "running" as const, sessionId };
  } catch {
    // We can stop only the captured session. With no response, keep the named
    // operation unknown for metadata recovery instead of guessing another VM.
    let stopConfirmed = false;
    if (captured) {
      try {
        await captured.session.stop();
        stopConfirmed = true;
      } catch {
        /* Unknown stop is retained for provider reconciliation. */
      }
    }
    try {
      await deps.settle(nodeId, operationId, { status: "unknown" });
    } catch {
      /* Durable dispatch claim still prevents duplicate provisioning. */
    }
    return { status: "needs-reconciliation" as const, stopConfirmed };
  }
}

export function configuredBrowserSandboxRuntime() {
  return configSchema.parse({
    templateSnapshotId: process.env.BROWSER_SANDBOX_TEMPLATE_SNAPSHOT_ID,
    appOrigin: process.env.BROWSER_SANDBOX_PLATFORM_ORIGIN,
    agentImage: process.env.BROWSER_SANDBOX_AGENT_IMAGE_ID,
    browserImage: process.env.BROWSER_SANDBOX_BROWSER_IMAGE_ID,
  });
}
