import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../../lib/db/client";
import * as schema from "../../lib/db/schema";
import { videoProjectSchema } from "../../lib/video/contracts";
import { seedVideoReviewFixture } from "./video-review";

/** Derives an editable synthetic draft and an independent copy target. */
export async function seedVideoDraftFixture(db: Database, role: "admin" | "user" = "user") {
  const f = await seedVideoReviewFixture(db);
  await db.update(schema.user).set({ role }).where(eq(schema.user.id, f.actorId));
  const video = videoProjectSchema.parse({
    ...f.video,
    status: "draft",
    approvalRefs: [],
    renderedAssetRef: undefined,
    exportArtifact: undefined,
  });
  if (!video.editDraft) throw new Error("Synthetic editor fixture missing draft");
  await db
    .update(schema.aggregateRecord)
    .set({ state: "VIDEO_DRAFT", payload: video })
    .where(eq(schema.aggregateRecord.id, f.videoId));
  await db.delete(schema.approval).where(eq(schema.approval.id, f.approvalId));
  const targetProjectId = randomUUID();
  await db.insert(schema.workspaceProject).values({
    id: targetProjectId,
    kind: "marketing",
    title: "SYNTHETIC video copy target",
    createdById: f.ownerId,
  });
  for (const [userId, memberRole] of [
    [f.actorId, "editor"],
    [f.ownerId, "owner"],
  ] as const)
    await db.insert(schema.workspaceProjectMember).values({
      id: randomUUID(),
      projectId: targetProjectId,
      userId,
      role: memberRole,
      createdById: f.ownerId,
    });
  return { ...f, video, draft: video.editDraft, targetProjectId, appRole: role };
}

/** Approved synthetic factory media; no file decoding or real rights are asserted. */
export async function seedVideoCreationFixture(db: Database, role: "admin" | "user" = "user") {
  const f = await seedVideoDraftFixture(db, role);
  const { productMediaAsset } = await import("../../lib/db/product-media-schema");
  const productLinkId = randomUUID(),
    mediaId = randomUUID();
  await db.insert(schema.workspaceProjectItem).values({
    id: productLinkId,
    projectId: f.projectId,
    aggregateId: f.productId,
    role: "product_source",
    relation: "owned",
  });
  await db.insert(productMediaAsset).values({
    id: mediaId,
    productId: f.productId,
    evidenceId: f.sourceRef,
    origin: "factory",
    mediaType: "image",
    role: "product_hero",
    contentType: "image/png",
    width: 100,
    height: 100,
    productVisible: true,
    rightsEvidenceRef: f.sourceRef,
    editingAllowed: true,
    publicDistributionAllowed: true,
    reviewStatus: "approved",
    reviewedBy: f.ownerId,
    reviewedAt: new Date(),
    reviewEvidenceRef: f.decisionRef,
    createdBy: f.ownerId,
  });
  const fields = {
    projectId: f.projectId,
    productId: f.productId,
    factPath: "product.product_name",
    objective: "SYNTHETIC creation",
    targetAudience: "SYNTHETIC buyers",
    platform: "facebook" as const,
  };
  return { ...f, productLinkId, mediaId, fields };
}
