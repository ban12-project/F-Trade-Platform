import assert from "node:assert/strict";

import { generatedVideoAssetRefSchema, generatedVideoInputSchema } from "../lib/video/private-asset-store";

assert.equal(generatedVideoInputSchema.parse({ data: new Uint8Array([1, 2]), contentType: "video/mp4", provider: "fal", modelId: "synthetic-video-1001" }).contentType, "video/mp4");
assert.throws(() => generatedVideoInputSchema.parse({ data: new Uint8Array(), contentType: "video/mp4", provider: "fal", modelId: "synthetic-video-1001" }), /不能为空/);
assert.throws(() => generatedVideoInputSchema.parse({ data: new Uint8Array([1]), contentType: "image/png", provider: "fal", modelId: "synthetic-video-1001" }), /视频 MIME/);
assert.equal(generatedVideoAssetRefSchema.parse("asset-video-1001"), "asset-video-1001");
assert.throws(() => generatedVideoAssetRefSchema.parse("https://public.example/video.mp4"), /无效/);
console.log("PASS generated video assets require private video-only metadata");
