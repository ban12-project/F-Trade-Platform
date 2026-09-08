import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import { stopIdleBrowserSandboxSession } from "../lib/browser-fleet/sandbox-session";

// Explicit opt-in live test. No business credentials or actual browser account.
let sandbox: Sandbox | undefined;
const nodeId = randomUUID();
try {
  sandbox = await Sandbox.create({ persistent: false, timeout: 300000, resources: { vcpus: 2 } });
  console.log("Created bounded idle-stop test Sandbox");
  const install = await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-ec",
      "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y -qq docker.io",
    ],
    sudo: true,
    timeoutMs: 180000,
  });
  assert.equal(install.exitCode, 0, "Docker install failed");
  await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", "exec dockerd >/tmp/ftrade-dockerd.log 2>&1"],
    sudo: true,
    detached: true,
  });
  const prepared = await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-ec",
      'for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done; docker run --name ftrade-browser-agent --label "io.ftrade.node=$1" --network none busybox:1.37 true',
      "ftrade-idle-test",
      nodeId,
    ],
    sudo: true,
    timeoutMs: 90000,
  });
  assert.equal(prepared.exitCode, 0, "Synthetic exited Agent fixture failed");
  const session = sandbox.currentSession();
  assert.equal(await stopIdleBrowserSandboxSession(session, nodeId, session.sessionId), "stopped");
  const stopped = await Sandbox.get({ name: sandbox.name, resume: false });
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.currentSession().sessionId, session.sessionId);
  assert.equal(
    await stopIdleBrowserSandboxSession(stopped.currentSession(), nodeId, session.sessionId),
    "inactive",
  );
  const checked = await Sandbox.get({ name: sandbox.name, resume: false });
  assert.equal(checked.status, "stopped");
  assert.equal(checked.currentSession().sessionId, session.sessionId);
  console.log("PASS whole VM stopped; repeated idle check did not resume a session");
} finally {
  if (sandbox) {
    try {
      await sandbox.stop();
    } finally {
      await sandbox.delete({ deleteOrphanSnapshots: true });
    }
    console.log("Deleted idle-stop test Sandbox");
  }
}
