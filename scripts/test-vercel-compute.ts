import assert from "node:assert/strict";
import { Sandbox } from "@vercel/sandbox";
import { createComputeRuntime } from "../lib/compute/runtime";
import { computeSandboxOptions, VercelCompute, validateComputeSource } from "../lib/compute/vercel";

async function main() {
  const saved = { ...process.env };
  const originalCreate = Sandbox.create;
  const events: unknown[] = [];
  let failDownload = false;
  let failCreate = false;
  let failInit = false;
  let creates = 0;
  let polls = 0;
  let failWait = false;
  const session = {
    runCommand: async (
      input: string | { cmd: string; detached?: boolean; env?: Record<string, string> },
    ) => {
      events.push(input);
      if (typeof input !== "string" && input.detached)
        return {
          cmdId: "original-command",
          exitCode: null,
          wait: async ({ signal }: { signal: AbortSignal }) => {
            polls++;
            signal.throwIfAborted();
            if (failWait) throw new Error("synthetic_transport_failure");
            return { exitCode: 0, stdout: async () => "finished", stderr: async () => "" };
          },
        };
      return {
        exitCode: (typeof input === "string" ? failInit : failDownload) ? 1 : 0,
        stdout: async () => "100",
        stderr: async () => "synthetic failure",
      };
    },
    update: async (options: unknown) => {
      events.push(options);
    },
  };
  Sandbox.create = (async (options: unknown) => {
    creates++;
    events.push(options);
    if (failCreate) throw new Error("ambiguous_creation_failure");
    return {
      currentSession: () => session,
      // Any accidental use of the resumable high-level API fails this test.
      runCommand: () => {
        throw new Error("must_not_auto_resume");
      },
      delete: async (options: unknown) => {
        events.push({
          deleted: {
            deleteOrphanSnapshots: (options as { deleteOrphanSnapshots: boolean })
              .deleteOrphanSnapshots,
          },
        });
      },
    };
  }) as unknown as typeof Sandbox.create;
  try {
    process.env.COMPUTE_SANDBOX_IMAGE = `f-trade-runtime@sha256:${"a".repeat(64)}`;
    delete process.env.COMPUTE_PROVIDER;
    const runtime = await createComputeRuntime();
    assert.ok(runtime instanceof VercelCompute);
    assert.equal(computeSandboxOptions("heavy").resources.vcpus, 4);
    assert.equal(computeSandboxOptions("light").resources.vcpus, 1);
    assert.equal(computeSandboxOptions("heavy").persistent, false);
    assert.equal(computeSandboxOptions("heavy").timeout, 600_000);
    assert.equal(computeSandboxOptions("heavy").networkPolicy, "deny-all");
    const originalTimeout = AbortSignal.timeout;
    let waits = 0;
    AbortSignal.timeout = (ms) =>
      ++waits === 1 ? AbortSignal.abort(new Error("synthetic wait timeout")) : originalTimeout(ms);
    let result: Awaited<ReturnType<typeof runtime.runCommand>>;
    try {
      result = await runtime.runCommand({ cmd: "node", args: ["synthetic-render"] });
    } finally {
      AbortSignal.timeout = originalTimeout;
    }
    assert.equal(result.exitCode, 0);
    assert.equal(await result.stdout(), "finished");
    assert.equal(polls, 2);
    assert.equal(
      events.filter((event) => typeof event === "object" && event !== null && "detached" in event)
        .length,
      1,
    );
    failWait = true;
    const beforeFailure = polls;
    await assert.rejects(
      runtime.runCommand({ cmd: "node", args: [] }),
      /synthetic_transport_failure/,
    );
    assert.equal(polls, beforeFailure + 1, "non-timeout errors are not retried");
    failWait = false;
    const host = "synthetic.private.blob.vercel-storage.com";
    const url = `https://${host}/fixture.mp4?signature=synthetic`;
    const destination = "/vercel/sandbox/work/input.mp4";
    for (const bad of [
      `http://${host}`,
      "https://127.0.0.1/x",
      `https://user@${host}/x`,
      `https://${host}:444/x`,
      `https://${host}/x#fragment`,
    ])
      assert.throws(() => validateComputeSource(bad, host, destination));
    assert.throws(() => validateComputeSource(url, host, "/tmp/input"));
    assert.throws(() => validateComputeSource(url, host, "/vercel/sandbox/work/../secret"));
    await runtime.download(url, host, destination);
    assert.deepEqual(events.at(-1), { networkPolicy: "deny-all" });
    failDownload = true;
    await assert.rejects(
      runtime.download(url, host, destination),
      /^Error: compute_source_download_failed$/,
    );
    assert.deepEqual(events.at(-1), { networkPolicy: "deny-all" }, "failure closes egress");
    failDownload = false;
    await runtime.stop();
    assert.deepEqual(events.at(-1), { deleted: { deleteOrphanSnapshots: true } });
    failInit = true;
    await assert.rejects(createComputeRuntime());
    assert.deepEqual(
      events.at(-1),
      { deleted: { deleteOrphanSnapshots: true } },
      "failed setup deletes VM",
    );
    failInit = false;
    failCreate = true;
    const before = creates;
    await assert.rejects(createComputeRuntime(), /ambiguous_creation_failure/);
    assert.equal(creates, before + 1, "no ambiguous retry or cross-provider fallback");
    process.env.COMPUTE_SANDBOX_IMAGE = "f-trade-runtime:latest";
    assert.throws(() => computeSandboxOptions("heavy"), /image_invalid/);
    process.env.COMPUTE_PROVIDER = "typo";
    await assert.rejects(createComputeRuntime(), /provider_invalid/);
    console.log(
      "PASS Vercel compute: pinned image, bounded ephemeral sessions, provider selection, source validation, egress restoration and cleanup",
    );
  } finally {
    Sandbox.create = originalCreate;
    for (const key of ["COMPUTE_PROVIDER", "COMPUTE_SANDBOX_IMAGE"]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
