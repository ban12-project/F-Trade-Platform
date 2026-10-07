import { createHash, randomUUID } from "node:crypto";
import ready from "../../data/fixtures/product-ready.synthetic.json";
import type { Database } from "../../lib/db/client";
import * as schema from "../../lib/db/schema";
import { videoProjectSchema } from "../../lib/video/contracts";
import { createReviewVideoExport } from "../../lib/video/export-artifact";

/** Synthetic DB contract fixture, never evidence of real rendered media or rights. */
export async function seedVideoReviewFixture(db: Database, lifetime = 3_600_000) {
  const actorId = randomUUID(),
    ownerId = randomUUID(),
    sessionId = randomUUID(),
    token = randomUUID(),
    projectId = randomUUID(),
    productId = randomUUID(),
    videoId = randomUUID(),
    approvalId = randomUUID();
  const sourceRef = `evidence-synthetic-video-source-${randomUUID()}`;
  const decisionRef = `evidence-synthetic-video-review-${randomUUID()}`;
  const assetRef = `asset-synthetic-${randomUUID()}`;
  for (const [id, role] of [
    [actorId, "admin"],
    [ownerId, "user"],
  ])
    await db.insert(schema.user).values({
      id,
      name: "SYNTHETIC video reviewer",
      email: `${id}@example.invalid`,
      emailVerified: true,
      role,
    });
  await db.insert(schema.session).values({
    id: sessionId,
    userId: actorId,
    token,
    expiresAt: new Date(Date.now() + lifetime),
  });
  await db.insert(schema.workspaceProject).values({
    id: projectId,
    kind: "marketing",
    title: "SYNTHETIC video review project",
    createdById: ownerId,
  });
  for (const [userId, role] of [
    [actorId, "editor"],
    [ownerId, "owner"],
  ] as const)
    await db.insert(schema.workspaceProjectMember).values({
      id: randomUUID(),
      projectId,
      userId,
      role,
      createdById: ownerId,
    });
  for (const id of [sourceRef, decisionRef])
    await db.insert(schema.evidence).values({
      id,
      classification: "internal",
      blobKey: `synthetic/${id}`,
      contentType: "text/plain",
      sha256: createHash("sha256").update(id).digest("hex"),
      sizeBytes: 1,
      sourceLabel: "SYNTHETIC video review source",
      uploadedByType: "human",
      uploadedById: actorId,
    });
  await db.insert(schema.workspaceProjectEvidence).values({
    id: randomUUID(),
    projectId,
    evidenceId: sourceRef,
    linkedById: actorId,
  });
  const product = {
    ...ready,
    record_id: productId,
    product: { ...ready.product, product_name: "SYNTHETIC video review product" },
    field_evidence: { ...ready.field_evidence, "product.product_name": sourceRef },
    evidence_refs: [...ready.evidence_refs, sourceRef],
  };
  const video = videoProjectSchema.parse({
    id: videoId,
    productId,
    status: "review_required",
    objective: "SYNTHETIC Gate review",
    targetAudience: "SYNTHETIC-only buyers",
    platforms: ["facebook"],
    factualClaims: [
      {
        field: "product.product_name",
        value: product.product.product_name,
        evidenceRef: sourceRef,
      },
    ],
    sourceAssets: [{ assetRef: sourceRef, mediaType: "image", rightsEvidenceRef: sourceRef }],
    scenes: [
      {
        sceneId: "scene-synthetic",
        prompt: "SYNTHETIC",
        durationSeconds: 3,
        claimRefs: [],
        assetRefs: [sourceRef],
      },
    ],
    editDraft: {
      version: 3,
      creativeFramework: "google_abcd",
      platform: "facebook",
      ctaText: "SYNTHETIC inquiry",
      clips: [
        {
          clipId: "clip-synthetic",
          assetRef: sourceRef,
          mediaType: "image",
          trimStartMs: 0,
          durationMs: 3000,
          fitMode: "contain",
          audioMode: "muted",
          caption: { kind: "none" },
          abcdRoles: ["attention", "branding", "connection", "direction"],
          motionPreset: "cta_hold",
        },
      ],
    },
    renderedAssetRef: assetRef,
    exportArtifact: createReviewVideoExport({
      videoId,
      sourceAssetRef: assetRef,
      platform: "facebook",
      timeline: { durationSeconds: 3 },
      media: {
        container: "mp4",
        videoCodec: "h264",
        audioCodec: "aac",
        width: 1080,
        height: 1920,
        fps: 30,
        durationSeconds: 3,
        subtitleStreamCount: 0,
        encoding: {
          pixelFormat: "yuv420p",
          sampleAspectRatio: "1:1",
          audioSampleRate: 48000,
          audioChannels: 2,
        },
      },
    }),
  });
  await db.insert(schema.aggregateRecord).values([
    {
      id: productId,
      type: "product",
      state: "PRODUCT_READY",
      payload: product,
      createdByType: "human",
      createdById: actorId,
    },
    {
      id: videoId,
      type: "video",
      state: "VIDEO_REVIEW_REQUIRED",
      payload: video,
      createdByType: "human",
      createdById: actorId,
    },
  ]);
  const linkId = randomUUID();
  await db.insert(schema.workspaceProjectItem).values({
    id: linkId,
    projectId,
    aggregateId: videoId,
    role: "marketing_video",
    relation: "owned",
  });
  await db.insert(schema.approval).values({
    id: approvalId,
    aggregateId: videoId,
    gate: "gate_01_truth",
    status: "pending",
    requestedByType: "system",
    requestedById: "synthetic:contract-fixture",
    requestedAt: new Date(),
  });
  return {
    actorId,
    ownerId,
    sessionId,
    token,
    projectId,
    productId,
    videoId,
    approvalId,
    sourceRef,
    decisionRef,
    linkId,
    product,
    video,
  };
}
