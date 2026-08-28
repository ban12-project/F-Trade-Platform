import assert from "node:assert/strict";

import { generatedVideoInputSchema } from "../lib/video/private-asset-store";

assert.equal(generatedVideoInputSchema.parse({ data: new Uint8Array([1, 2]), contentType: "video/mp4", provider: "fal", modelId: "synthetic-video-1001" }).contentType, "video/mp4");
assert.throws(() => generatedVideoInputSchema.parse({ data: new Uint8Array(), contentType: "video/mp4", provider: "fal", modelId: "synthetic-video-1001" }), /不能为空/);
assert.throws(() => generatedVideoInputSchema.parse({ data: new Uint8Array([1]), contentType: "image/png", provider: "fal", modelId: "synthetic-video-1001" }), /视频 MIME/);
console.log("PASS generated video assets require private video-only metadata");
