import assert from "node:assert/strict";

import { videoProjectSchema } from "../lib/video/contracts";
import {
  approvedVideoDownloadHeaders,
  resolveApprovedVideoAccess,
  resolveApprovedVideoDownload,
} from "../lib/video/download-policy";

const videoId = "00000000-0000-4000-8000-000000000701";
const approvedProject = videoProjectSchema.parse({
  id: videoId,
  productId: "00000000-0000-4000-8000-000000000702",
  status: "approved",
  objective: "Approved download",
  targetAudience: "Distributors",
  platforms: ["facebook"],
  factualClaims: [
    {
      field: "product.product_name",
      value: "Verified clutch kit",
      evidenceRef: "evidence-product-701",
    },
  ],
  sourceAssets: [
    {
      assetRef: "evidence-source-701",
      mediaType: "image",
      rightsEvidenceRef: "evidence-rights-701",
    },
  ],
  scenes: [
    {
      sceneId: "scene-701",
      prompt: "Authorized image",
      durationSeconds: 5,
      claimRefs: [],
      assetRefs: ["evidence-source-701"],
    },
  ],
  approvalRefs: ["00000000-0000-4000-8000-000000000703"],
  renderedAssetRef: "asset-render-701",
  exportArtifact: {
    id: "00000000-0000-4000-8000-000000000704",
    videoId,
    sourceAssetRef: "asset-render-701",
    platform: "facebook",
    surface: "video",
    presetVersion: "2026-08-31",
    presetSourceUrl: "https://www.facebook.com/business/ads-guide/update/video",
    status: "approved",
    approvalRef: "evidence-review-701",
    timelineDurationSeconds: 5,
    measured: {
      container: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      width: 1080,
      height: 1080,
      fps: 30,
      durationSeconds: 5,
      subtitleStreamCount: 0,
    },
    createdAt: "2026-09-03T00:00:00.000Z",
  },
});
const asset = {
  body: new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  }),
  contentType: "video/mp4",
  sizeBytes: 3,
  responseSizeBytes: 3,
  contentRange: null,
  etag: "synthetic-etag",
};
const store = {
  async getGeneratedVideo(assetRef: string, range?: string | null) {
    assert.equal(assetRef, "asset-render-701");
    assert.equal(range, "bytes=0-2");
    return asset;
  },
};
const findApproved = async () => ({ state: "VIDEO_APPROVED", payload: approvedProject });

void (async () => {
  const manifestAccess = await resolveApprovedVideoAccess(
    { user: { role: "user" } },
    videoId,
    findApproved,
    async () => undefined,
  );
  assert.equal(manifestAccess.kind, "ready");
  if (manifestAccess.kind !== "ready") throw new Error("Expected manifest access");
  assert.equal(manifestAccess.artifact.id, approvedProject.exportArtifact?.id);
  assert.equal(
    (
      await resolveApprovedVideoAccess(
        null,
        videoId,
        async () => {
          throw new Error("unauthorized database access");
        },
        async () => undefined,
      )
    ).kind,
    "forbidden",
  );
  assert.equal(
    (
      await resolveApprovedVideoAccess(
        { user: { role: "user" } },
        videoId,
        findApproved,
        async () => {
          throw new Error("rights revoked");
        },
      )
    ).kind,
    "unavailable",
  );
  let revalidated = 0;
  const result = await resolveApprovedVideoDownload(
    { user: { role: "user" } },
    videoId,
    "bytes=0-2",
    store,
    findApproved,
    async () => {
      revalidated += 1;
    },
  );
  assert.equal(result.kind, "ready");
  assert.equal(revalidated, 1);
  if (result.kind !== "ready") throw new Error("expected ready download");
  assert.equal(result.filename, "f-trade-facebook-00000000.mp4");
  const responseHeaders = approvedVideoDownloadHeaders(result.asset, result.filename);
  assert.equal(
    responseHeaders["Content-Disposition"],
    'attachment; filename="f-trade-facebook-00000000.mp4"',
  );
  assert.equal(responseHeaders["Cache-Control"], "private, no-store");
  assert.equal(
    (
      await resolveApprovedVideoDownload(
        null,
        videoId,
        null,
        store,
        findApproved,
        async () => undefined,
      )
    ).kind,
    "forbidden",
  );
  assert.equal(
    (
      await resolveApprovedVideoDownload(
        { user: { role: "user" } },
        videoId,
        null,
        store,
        async () => ({ state: "VIDEO_REVIEW_REQUIRED", payload: approvedProject }),
        async () => undefined,
      )
    ).kind,
    "not_found",
  );
  assert.equal(
    (
      await resolveApprovedVideoDownload(
        { user: { role: "user" } },
        videoId,
        null,
        store,
        findApproved,
        async () => {
          throw new Error("rights revoked");
        },
      )
    ).kind,
    "unavailable",
  );
  assert.equal(
    (
      await resolveApprovedVideoDownload(
        { user: { role: "user" } },
        videoId,
        null,
        store,
        async () => ({
          state: "VIDEO_APPROVED",
          payload: { ...approvedProject, renderedAssetRef: "asset-other-701" },
        }),
        async () => undefined,
      )
    ).kind,
    "unavailable",
  );
  assert.equal(
    (
      await resolveApprovedVideoDownload(
        { user: { role: "user" } },
        videoId,
        null,
        store,
        async () => ({
          state: "VIDEO_APPROVED",
          payload: {
            ...approvedProject,
            sourceAssets: approvedProject.sourceAssets.map((source) => ({
              ...source,
              usagePolicy: "private_test_only",
            })),
          },
        }),
        async () => undefined,
      )
    ).kind,
    "unavailable",
  );
  assert.equal(
    (
      await resolveApprovedVideoDownload(
        { user: { role: "user" } },
        videoId,
        null,
        {
          async getGeneratedVideo() {
            return null;
          },
        },
        findApproved,
        async () => undefined,
      )
    ).kind,
    "not_found",
  );
  assert.equal(
    (
      await resolveApprovedVideoDownload(
        { user: { role: "user" } },
        "invalid",
        null,
        store,
        findApproved,
        async () => undefined,
      )
    ).kind,
    "not_found",
  );
  console.log("PASS approved video downloads remain private, current, and rights-governed");
})();
