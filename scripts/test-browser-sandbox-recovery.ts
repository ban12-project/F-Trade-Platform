import assert from "node:assert/strict";
import test from "node:test";
import {
  type BrowserSandboxRecoveryDependencies,
  recoverBrowserSandboxDispatch,
} from "../lib/browser-fleet/sandbox-recovery";

function fixture(initial = "running") {
  const calls: string[] = [];
  let inspections = 0;
  const session = {
    sessionId: "bound",
    status: initial,
    async stop() {
      calls.push("stop");
    },
  };
  const deps = {
    async recorded() {
      return null;
    },
    async monitor() {
      calls.push("monitor");
      return "active";
    },
    async claim() {
      calls.push("claim");
      return { status: "captured", sessionId: "bound" };
    },
    async inspect() {
      calls.push("inspect");
      return {
        name: "ftrade-browser-node",
        persistent: true,
        status: ++inspections === 1 ? initial : "stopped",
        currentSession: () => session,
      };
    },
    async drain() {
      calls.push("drain");
      return "stopped";
    },
    async record() {
      calls.push("record");
      return true;
    },
  } as unknown as BrowserSandboxRecoveryDependencies;
  return { calls, session, deps };
}

test("bound uncertain start is fenced, drained and verified before recording stop", async () => {
  const f = fixture();
  assert.equal(await recoverBrowserSandboxDispatch("node", "operation", f.deps), "stopped");
  assert.deepEqual(f.calls, ["claim", "inspect", "drain", "inspect", "record"]);
});
test("missing Agent still stops the captured VM without claiming a clean browser outcome", async () => {
  const f = fixture();
  f.deps.drain = async () => {
    throw new Error("missing Agent");
  };
  assert.equal(await recoverBrowserSandboxDispatch("node", "operation", f.deps), "stopped");
  assert.deepEqual(f.calls, ["claim", "inspect", "stop", "inspect", "record"]);
});
test("stopped and transitional sessions never execute runtime commands", async () => {
  for (const status of ["stopped", "snapshotting"]) {
    const f = fixture(status);
    assert.equal(
      await recoverBrowserSandboxDispatch("node", "operation", f.deps),
      status === "stopped" ? "stopped" : "pending",
    );
    assert.ok(!f.calls.includes("drain") && !f.calls.includes("stop"));
  }
});
test("pending or superseded operations never inspect or create compute", async () => {
  for (const status of ["pending", "superseded"] as const) {
    const f = fixture();
    f.deps.claim = async () => ({ status });
    assert.equal(await recoverBrowserSandboxDispatch("node", "operation", f.deps), status);
    assert.deepEqual(f.calls, []);
  }
});
test("a different provider session is not stopped", async () => {
  const f = fixture();
  f.session.sessionId = "newer";
  assert.equal(await recoverBrowserSandboxDispatch("node", "operation", f.deps), "superseded");
  assert.deepEqual(f.calls, ["claim", "inspect"]);
});
test("lost stop response retains uncertainty until later metadata confirms stop", async () => {
  const f = fixture();
  f.deps.drain = async () => {
    throw new Error("transport");
  };
  f.session.stop = async () => {
    throw new Error("private transport detail");
  };
  assert.equal(await recoverBrowserSandboxDispatch("node", "operation", f.deps), "pending");
  assert.ok(!f.calls.includes("record"));
});
test("concurrent successful dispatch resumes normal monitoring", async () => {
  const f = fixture();
  f.deps.recorded = async () => ({ status: "running", sessionId: "bound" });
  assert.equal(await recoverBrowserSandboxDispatch("node", "operation", f.deps), "active");
  assert.deepEqual(f.calls, ["monitor"]);
});

test("proven initial create is bound and fenced before any stop", async () => {
  const f = fixture();
  f.deps.claim = async () => ({ status: "unbound" });
  f.deps.discover = async () => {
    f.calls.push("discover");
    return "bound";
  };
  f.deps.bind = async () => {
    f.calls.push("bind");
    return true;
  };
  assert.equal(await recoverBrowserSandboxDispatch("node", "operation", f.deps), "stopped");
  assert.deepEqual(f.calls, ["discover", "bind", "inspect", "drain", "inspect", "record"]);
});
test("unproven ownership or lost binding race never stops the provider", async () => {
  for (const proven of [false, true]) {
    const f = fixture();
    f.deps.claim = async () => ({ status: "unbound" });
    f.deps.discover = async () => (proven ? "bound" : null);
    f.deps.bind = async () => false;
    assert.equal(await recoverBrowserSandboxDispatch("node", "operation", f.deps), "pending");
    assert.deepEqual(f.calls, []);
  }
});
