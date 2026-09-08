import assert from "node:assert/strict";
import { mock } from "node:test";

let deleted = 0,
  stopped = 0,
  written = 0;
let renderEnabled = false,
  invalidEncoding = false;
const events: string[] = [];
let failSigning = true,
  failCleanup = false;
mock.module("node:fs/promises", {
  exports: {
    readFile: async () => new Uint8Array([1]),
    writeFile: async () => {
      written++;
      events.push("write");
    },
  },
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
      events.push("delete");
      if (failCleanup) throw new Error("synthetic cleanup failure");
    },
  },
});
mock.module("@remotion/vercel", {
  exports: {
    createSandbox: async () => ({
      fs: { readFile: async () => new Uint8Array([1]) },
      runCommand: async ({ cmd, args }: { cmd: string; args: string[] }) => {
        if (cmd === "find")
          return {
            exitCode: 0,
            stdout: async () => "/vercel/sandbox/node_modules/synthetic/ffprobe",
          };
        assert.equal(cmd, "/vercel/sandbox/node_modules/synthetic/ffprobe");
        assert.equal(args.at(-1), "/vercel/sandbox/output.mp4");
        assert.ok(args.includes("-show_entries"));
        return {
          exitCode: 0,
          stdout: async () =>
            JSON.stringify({
              format: { format_name: "mp4", duration: "4" },
              streams: [
                {
                  codec_type: "video",
                  codec_name: "h264",
                  width: 1080,
                  height: 1920,
                  r_frame_rate: "30/1",
                  pix_fmt: invalidEncoding ? "yuv444p" : "yuv420p",
                  sample_aspect_ratio: "1:1",
                },
                { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 },
              ],
            }),
        };
      },
      stop: async () => {
        stopped++;
        events.push("stop");
        if (!renderEnabled) throw new Error("synthetic stop failure");
      },
    }),
    addBundleToSandbox: async () => {
      if (!renderEnabled) throw new Error("synthetic bundle failure");
    },
    renderMediaOnVercel: async () => {
      assert.ok(renderEnabled);
      return { sandboxFilePath: "/vercel/sandbox/output.mp4" };
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
  renderEnabled = true;
  failCleanup = false;
  invalidEncoding = true;
  const log = mock.method(console, "log", () => {
    events.push("pass");
  });
  await assert.rejects(main(), /pixelFormat/);
  assert.equal(written, 0, "Rejected encoding must never save an output");
  assert.equal(log.mock.callCount(), 0);
  assert.equal(deleted, 4);
  invalidEncoding = false;
  events.length = 0;
  await main();
  assert.equal(written, 1);
  assert.equal(log.mock.callCount(), 1);
  assert.equal(events.at(-1), "pass", "PASS must follow both cleanup operations");
  assert.ok(events.indexOf("delete") < events.indexOf("pass"));
  assert.ok(events.indexOf("stop") < events.indexOf("pass"));
  failCleanup = true;
  await assert.rejects(main(), /cleanup failed/);
  assert.equal(log.mock.callCount(), 1, "Cleanup failure must never print another PASS");
  log.mock.restore();
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
