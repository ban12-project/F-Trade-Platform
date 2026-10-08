import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Database } from "../../lib/db/client";
import {
  facebookAccountRuntime,
  facebookInteractiveSession,
  facebookPublicationManifest,
} from "../../lib/db/facebook-runtime-schema";
import { productMediaAsset } from "../../lib/db/product-media-schema";
import * as s from "../../lib/db/schema";
import { facebookMediaPreviewDigest } from "../../lib/social/facebook-media-confirmation";
import { digestSocialWorkerPayload } from "../../lib/social/worker-protocol";
import { videoProjectSchema } from "../../lib/video/contracts";
import { seedVideoReviewFixture } from "./video-review";

/** Authorization fixtures only: synthetic metadata/bytes do not prove rendering or business rights. */
export const syntheticPublicationBytes = Buffer.from("0000ftypisomSYNTHETIC-authorization-only");
export async function seedPublicationAccessFixture(
  db: Database,
  format: "text" | "image" | "video" = "text",
  reconcile = false,
) {
  const f = await seedVideoReviewFixture(db);
  const channelRef = `synthetic-${randomUUID()}`,
    accountRef = randomUUID(),
    contentId = format === "video" ? f.videoId : randomUUID(),
    gateId = format === "video" ? f.approvalId : randomUUID();
  const videoAssetRef = f.video.renderedAssetRef;
  if (!videoAssetRef) throw Error("Synthetic reviewed video asset required");
  const mediaId = format === "video" ? videoAssetRef : randomUUID();
  const body = "SYNTHETIC publication authorization; no factory claims";
  if (format === "video") {
    const video = videoProjectSchema.parse({
      ...f.video,
      status: "export_ready",
      approvalRefs: [gateId],
    });
    await db
      .update(s.aggregateRecord)
      .set({ state: "VIDEO_APPROVED", payload: video })
      .where(eq(s.aggregateRecord.id, contentId));
    await db
      .update(s.approval)
      .set({
        status: "approved",
        decidedByType: "human",
        decidedById: f.actorId,
        decidedAt: new Date(),
        evidenceRef: f.decisionRef,
      })
      .where(eq(s.approval.id, gateId));
    await db.insert(s.videoGeneratedAsset).values({
      assetRef: mediaId,
      blobPath: `synthetic/${mediaId}`,
      contentType: "video/mp4",
      sizeBytes: syntheticPublicationBytes.length,
      provider: "synthetic",
      modelId: "authorization-only",
    });
  } else {
    await db.insert(s.aggregateRecord).values({
      id: contentId,
      type: "content",
      state: "CONTENT_APPROVED",
      payload: {
        content_id: contentId,
        product_id: f.productId,
        content_type: "product",
        objective: "SYNTHETIC",
        target_customer: "SYNTHETIC",
        platform: "pending-channel-decision",
        product_facts: [],
        call_to_action: "",
        hashtags: [],
        visual_instruction: "",
        status: "approved",
        body,
        hook: "SYNTHETIC",
      },
      createdByType: "human",
      createdById: f.actorId,
    });
    await db.insert(s.workspaceProjectItem).values({
      id: randomUUID(),
      projectId: f.projectId,
      aggregateId: contentId,
      role: "marketing_content",
      relation: "owned",
    });
    await db.insert(s.approval).values({
      id: gateId,
      aggregateId: contentId,
      gate: "gate_01_truth",
      status: "approved",
      requestedByType: "human",
      requestedById: f.actorId,
      requestedAt: new Date(),
      decidedByType: "human",
      decidedById: f.actorId,
      decidedAt: new Date(),
      evidenceRef: f.decisionRef,
    });
    if (format === "image") {
      await db
        .update(s.evidence)
        .set({
          contentType: "image/png",
          sizeBytes: syntheticPublicationBytes.length,
          sha256: createHash("sha256").update(syntheticPublicationBytes).digest("hex"),
        })
        .where(eq(s.evidence.id, f.sourceRef));
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
        rightsEvidenceRef: f.sourceRef,
        publicDistributionAllowed: true,
        reviewStatus: "approved",
        reviewedBy: f.actorId,
        reviewedAt: new Date(),
        reviewEvidenceRef: f.decisionRef,
        createdBy: f.actorId,
      });
    }
  }
  await db.insert(s.socialChannelControl).values({
    id: randomUUID(),
    channelRef,
    accountRef,
    enabled: true,
    circuitStatus: reconcile ? "paused" : "active",
    pauseReason: reconcile ? "external_result_unknown" : null,
    changedBy: f.actorId,
    changedAt: new Date(),
  });
  const [content] = await db
    .select()
    .from(s.aggregateRecord)
    .where(eq(s.aggregateRecord.id, contentId));
  const identity = { actorId: f.actorId, sessionId: f.sessionId, projectId: f.projectId };
  const caption = format === "video" ? "" : body;
  const media = {
    assetRef: format === "video" ? mediaId : f.sourceRef,
    contentType: format === "video" ? ("video/mp4" as const) : ("image/png" as const),
    sizeBytes: syntheticPublicationBytes.length,
    sha256: createHash("sha256").update(syntheticPublicationBytes).digest("hex"),
  };
  const submission = {
    projectId: f.projectId,
    contentRef: contentId,
    format,
    channelRef,
    accountRef,
    confirmationRef: "evidence-synthetic-post-confirmation",
    previewDigest: digestSocialWorkerPayload({
      contentRef: contentId,
      version: content.version,
      format,
      payload: content.payload,
    }),
  };
  const mediaSubmission = {
    projectId: f.projectId,
    contentRef: contentId,
    format,
    mediaId,
    contentVersion: 1,
    previewDigest: facebookMediaPreviewDigest({
      contentRef: contentId,
      format: format === "video" ? "video" : "image",
      mediaId,
      contentVersion: 1,
      caption,
    }),
    channelRef,
    accountRef,
    confirm: true,
  };
  const publicationId = randomUUID(),
    jobId = randomUUID(),
    nodeId = randomUUID(),
    runId = randomUUID(),
    authorizationId = randomUUID();
  if (reconcile) {
    const payload =
      format === "text"
        ? { channelRef, accountRef, publicationId, format, text: body }
        : { version: 2, channelRef, accountRef, publicationId, format, text: caption, media };
    await db.insert(s.socialBrowserJob).values({
      id: jobId,
      channelRef,
      accountRef,
      kind: "publish",
      idempotencyKey: randomUUID(),
      payloadRef: publicationId,
      status: "paused",
      failureCode: "external_result_unknown",
    });
    await db.insert(s.socialPublication).values({
      id: publicationId,
      projectId: f.projectId,
      contentRef: contentId,
      format,
      channelRef,
      accountRef,
      confirmationRef: submission.confirmationRef,
      browserJobId: jobId,
      status: "unknown",
      textConfirmation:
        format === "text"
          ? {
              contentVersion: 1,
              approvalRef: gateId,
              payloadDigest: digestSocialWorkerPayload(payload),
            }
          : null,
    });
    if (format !== "text")
      await db.insert(facebookPublicationManifest).values({
        publicationId,
        contentVersion: 1,
        format,
        caption,
        media,
        mediaId,
        confirmedBy: f.actorId,
      });
    await db.execute(
      sql`INSERT INTO browser_fleet_node (id,owner_id,name,key_hash,document) VALUES (${nodeId},${f.actorId},'SYNTHETIC stopped node',${randomUUID()},${JSON.stringify({ version: 1, runs: [{ id: runId, jobRef: jobId, status: "failed" }] })}::jsonb)`,
    );
    await db.execute(
      sql`INSERT INTO browser_fleet_publication (job_id,node_id,run_id,payload,authorization_id,authorized_lease_id,authorized_until,receipt,received_at) VALUES (${jobId},${nodeId},${runId},${JSON.stringify(payload)}::jsonb,${authorizationId},${randomUUID()},${Date.now() - 1},${JSON.stringify({ outcome: "unknown", authorizationId, payloadDigest: digestSocialWorkerPayload(payload) })}::jsonb,now())`,
    );
  }
  const interactiveId = randomUUID();
  await db
    .insert(facebookAccountRuntime)
    .values({ accountRef, channelRef, authState: "ready", updatedBy: f.actorId });
  await db.insert(facebookInteractiveSession).values({
    id: interactiveId,
    workerId: "synthetic-worker",
    channelRef,
    accountRef,
    userId: f.actorId,
    authSessionId: f.sessionId,
    status: "closed",
    useSavedLogin: false,
    browserVerified: true,
    heartbeatAt: new Date(),
    connectBefore: new Date(Date.now() + 60000),
    expiresAt: new Date(Date.now() + 600000),
  });
  return {
    ...f,
    identity,
    channelRef,
    accountRef,
    contentId,
    gateId,
    mediaId,
    submission,
    mediaSubmission,
    publicationId,
    jobId,
    nodeId,
    interactiveId,
    reconciliation: {
      projectId: f.projectId,
      publicationId,
      externalPublicationRef:
        format === "video"
          ? "https://www.facebook.com/reel/1234567890123456/"
          : "https://www.facebook.com/synthetic/posts/synthetic-observation",
      evidenceRef: "evidence-synthetic-observation",
      confirmed: true,
    },
  };
}
