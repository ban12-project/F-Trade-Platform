import assert from "node:assert/strict";

import { validateUploadedVideoSourceAsset } from "../lib/video/uploaded-assets";

assert.equal(
  validateUploadedVideoSourceAsset(new File(["image"], "product.jpg", { type: "image/jpeg" }))
    .mediaType,
  "image",
);
assert.equal(
  validateUploadedVideoSourceAsset(new File(["image"], "product.jpeg", { type: "image/jpeg" }))
    .mediaType,
  "image",
);
assert.equal(
  validateUploadedVideoSourceAsset(new File(["video"], "clip.mp4", { type: "video/mp4" }))
    .mediaType,
  "video",
);
assert.throws(
  () => validateUploadedVideoSourceAsset(new File(["text"], "copy.txt", { type: "text/plain" })),
  /仅支持/,
);
assert.throws(
  () =>
    validateUploadedVideoSourceAsset(new File(["image"], "product.mp4", { type: "image/jpeg" })),
  /扩展名/,
);
assert.throws(
  () => validateUploadedVideoSourceAsset(new File([], "empty.png", { type: "image/png" })),
  /1 字节/,
);
console.log("PASS video material intake accepts only bounded private visual assets");
