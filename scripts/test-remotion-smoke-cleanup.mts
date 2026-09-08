import assert from "node:assert/strict";
import { mock } from "node:test";

let deleted = 0,
  stopped = 0;
let failSigning = true,
  failCleanup = false;
mock.module("node:fs/promises", {
  exports: { readFile: async () => new Uint8Array([1]), writeFile: async () => {} },
});
mock.module("@vercel/blob", {
  exports: {
    put: async () => ({ pathname: "synthetic", url: "https://example.invalid/synthetic" }),
    issueSignedToken: async () => {
      if (failSigning) throw new Error("synthetic signing failure");
      return "synthetic";
    },
    presignUrl: async () => ({ presignedUrl: "https://example.invalid/synthetic" }),
    del: async () => {
      deleted++;
      if (failCleanup) throw new Error("synthetic cleanup failure");
    },
  },
});
mock.module("@remotion/vercel", {
  exports: {
    createSandbox: async () => ({
      stop: async () => {
        stopped++;
        throw new Error("synthetic stop failure");
      },
    }),
    addBundleToSandbox: async () => {
      throw new Error("synthetic bundle failure");
    },
    renderMediaOnVercel: async () => {
      throw new Error("must not render");
    },
  },
});
const { main } = await import("./run-remotion-vercel-sandbox-smoke.mjs");
const previous = process.env.BLOB_READ_WRITE_TOKEN;
const previousUrl = process.env.REMOTION_SMOKE_SOURCE_URL;
process.env.BLOB_READ_WRITE_TOKEN = "synthetic-not-a-credential";
delete process.env.REMOTION_SMOKE_SOURCE_URL;
try {
  await assert.rejects(main(), /synthetic signing failure/);
  assert.equal(deleted, 1, "Signing failure must delete the uploaded source");
  assert.equal(stopped, 0);
  failCleanup = true;
  await assert.rejects(main(), /cleanup failed/);
  assert.equal(deleted, 2, "Failed deletion must be visible");
  failSigning = false;
  await assert.rejects(main(), /cleanup failed/);
  assert.equal(stopped, 1);
  assert.equal(deleted, 3, "Sandbox stop failure must not prevent Blob deletion");
  console.log(
    "PASS smoke failure cleanup: signing, visible cleanup failure, independent Sandbox/Blob cleanup",
  );
} finally {
  if (previous === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = previous;
  if (previousUrl === undefined) delete process.env.REMOTION_SMOKE_SOURCE_URL;
  else process.env.REMOTION_SMOKE_SOURCE_URL = previousUrl;
  mock.restoreAll();
}
