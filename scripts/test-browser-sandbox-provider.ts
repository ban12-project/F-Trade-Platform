import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  type BrowserSandboxProvider,
  type BrowserSandboxProviderHandle,
  discoverInitialBrowserSandboxSession,
  inspectBrowserSandbox,
  provisionBrowserSandbox,
} from "../lib/browser-fleet/sandbox-provider";

const nodeId = randomUUID(),
  operationId = randomUUID();
function fixture(status = "stopped", fails = false, timeout: number | undefined = 1200000) {
  const calls: unknown[] = [];
  const handle = (state: string) =>
    ({
      name: `ftrade-browser-${nodeId}`,
      persistent: true,
      async update(input: unknown) {
        calls.push({ update: input });
      },
      vcpus: 2,
      tags: { "ftrade-node": nodeId },
      timeout,
      status: state,
      currentSession: () => ({ status: "running", sessionId: "current" }),
      domain: () => "https://gateway.example.invalid",
    }) as unknown as BrowserSandboxProviderHandle;
  const provider: BrowserSandboxProvider = {
    async create(input) {
      calls.push({ create: input });
      if (fails) throw new Error("private-provider-detail");
      return handle("running");
    },
    async get(input) {
      calls.push({ get: input });
      if (fails) throw new Error("snapshot_not_found private-provider-detail");
      return handle(input.resume ? "running" : status);
    },
  };
  return { provider, calls };
}
test("retired create/resume cannot touch a provider even with the old flag enabled", async () => {
  const old = process.env.BROWSER_SANDBOX_ENABLED;
  try {
    process.env.BROWSER_SANDBOX_ENABLED = "1";
    for (const mode of ["create", "resume"] as const) {
      const f = fixture();
      await assert.rejects(
        provisionBrowserSandbox(
          mode === "create"
            ? { mode, nodeId, operationId, templateSnapshotId: "snap_reviewed" }
            : { mode, nodeId, operationId },
          f.provider,
        ),
        { message: "vercel_sandbox_retired_use_vps" },
      );
      assert.deepEqual(f.calls, []);
    }
  } finally {
    if (old === undefined) delete process.env.BROWSER_SANDBOX_ENABLED;
    else process.env.BROWSER_SANDBOX_ENABLED = old;
  }
});
test("retirement preserves read-only inspection and never resumes", async () => {
  const f = fixture();
  await inspectBrowserSandbox(nodeId, f.provider);
  assert.deepEqual(f.calls, [{ get: { name: `ftrade-browser-${nodeId}`, resume: false } }]);
});

test("lost initial create requires exact tags and a single matching provider session", async () => {
  for (const variant of [
    "valid",
    "node-tag",
    "operation-tag",
    "resumed",
    "missing-history",
    "current-mismatch",
  ]) {
    let lists = 0;
    const provider = {
      async get(input: { name: string; resume: boolean }) {
        assert.deepEqual(input, { name: `ftrade-browser-${nodeId}`, resume: false });
        return {
          name: input.name,
          persistent: true,
          tags: {
            "ftrade-node": variant === "node-tag" ? randomUUID() : nodeId,
            "ftrade-created-by": variant === "operation-tag" ? randomUUID() : operationId,
          },
          currentSession: () => ({ sessionId: variant === "current-mismatch" ? "new" : "first" }),
          async listSessions() {
            lists++;
            return (async function* () {
              if (variant !== "missing-history") yield { id: "first" };
              if (variant === "resumed") yield { id: "second" };
            })();
          },
        };
      },
    } as unknown as NonNullable<Parameters<typeof discoverInitialBrowserSandboxSession>[2]>;
    assert.equal(
      await discoverInitialBrowserSandboxSession(nodeId, operationId, provider),
      variant === "valid" ? "first" : null,
    );
    if (variant.endsWith("tag")) assert.equal(lists, 0);
  }
});
