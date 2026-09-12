import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  type BrowserSandboxRuntimeSession,
  startBrowserSandboxRuntime,
} from "../lib/browser-fleet/sandbox-runtime";
import { createAccessKey } from "../lib/browser-fleet/security";

const nodeId = randomUUID();
const input = {
  nodeId,
  operationId: randomUUID(),
  appOrigin: "https://platform.example.invalid",
  agentImage: `sha256:${"a".repeat(64)}`,
  browserImage: `sha256:${"b".repeat(64)}`,
  accessKey: createAccessKey(nodeId),
};
function fixture(output = "started", failure?: "write" | "start" | "cleanup") {
  const files: { path: string; content: string; mode: number }[] = [];
  const commands: { cmd: string; args: string[] }[] = [];
  const session: BrowserSandboxRuntimeSession = {
    sessionId: "current-session",
    status: "running",
    async writeFiles(entries) {
      files.push(...entries);
      if (failure === "write") throw new Error(input.accessKey);
    },
    async runCommand(command) {
      commands.push(command);
      if (
        (failure === "start" && command.cmd === "bash") ||
        (failure === "cleanup" && command.cmd === "rm")
      )
        throw new Error(input.accessKey);
      return { exitCode: 0, stdout: async () => output };
    },
    async stop() {
      throw new Error("runtime configuration must not operate another lifecycle");
    },
  };
  return { session, files, commands };
}
test("inactive and stale sessions never upload credentials or run commands", async () => {
  for (const status of ["stopped", "stopping"]) {
    const f = fixture();
    f.session.status = status;
    assert.equal(await startBrowserSandboxRuntime(f.session, "current-session", input), "inactive");
    assert.deepEqual(f.files, []);
    assert.deepEqual(f.commands, []);
  }
  const f = fixture();
  assert.equal(await startBrowserSandboxRuntime(f.session, "old-session", input), "superseded");
  assert.deepEqual(f.files, []);
  assert.deepEqual(f.commands, []);
});
test("configuration uses private files and never puts a key in command arguments", async () => {
  const f = fixture();
  assert.equal(await startBrowserSandboxRuntime(f.session, "current-session", input), "started");
  assert.equal(f.files.length, 2);
  assert.ok(f.files.every((file) => file.mode === 0o600));
  assert.ok(!f.files[0].content.includes(input.accessKey));
  assert.equal(f.files[1].content, input.accessKey);
  assert.ok(!JSON.stringify(f.commands).includes(input.accessKey));
  assert.equal(f.commands[0].cmd, "bash");
  assert.deepEqual(f.commands[1].args, ["-f", "--", ...f.files.map((file) => file.path)]);
});
test("invalid node keys, mutable images and config injection fail before I/O", async () => {
  for (const value of [
    { ...input, accessKey: createAccessKey(randomUUID()) },
    { ...input, agentImage: "latest" },
    { ...input, operationId: "x\nFTRADE_URL=bad" },
    { ...input, appOrigin: "http://platform.example" },
  ]) {
    const f = fixture();
    await assert.rejects(startBrowserSandboxRuntime(f.session, "current-session", value));
    assert.deepEqual(f.files, []);
    assert.deepEqual(f.commands, []);
  }
});
test("uncertain writes and starts clean up staging and return only fixed errors", async () => {
  for (const failure of ["write", "start"] as const) {
    const f = fixture("started", failure);
    await assert.rejects(startBrowserSandboxRuntime(f.session, "current-session", input), {
      message: "sandbox_runtime_unconfirmed",
    });
    assert.equal(f.commands.at(-1)?.cmd, "rm");
  }
});
test("cleanup failure prevents a successful result and never exposes provider errors", async () => {
  const f = fixture("started", "cleanup");
  await assert.rejects(startBrowserSandboxRuntime(f.session, "current-session", input), {
    message: "sandbox_runtime_cleanup_unconfirmed",
  });
});
test("same-operation completed Agent remains exited; arbitrary output is refused", async () => {
  for (const output of ["already-running", "already-exited"]) {
    const f = fixture(output);
    assert.equal(await startBrowserSandboxRuntime(f.session, "current-session", input), output);
  }
  const f = fixture("unexpected");
  await assert.rejects(startBrowserSandboxRuntime(f.session, "current-session", input), {
    message: "sandbox_runtime_unconfirmed",
  });
});
