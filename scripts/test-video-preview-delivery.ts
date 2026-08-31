import assert from "node:assert/strict";

import { privateVideoPreviewHeaders, resolveAdminPrivateVideoPreview } from "../lib/video/preview-delivery";

const asset = { body: new ReadableStream<Uint8Array>(), contentType: "video/mp4", sizeBytes: 1234 };

void (async () => {
  let reads = 0;
  const store = { async getGeneratedVideo() { reads += 1; return asset; } };
  assert.deepEqual(await resolveAdminPrivateVideoPreview(null, "asset-video-001", store), { kind: "forbidden" });
  assert.equal(reads, 0);
  assert.deepEqual(await resolveAdminPrivateVideoPreview({ user: { role: "admin" } }, "not-an-asset", store), { kind: "not_found" });
  assert.equal(reads, 0);
  const ready = await resolveAdminPrivateVideoPreview({ user: { role: "admin" } }, "asset-video-001", store);
  assert.equal(ready.kind, "ready");
  assert.equal(reads, 1);
  const headers = privateVideoPreviewHeaders(asset);
  assert.equal(headers["Cache-Control"], "private, no-cache");
  assert.equal(headers["Content-Type"], "video/mp4");
  assert.equal("Location" in headers, false);
  console.log("PASS private video preview requires admin access and exposes no Blob URL");
})();
