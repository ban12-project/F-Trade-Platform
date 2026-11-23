import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

import {
  generatedVideoAssetRefSchema,
  generatedVideoInputSchema,
  withTemporaryPrivateVideoFile,
  wrapPrivateVideoBodyStream,
} from "../lib/video/private-asset-store";

assert.equal(
  generatedVideoInputSchema.parse({
    data: new Uint8Array([1, 2]),
    contentType: "video/mp4",
    provider: "fal",
    modelId: "synthetic-video-1001",
  }).contentType,
  "video/mp4",
);
assert.throws(
  () =>
    generatedVideoInputSchema.parse({
      data: new Uint8Array(),
      contentType: "video/mp4",
      provider: "fal",
      modelId: "synthetic-video-1001",
    }),
  /不能为空/,
);
assert.throws(
  () =>
    generatedVideoInputSchema.parse({
      data: new Uint8Array([1]),
      contentType: "image/png",
      provider: "fal",
      modelId: "synthetic-video-1001",
    }),
  /视频 MIME/,
);
assert.equal(generatedVideoAssetRefSchema.parse("asset-video-1001"), "asset-video-1001");
assert.throws(() => generatedVideoAssetRefSchema.parse("https://public.example/video.mp4"), /无效/);
async function main() {
  let temporaryPath = "";
  const bytes = await withTemporaryPrivateVideoFile(
    {
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      }),
      contentType: "video/mp4",
      sizeBytes: 3,
    },
    async (filePath) => {
      temporaryPath = filePath;
      return readFile(filePath);
    },
  );
  assert.deepEqual([...bytes], [1, 2, 3]);
  await assert.rejects(() => access(temporaryPath));

  // Verify wrapped stream works in `new Response()` and propagates cancel.
  let cancelledReason: unknown = null;
  const wrapped = wrapPrivateVideoBodyStream(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([10, 20, 30, 40]));
        controller.close();
      },
      cancel(reason) {
        cancelledReason = reason;
      },
    }),
  );
  const response = new Response(wrapped, { status: 206 });
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [10, 20, 30, 40]);

  const cancelTarget = wrapPrivateVideoBodyStream(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([99]));
      },
      cancel(reason) {
        cancelledReason = reason ?? "cancelled";
      },
    }),
  );
  const headResponse = new Response(cancelTarget, { status: 206 });
  await headResponse.body?.cancel("head-only");
  assert.equal(cancelledReason, "head-only");
  console.log("PASS generated video assets require private video-only metadata");
}

void main();
