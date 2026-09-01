import assert from "node:assert/strict";

import { completedVideoUploadTokenSchema, mediaTypeForVideoUpload, videoPresignedUploadPayloadSchema, videoUploadBlobPath } from "../lib/video/upload-contracts";

const payload = videoPresignedUploadPayloadSchema.parse({
  receiptId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  originalFilename: "authorized-product.MP4",
  contentType: "video/mp4",
  sizeBytes: 1024,
  rightsEvidenceRef: "evidence-rights-001",
});
const pathname = videoUploadBlobPath(payload);
assert.equal(pathname, "video/uploads/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111.mp4");
assert.equal(mediaTypeForVideoUpload(payload.contentType), "video");
assert.equal(completedVideoUploadTokenSchema.parse({ ...payload, actorId: "user-1", blobPath: pathname }).blobPath, pathname);
assert.throws(() => videoPresignedUploadPayloadSchema.parse({ ...payload, sizeBytes: 20 * 1024 * 1024 + 1 }));
assert.throws(() => videoPresignedUploadPayloadSchema.parse({ ...payload, contentType: "application/octet-stream" }));
assert.throws(() => completedVideoUploadTokenSchema.parse({ ...payload, actorId: "user-1", blobPath: "video/uploads/other/file.mp4" }));

console.log("PASS presigned video upload contract binds type, size, project and exact pathname");
