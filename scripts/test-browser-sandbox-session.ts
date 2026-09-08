import assert from "node:assert/strict";
import test from "node:test";
import {
  type BrowserSandboxSession,
  stopIdleBrowserSandboxSession,
} from "../lib/browser-fleet/sandbox-session";

const nodeId = "11111111-1111-4111-8111-111111111111";
function fixture(status = "running", output = `${nodeId}|exited`, drainExit = 0) {
  const calls: string[] = [];
  const session: BrowserSandboxSession = {
    sessionId: "session-current",
    status,
    async runCommand(input) {
      calls.push(input.cmd);
      return { exitCode: input.cmd === "docker" ? 0 : drainExit, stdout: async () => output };
    },
    async stop() {
      calls.push("stop");
    },
  };
  return { session, calls };
}
test("stopped sessions and stale callbacks never execute or resume anything", async () => {
  for (const status of ["stopped", "stopping", "snapshotting"]) {
    const { session, calls } = fixture(status);
    assert.equal(
      await stopIdleBrowserSandboxSession(session, nodeId, session.sessionId),
      "inactive",
    );
    assert.deepEqual(calls, []);
  }
  const { session, calls } = fixture();
  assert.equal(await stopIdleBrowserSandboxSession(session, nodeId, "old-session"), "superseded");
  assert.deepEqual(calls, []);
});
test("a busy Agent does not stop its VM", async () => {
  const { session, calls } = fixture("running", `${nodeId}|running`);
  assert.equal(await stopIdleBrowserSandboxSession(session, nodeId, session.sessionId), "busy");
  assert.deepEqual(calls, ["docker"]);
});
test("exited Agent drains the node and stops the whole captured session", async () => {
  const { session, calls } = fixture();
  assert.equal(await stopIdleBrowserSandboxSession(session, nodeId, session.sessionId), "stopped");
  assert.deepEqual(calls, ["docker", "sh", "stop"]);
});
test("unconfirmed drain stops compute but never reports clean shutdown", async () => {
  const { session, calls } = fixture("running", `${nodeId}|exited`, 1);
  await assert.rejects(
    stopIdleBrowserSandboxSession(session, nodeId, session.sessionId),
    /drain_unconfirmed/,
  );
  assert.equal(calls.at(-1), "stop");
});
test("wrong node, unknown agent state and provider stop failure fail closed", async () => {
  for (const output of ["other-node|exited", `${nodeId}|paused`, `${nodeId}|exited|extra`]) {
    const { session, calls } = fixture("running", output);
    await assert.rejects(stopIdleBrowserSandboxSession(session, nodeId, session.sessionId));
    assert.deepEqual(calls, ["docker"]);
  }
  const { session } = fixture();
  session.stop = async () => {
    throw new Error("provider stop failed");
  };
  await assert.rejects(
    stopIdleBrowserSandboxSession(session, nodeId, session.sessionId),
    /provider stop failed/,
  );
});

test("a drain transport failure still stops compute", async () => {
  const { session, calls } = fixture();
  const original = session.runCommand;
  session.runCommand = async (input) => {
    if (input.cmd === "sh") throw new Error("transport lost");
    return original(input);
  };
  await assert.rejects(
    stopIdleBrowserSandboxSession(session, nodeId, session.sessionId),
    /drain_unconfirmed/,
  );
  assert.equal(calls.at(-1), "stop");
});
