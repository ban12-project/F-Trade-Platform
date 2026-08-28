import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

import { generatedVideoAssetRefSchema, generatedVideoInputSchema, withTemporaryPrivateVideoFile } from "../lib/video/private-asset-store";

assert.equal(generatedVideoInputSchema.parse({ data: new Uint8Array([1, 2]), contentType: "video/mp4", provider: "fal", modelId: "synthetic-video-1001" }).contentType, "video/mp4");
assert.throws(() => generatedVideoInputSchema.parse({ data: new Uint8Array(), contentType: "video/mp4", provider: "fal", modelId: "synthetic-video-1001" }), /不能为空/);
assert.throws(() => generatedVideoInputSchema.parse({ data: new Uint8Array([1]), contentType: "image/png", provider: "fal", modelId: "synthetic-video-1001" }), /视频 MIME/);
assert.equal(generatedVideoAssetRefSchema.parse("asset-video-1001"), "asset-video-1001");
assert.throws(() => generatedVideoAssetRefSchema.parse("https://public.example/video.mp4"), /无效/);
async function main() {
  let temporaryPath = "";
  const bytes = await withTemporaryPrivateVideoFile({ body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } }), contentType: "video/mp4", sizeBytes: 3 }, async (filePath) => { temporaryPath = filePath; return readFile(filePath); });
  assert.deepEqual([...bytes], [1, 2, 3]);
  await assert.rejects(() => access(temporaryPath));
  console.log("PASS generated video assets require private video-only metadata");
}

void main();
