import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";

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
  z.object({ mode: z.literal("resume"), nodeId: uuid, operationId: uuid }).strict(),
]);
export type BrowserSandboxProviderRequest = z.infer<typeof requestSchema>;

export type BrowserSandboxProviderHandle = Pick<
  Sandbox,
  "name" | "status" | "persistent" | "timeout" | "vcpus" | "tags" | "currentSession" | "domain"
>;
export type BrowserSandboxProvider = {
  create(input: Parameters<typeof Sandbox.create>[0]): Promise<BrowserSandboxProviderHandle>;
  get(input: Parameters<typeof Sandbox.get>[0]): Promise<BrowserSandboxProviderHandle>;
};

/** Execute once for an exclusively claimed database operation. The caller must
 * persist intent BEFORE this call. Ambiguous outcomes must go to inspection;
 * repeating create/resume on a workflow retry is not permitted.
 * The snapshot must be a reviewed credential-free runtime template.
 */
export async function provisionBrowserSandbox(
  input: BrowserSandboxProviderRequest,
  provider: BrowserSandboxProvider = Sandbox,
) {
  const request = requestSchema.parse(input);
  const name = `ftrade-browser-${request.nodeId}`;
  let sandbox: BrowserSandboxProviderHandle;
  try {
    if (request.mode === "create") {
      sandbox = await provider.create({
        name,
        source: { type: "snapshot", snapshotId: request.templateSnapshotId },
        ports: [9400],
        persistent: true,
        resources: { vcpus: 2 },
        timeout: 20 * 60 * 1000,
        snapshotExpiration: 30 * 86400000,
        keepLastSnapshots: { count: 1, deleteEvicted: true },
        env: {},
        tags: { "ftrade-node": request.nodeId, "ftrade-created-by": request.operationId },
      });
    } else {
      // Inspect first. Never use getOrCreate: a lost snapshot must not turn an
      // established account profile into a fresh, empty runtime.
      const existing = await provider.get({ name, resume: false });
      if (
        existing.name !== name ||
        !existing.persistent ||
        existing.status !== "stopped" ||
        existing.tags?.["ftrade-node"] !== request.nodeId
      )
        throw new Error("sandbox_requires_reconciliation");
      // A stopped sandbox retains externally edited resource configuration. Do
      // not wake a larger VM (or guess when resource metadata is missing).
      if (existing.vcpus !== 2) throw new Error("sandbox_resources_require_reconciliation");
      // Persistent configuration can be edited outside this application. Refuse
      // to resume if its stored deadline no longer satisfies our compute bound.
      // Do not repair it by extending an already running session's timeout.
      if (
        typeof existing.timeout !== "number" ||
        !Number.isFinite(existing.timeout) ||
        existing.timeout <= 0 ||
        existing.timeout > 20 * 60 * 1000
      )
        throw new Error("sandbox_timeout_requires_reconciliation");
      sandbox = await provider.get({ name, resume: true });
    }
    if (sandbox.name !== name || !sandbox.persistent || sandbox.status !== "running")
      throw new Error("sandbox_requires_reconciliation");
    const session = sandbox.currentSession();
    if (session.status !== "running") throw new Error("sandbox_requires_reconciliation");
    return { sandboxName: name, session, gatewayOrigin: sandbox.domain(9400) };
  } catch {
    // Do not stop/delete a name here: after a lost response it may refer to a
    // newer session. Recovery must inspect and capture the exact session first.
    throw new Error("sandbox_provision_unconfirmed");
  }
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
