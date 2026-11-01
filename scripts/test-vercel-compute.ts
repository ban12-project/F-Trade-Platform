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
  const session = {
    runCommand: async (input: string | { cmd: string; env?: Record<string, string> }) => {
      events.push(input);
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
        events.push({ deleted: options });
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
