import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";
import { rejectRetiredSandboxExecution } from "./sandbox-retired";

const uuid = z
  .string()
  .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const requestSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("create"),
      nodeId: uuid,
      operationId: uuid,
      templateSnapshotId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
    })
    .strict(),
  z
    .object({
      mode: z.literal("resume"),
      nodeId: uuid,
      operationId: uuid,
    })
    .strict(),
]);
export type BrowserSandboxProviderRequest = z.infer<typeof requestSchema>;

export type BrowserSandboxProviderHandle = Pick<
  Sandbox,
  | "name"
  | "status"
  | "persistent"
  | "timeout"
  | "vcpus"
  | "tags"
  | "update"
  | "currentSnapshotId"
  | "currentSession"
  | "domain"
  | "listSessions"
>;
export type BrowserSandboxProvider = {
  create(input: Parameters<typeof Sandbox.create>[0]): Promise<BrowserSandboxProviderHandle>;
  get(input: Parameters<typeof Sandbox.get>[0]): Promise<BrowserSandboxProviderHandle>;
};

export function browserSandboxPreflightChecks(
  sandbox: BrowserSandboxProviderHandle,
  nodeId: string,
) {
  return {
    ownership:
      sandbox.name === `ftrade-browser-${nodeId}` &&
      sandbox.persistent === true &&
      sandbox.tags?.["ftrade-node"] === nodeId,
    resources: sandbox.vcpus === 2,
    timeout:
      typeof sandbox.timeout === "number" &&
      Number.isFinite(sandbox.timeout) &&
      sandbox.timeout > 0 &&
      sandbox.timeout <= 20 * 60 * 1000,
  };
}

/** Retained signature for pending workflow compatibility. Provisioning is
 * permanently retired, including injected providers and explicit resume calls.
 * Existing workflows may still inspect/stop sessions through other helpers.
 */
export async function provisionBrowserSandbox(
  _input: BrowserSandboxProviderRequest,
  _provider: BrowserSandboxProvider = Sandbox,
): Promise<{
  sandboxName: string;
  session: ReturnType<BrowserSandboxProviderHandle["currentSession"]>;
  gatewayOrigin: string;
}> {
  return rejectRetiredSandboxExecution();
}

/** Safe for uncertain results and read-only status checks. Never resumes. */
export async function inspectBrowserSandbox(
  nodeId: string,
  provider: BrowserSandboxProvider = Sandbox,
) {
  uuid.parse(nodeId);
  try {
    return await provider.get({ name: `ftrade-browser-${nodeId}`, resume: false });
  } catch {
    throw new Error("sandbox_inspection_unconfirmed");
  }
}

/** Identify only an initial create whose response was lost. A later resume must
 * never be inferred from the stable name or the original creation tag.
 */
export async function discoverInitialBrowserSandboxSession(
  nodeId: string,
  operationId: string,
  provider: Pick<typeof Sandbox, "get"> = Sandbox,
) {
  uuid.parse(nodeId);
  uuid.parse(operationId);
  const sandbox = await provider.get({ name: `ftrade-browser-${nodeId}`, resume: false });
  if (
    sandbox.name !== `ftrade-browser-${nodeId}` ||
    !sandbox.persistent ||
    sandbox.tags?.["ftrade-node"] !== nodeId ||
    sandbox.tags?.["ftrade-created-by"] !== operationId
  )
    return null;
  const ids: string[] = [];
  for await (const session of await sandbox.listSessions({ limit: 2 })) {
    ids.push(session.id);
    if (ids.length > 1) return null;
  }
  const current = sandbox.currentSession();
  return ids.length === 1 && ids[0] === current.sessionId ? current.sessionId : null;
}
