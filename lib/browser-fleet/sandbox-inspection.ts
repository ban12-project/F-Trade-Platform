import "server-only";

import { Sandbox } from "@vercel/sandbox";
import { sql } from "drizzle-orm";
import { type DatabaseExecutor, getDatabase } from "../db/client";
import { type SandboxInspection, sandboxInspectionSchema } from "./sandbox-inspection-contract";
import { configuredBrowserSandboxNetworkPolicy } from "./sandbox-network-policy";
import { type BrowserSandboxProvider, browserSandboxPreflightChecks } from "./sandbox-provider";

/** Read-only: no resume, stop, credential release, lifecycle reset or raw provider data. */
export async function inspectOwnedBrowserSandbox(
  input: unknown,
  ownerId: string,
  database: DatabaseExecutor = getDatabase(),
  provider: Pick<BrowserSandboxProvider, "get"> = Sandbox,
  configuredPolicy = configuredBrowserSandboxNetworkPolicy,
): Promise<SandboxInspection> {
  const { nodeId } = sandboxInspectionSchema.parse(input);
  const owned = await database.execute(sql`SELECT n.id FROM browser_fleet_node n
    JOIN browser_sandbox s ON s.node_id = n.id
    WHERE n.id = ${nodeId} AND n.owner_id = ${ownerId} AND n.status = 'active'`);
  if (!owned.rows.length) throw new Error("browser_node_unavailable");
  let policy: ReturnType<typeof configuredPolicy>;
  try {
    policy = configuredPolicy();
  } catch {
    return { kind: "unavailable", reason: "configuration" };
  }
  try {
    const sandbox = await provider.get({ name: `ftrade-browser-${nodeId}`, resume: false });
    return {
      kind: "observed",
      observedAt: new Date().toISOString(),
      state:
        sandbox.status === "stopped" || sandbox.status === "running"
          ? sandbox.status
          : "transitioning",
      checks: browserSandboxPreflightChecks(sandbox, nodeId, policy),
    };
  } catch (error) {
    const status =
      error &&
      typeof error === "object" &&
      "response" in error &&
      error.response instanceof Response
        ? error.response.status
        : null;
    return {
      kind: "unavailable",
      reason: status === 401 || status === 403 ? "provider_authorization" : "provider_unavailable",
    };
  }
}
