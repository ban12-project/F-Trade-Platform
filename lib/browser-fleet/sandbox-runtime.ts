import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { BrowserSandboxSession } from "./sandbox-session";
import { accessKeyNodeId, secureOrigin } from "./security";

const uuid = z
  .string()
  .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const image = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const runtimeSchema = z
  .object({
    nodeId: uuid,
    operationId: uuid,
    appOrigin: z.string().transform(secureOrigin),
    agentImage: image,
    browserImage: image,
    accessKey: z.string(),
  })
  .strict();
export type BrowserSandboxRuntimeInput = z.input<typeof runtimeSchema>;
export type BrowserSandboxRuntimeSession = BrowserSandboxSession & {
  writeFiles(files: { path: string; content: string; mode: number }[]): Promise<void>;
};

/** Internal provider boundary: caller already owns a committed authorized start
 * operation and its exact running Session. This never creates/resumes a VM.
 */
export async function startBrowserSandboxRuntime(
  session: BrowserSandboxRuntimeSession,
  expectedSessionId: string,
  input: BrowserSandboxRuntimeInput,
) {
  if (session.sessionId !== expectedSessionId) return "superseded" as const;
  if (session.status !== "running") return "inactive" as const;
  const value = runtimeSchema.parse(input);
  if (accessKeyNodeId(value.accessKey) !== value.nodeId)
    throw new Error("sandbox_key_node_mismatch");
  const staged = `/tmp/ftrade-runtime-${randomUUID()}`;
  const config = [
    `BROWSER_NODE_ID=${value.nodeId}`,
    `BROWSER_SANDBOX_OPERATION_ID=${value.operationId}`,
    `FTRADE_URL=${value.appOrigin}`,
    `BROWSER_AGENT_IMAGE=${value.agentImage}`,
    `BROWSER_IMAGE=${value.browserImage}`,
    "",
  ].join("\n");
  let outcome: "started" | "already-running" | "already-exited" | undefined;
  let cleaned = false;
  try {
    await session.writeFiles([
      { path: `${staged}.env`, content: config, mode: 0o600 },
      { path: `${staged}.key`, content: value.accessKey, mode: 0o600 },
    ]);
    const result = await session.runCommand({
      cmd: "bash",
      args: [
        "/vercel/sandbox/source/ops/browser-node/start-sandbox.sh",
        value.nodeId,
        value.operationId,
        staged,
      ],
      sudo: true,
      timeoutMs: 90000,
    });
    if (result.exitCode !== 0) throw new Error("sandbox_runtime_unconfirmed");
    const status = (await result.stdout()).trim();
    if (status !== "started" && status !== "already-running" && status !== "already-exited")
      throw new Error("sandbox_runtime_unconfirmed");
    outcome = status;
  } catch {
    // Provider errors can include requests or payloads: never relay raw errors.
    outcome = undefined;
  } finally {
    try {
      const cleanup = await session.runCommand({
        cmd: "rm",
        args: ["-f", "--", `${staged}.env`, `${staged}.key`],
        sudo: true,
        timeoutMs: 10000,
      });
      cleaned = cleanup.exitCode === 0;
    } catch {
      cleaned = false;
    }
  }
  if (!cleaned) throw new Error("sandbox_runtime_cleanup_unconfirmed");
  if (!outcome) throw new Error("sandbox_runtime_unconfirmed");
  return outcome;
}
