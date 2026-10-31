import assert from "node:assert/strict";
import { mock } from "node:test";

let calls = 0;
const unexpected = () => {
  calls++;
  throw new Error("unexpected_cloud_io");
};
mock.module("@remotion/vercel", {
  exports: {
    createSandbox: unexpected,
    addBundleToSandbox: unexpected,
    renderMediaOnVercel: unexpected,
  },
});
mock.module("@vercel/blob", {
  exports: {
    put: unexpected,
    del: unexpected,
    issueSignedToken: unexpected,
    presignUrl: unexpected,
  },
});
const { main } = await import("./run-remotion-vercel-sandbox-smoke.mts");
await assert.rejects(main(), { message: "vercel_sandbox_retired_use_vps" });
assert.equal(calls, 0, "retired smoke performs no cloud I/O");
console.log("PASS: retired Remotion smoke performs no cloud I/O");
