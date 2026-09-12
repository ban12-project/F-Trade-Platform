import assert from "node:assert/strict";
import test from "node:test";
import {
  type BrowserSandboxMonitorDependencies,
  monitorBrowserSandboxSession,
} from "../lib/browser-fleet/sandbox-monitor";

function fixture(status = "running", retired = "stopped") {
  const calls: string[] = [];
  let inspections = 0;
  const deps = {
    async revoked() {
      return false;
    },
    async revoke() {
      calls.push("revoke");
      return "stopped";
    },
    async current() {
      calls.push("current");
      return true;
    },
    async inspect() {
      calls.push("inspect");
      inspections++;
      return {
        status: inspections === 1 ? status : "stopped",
        currentSession: () => ({ sessionId: "session", status }),
      };
    },
    async retire() {
      calls.push("retire");
      return retired;
    },
    async recordStopped() {
      calls.push("record");
      return true;
    },
  } as unknown as BrowserSandboxMonitorDependencies;
  return { calls, deps };
}
test("idle Agent retires its VM and confirms provider metadata before recording stop", async () => {
  const f = fixture();
  assert.equal(await monitorBrowserSandboxSession("node", "session", f.deps), "stopped");
  assert.deepEqual(f.calls, ["current", "inspect", "retire", "inspect", "record"]);
});
test("already stopped metadata requires no runtime command or resume", async () => {
  const f = fixture("stopped");
  assert.equal(await monitorBrowserSandboxSession("node", "session", f.deps), "stopped");
  assert.deepEqual(f.calls, ["current", "inspect", "record"]);
});
test("busy and transitional sessions are observed again without recording a false stop", async () => {
  const busy = fixture("running", "busy");
  assert.equal(await monitorBrowserSandboxSession("node", "session", busy.deps), "active");
  assert.ok(!busy.calls.includes("record"));
  const stopping = fixture("snapshotting");
  assert.equal(await monitorBrowserSandboxSession("node", "session", stopping.deps), "pending");
  assert.deepEqual(stopping.calls, ["current", "inspect"]);
});
test("obsolete database and provider session callbacks cannot stop a newer VM", async () => {
  const f = fixture();
  assert.equal(await monitorBrowserSandboxSession("node", "old", f.deps), "superseded");
  assert.ok(!f.calls.includes("retire"));
  const old = fixture();
  old.deps.current = async () => false;
  assert.equal(await monitorBrowserSandboxSession("node", "session", old.deps), "superseded");
  assert.deepEqual(old.calls, []);
});
test("provider failures retain pending state for observation without another start", async () => {
  const f = fixture();
  f.deps.inspect = async () => {
    throw new Error("private-detail");
  };
  assert.equal(await monitorBrowserSandboxSession("node", "session", f.deps), "pending");
  assert.deepEqual(f.calls, ["current"]);
});

test("revoked owner or node stops even an active Agent then verifies provider stop", async () => {
  const f = fixture("running", "busy");
  f.deps.revoked = async () => true;
  assert.equal(await monitorBrowserSandboxSession("node", "session", f.deps), "stopped");
  assert.deepEqual(f.calls, ["current", "inspect", "revoke", "inspect", "record"]);
});
