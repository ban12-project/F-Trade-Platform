import assert from "node:assert/strict";
import { createComputeRuntime } from "../lib/compute/runtime";
import { VpsCompute, vpsComputeEnabled } from "../lib/compute/vps";
import { extractMarketingVisualSamplesInSandbox } from "../lib/video/sandbox-media";

async function main() {
  const oldFetch = globalThis.fetch;
  const saved = { ...process.env };
  process.env.COMPUTE_PROVIDER = "vps";
  process.env.VPS_RUNTIME_ORIGIN = "https://runtime.example.com";
  process.env.VPS_RUNTIME_TOKEN = "a".repeat(64);
  const calls: Record<string, unknown>[] = [];
  let file = Buffer.alloc(0);
  let failed = false;
  let commandFailure = false;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://runtime.example.com/v1/compute");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    if (failed) return new Response("private upstream diagnostic", { status: 503 });
    let result: unknown = null;
    if (body.action === "create") result = { id: "00000000-0000-4000-8000-000000000001" };
    if (body.action === "command")
      result = { exitCode: commandFailure ? 1 : 0, stdout: "synthetic result", stderr: "" };
    if (body.op === "write") {
      const value = Buffer.from(body.data as string, "base64");
      if (body.offset === 0) file = value;
      else {
        assert.equal(body.offset, file.length);
        file = Buffer.concat([file, value]);
      }
    }
    if (body.op === "read")
      result = file
        .subarray(Number(body.offset), Number(body.offset) + 4 * 1024 * 1024)
        .toString("base64");
    return Response.json({ result });
  };
  try {
    delete process.env.COMPUTE_PROVIDER;
    assert.equal(
      vpsComputeEnabled(),
      true,
      "Missing provider defaults to VPS, never paid Vercel compute",
    );
    process.env.COMPUTE_PROVIDER = "vps";
    const runtime = await createComputeRuntime();
    assert.ok(runtime instanceof VpsCompute);
    const input = Buffer.alloc(4 * 1024 * 1024 + 17, 173);
    await runtime.fs.writeFile("/vercel/sandbox/work/input.bin", input);
    assert.deepEqual(await runtime.fs.readFile("/vercel/sandbox/work/input.bin"), input);
    assert.equal(calls.filter((c) => c.op === "write").length, 2);
    const command = await runtime.runCommand({ cmd: "ffprobe", args: ["-version"] });
    assert.equal(await command.stdout(), "synthetic result");
    await runtime.download(
      "https://approved.example/object?token=synthetic",
      "approved.example",
      "/vercel/sandbox/work/source.mp4",
    );
    assert.equal(calls.at(-1)?.action, "download");
    await runtime.stop();
    commandFailure = true;
    const stopCount = calls.filter((call) => call.action === "stop").length;
    await assert.rejects(extractMarketingVisualSamplesInSandbox([], new Map()), /执行失败/);
    assert.equal(
      calls.filter((call) => call.action === "stop").length,
      stopCount + 1,
      "Failed runtime readiness releases capacity",
    );
    failed = true;
    const before = calls.length;
    await assert.rejects(createComputeRuntime(), /^Error: vps_runtime_request_failed$/);
    assert.equal(calls.length, before + 1, "Ambiguous create is not retried");
    process.env.COMPUTE_PROVIDER = "vercel";
    await assert.rejects(createComputeRuntime(), /compute_provider_invalid/);
    await assert.rejects(VpsCompute.create(), /compute_provider_invalid/);
    assert.equal(calls.length, before + 1, "Retired provider never creates compute");
    process.env.COMPUTE_PROVIDER = "typo";
    assert.throws(vpsComputeEnabled, /compute_provider_invalid/);
    process.env.COMPUTE_PROVIDER = "vps";
    process.env.VPS_RUNTIME_ORIGIN = "http://runtime.example.com";
    await assert.rejects(VpsCompute.create(), /configuration_invalid/);
    console.log(
      "PASS VPS client: provider fail-closed, bounded chunk roundtrip, private transport, no automatic create retry",
    );
  } finally {
    globalThis.fetch = oldFetch;
    for (const key of ["COMPUTE_PROVIDER", "VPS_RUNTIME_ORIGIN", "VPS_RUNTIME_TOKEN"]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
