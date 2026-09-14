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
        currentSession: () => ({
          sessionId: "session",
          status,
          async stop() {
            calls.push("stop-session");
          },
        }),
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

test("revoked Agent inspection failure stops only the captured session and verifies metadata", async () => {
  const f = fixture();
  f.deps.revoked = async () => true;
  f.deps.revoke = async () => {
    throw new Error("agent_missing");
  };
  assert.equal(await monitorBrowserSandboxSession("node", "session", f.deps), "stopped");
  assert.deepEqual(f.calls, ["current", "inspect", "stop-session", "inspect", "record"]);
  const active = fixture();
  active.deps.retire = async () => {
    throw new Error("agent_unreachable");
  };
  assert.equal(await monitorBrowserSandboxSession("node", "session", active.deps), "pending");
  assert.deepEqual(active.calls, ["current", "inspect"]);
});

test("revoked fallback retains uncertainty after lost stop or unconfirmed provider metadata", async () => {
  for (const failure of ["stop", "inspection", "still-running", "new-session"]) {
    const f = fixture();
    f.deps.revoked = async () => true;
    f.deps.revoke = async () => {
      throw new Error("agent_missing");
    };
    const inspect = f.deps.inspect;
    let count = 0;
    f.deps.inspect = async (nodeId) => {
      count++;
      const sandbox = await inspect(nodeId);
      if (count === 1 && failure === "stop") {
        const current = sandbox.currentSession;
        sandbox.currentSession = () =>
          new Proxy(current(), {
            get(target, key) {
              if (key === "stop")
                return async () => {
                  throw new Error("lost_stop_response");
                };
              return Reflect.get(target, key);
            },
          });
      }
      if (count === 2) {
        if (failure === "inspection") throw new Error("provider_unreachable");
        if (failure === "still-running") return { ...sandbox, status: "running" };
        if (failure === "new-session") {
          const current = sandbox.currentSession;
          sandbox.currentSession = () =>
            new Proxy(current(), {
              get(target, key) {
                return key === "sessionId" ? "new" : Reflect.get(target, key);
              },
            });
        }
      }
      return sandbox;
    };
    assert.equal(
      await monitorBrowserSandboxSession("node", "session", f.deps),
      failure === "new-session" ? "superseded" : "pending",
    );
    assert.ok(!f.calls.includes("record"));
  }
});
