import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  type BrowserSandboxProvider,
  type BrowserSandboxProviderHandle,
  inspectBrowserSandbox,
  provisionBrowserSandbox,
} from "../lib/browser-fleet/sandbox-provider";

const nodeId = randomUUID(),
  operationId = randomUUID();
function fixture(status = "stopped", fails = false) {
  const calls: unknown[] = [];
  const handle = (state: string) =>
    ({
      name: `ftrade-browser-${nodeId}`,
      persistent: true,
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
test("first provision uses a named template, bounded compute and only the gateway port", async () => {
  const f = fixture();
  const result = await provisionBrowserSandbox(
    { mode: "create", nodeId, operationId, templateSnapshotId: "snap_reviewed" },
    f.provider,
  );
  assert.equal(result.session.sessionId, "current");
  const call = (f.calls[0] as { create: Record<string, unknown> }).create;
  assert.equal(call.name, `ftrade-browser-${nodeId}`);
  assert.deepEqual(call.ports, [9400]);
  assert.deepEqual(call.resources, { vcpus: 2 });
  assert.equal(call.timeout, 1200000);
  assert.deepEqual(call.env, {});
  assert.equal(f.calls.length, 1);
});
test("resume first inspects stopped metadata then resumes the same name", async () => {
  const f = fixture();
  await provisionBrowserSandbox({ mode: "resume", nodeId, operationId }, f.provider);
  assert.deepEqual(f.calls, [
    { get: { name: `ftrade-browser-${nodeId}`, resume: false } },
    { get: { name: `ftrade-browser-${nodeId}`, resume: true } },
  ]);
});
test("missing snapshots, running and transitional sessions never create replacements", async () => {
  for (const status of ["running", "stopping", "snapshotting"]) {
    const f = fixture(status);
    await assert.rejects(
      provisionBrowserSandbox({ mode: "resume", nodeId, operationId }, f.provider),
      { message: "sandbox_provision_unconfirmed" },
    );
    assert.equal(f.calls.length, 1);
  }
  const f = fixture("stopped", true);
  await assert.rejects(
    provisionBrowserSandbox({ mode: "resume", nodeId, operationId }, f.provider),
    { message: "sandbox_provision_unconfirmed" },
  );
  assert.equal(f.calls.length, 1);
});
test("uncertain create is not retried and inspection never enables resume", async () => {
  const f = fixture("stopped", true);
  await assert.rejects(
    provisionBrowserSandbox(
      { mode: "create", nodeId, operationId, templateSnapshotId: "snap_reviewed" },
      f.provider,
    ),
    { message: "sandbox_provision_unconfirmed" },
  );
  assert.equal(f.calls.length, 1);
  const read = fixture();
  await inspectBrowserSandbox(nodeId, read.provider);
  assert.deepEqual(read.calls, [{ get: { name: `ftrade-browser-${nodeId}`, resume: false } }]);
});
