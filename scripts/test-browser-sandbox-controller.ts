import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  type BrowserSandboxControllerDependencies,
  dispatchManualBrowserSandbox,
} from "../lib/browser-fleet/sandbox-controller";

const nodeId = randomUUID(),
  operationId = randomUUID();
const config = {
  templateSnapshotId: "snap_reviewed",
  appOrigin: "https://platform.example.invalid",
  agentImage: `sha256:${"a".repeat(64)}`,
  browserImage: `sha256:${"b".repeat(64)}`,
};
function fixture(
  fail?: "claim" | "before" | "after" | "provision" | "bind" | "start" | "settle" | "stop",
) {
  const calls: string[] = [];
  let authorizations = 0;
  const session = {
    sessionId: "current",
    status: "running",
    async stop() {
      calls.push("stop");
      if (fail === "stop") throw new Error("private-detail");
    },
  };
  const deps = {
    async recorded() {
      return null;
    },
    async claim() {
      calls.push("claim");
      return fail === "claim" ? null : { mode: "create", nodeId, operationId };
    },
    async authorize() {
      calls.push("authorize");
      authorizations++;
      return (fail === "before" && authorizations === 1) ||
        (fail === "after" && authorizations === 2)
        ? null
        : { sandboxName: `ftrade-browser-${nodeId}`, accessKey: "synthetic-secret" };
    },
    async provision() {
      calls.push("provision");
      if (fail === "provision") throw new Error("private-detail");
      return {
        session,
        sandboxName: `ftrade-browser-${nodeId}`,
        gatewayOrigin: "https://gateway.example.invalid",
      };
    },
    async bind() {
      calls.push("bind");
      return fail !== "bind";
    },
    async start() {
      calls.push("start");
      if (fail === "start" || fail === "stop") throw new Error("private-detail");
      return "started";
    },
    async settle(_node: string, _operation: string, result: { status: string }) {
      calls.push(`settle:${result.status}`);
      return !(fail === "settle" && result.status === "running");
    },
  } as unknown as BrowserSandboxControllerDependencies;
  return { calls, deps };
}
test("manual dispatch connects claim, reauthorization, provider, gateway and runtime in order", async () => {
  const f = fixture();
  const result = await dispatchManualBrowserSandbox(nodeId, operationId, config, f.deps);
  assert.deepEqual(result, { status: "running", sessionId: "current" });
  assert.deepEqual(f.calls, [
    "claim",
    "authorize",
    "provision",
    "bind",
    "authorize",
    "start",
    "settle:running",
  ]);
  assert.ok(!JSON.stringify(result).includes("synthetic-secret"));
});
test("duplicate claim and revoked demand do not provision compute", async () => {
  const duplicate = fixture("claim");
  assert.deepEqual(
    await dispatchManualBrowserSandbox(nodeId, operationId, config, duplicate.deps),
    { status: "not-dispatched" },
  );
  assert.deepEqual(duplicate.calls, ["claim"]);
  const revoked = fixture("before");
  await dispatchManualBrowserSandbox(nodeId, operationId, config, revoked.deps);
  assert.ok(!revoked.calls.includes("provision"));
});
test("post-provision failures stop the captured VM and preserve uncertainty", async () => {
  for (const failure of ["after", "bind", "start", "settle", "stop"] as const) {
    const f = fixture(failure);
    assert.deepEqual(await dispatchManualBrowserSandbox(nodeId, operationId, config, f.deps), {
      status: "needs-reconciliation",
      stopConfirmed: failure !== "stop",
    });
    assert.equal(f.calls.filter((call) => call === "stop").length, 1);
    assert.equal(f.calls.at(-1), "settle:unknown");
  }
});
test("lost provider response never guesses a session or repeats creation", async () => {
  const f = fixture("provision");
  assert.deepEqual(await dispatchManualBrowserSandbox(nodeId, operationId, config, f.deps), {
    status: "needs-reconciliation",
    stopConfirmed: false,
  });
  assert.deepEqual(f.calls, ["claim", "authorize", "provision", "settle:unknown"]);
});
test("invalid deployment config fails before taking a dispatch claim", async () => {
  const f = fixture();
  await assert.rejects(
    dispatchManualBrowserSandbox(nodeId, operationId, { ...config, agentImage: "latest" }, f.deps),
  );
  assert.deepEqual(f.calls, []);
});

test("lost step receipt resumes monitoring recorded session without provisioning or keys", async () => {
  const f = fixture();
  f.deps.recorded = async () => ({ status: "running", sessionId: "recorded-session" });
  assert.deepEqual(await dispatchManualBrowserSandbox(nodeId, operationId, config, f.deps), {
    status: "running",
    sessionId: "recorded-session",
  });
  assert.deepEqual(f.calls, []);
});
