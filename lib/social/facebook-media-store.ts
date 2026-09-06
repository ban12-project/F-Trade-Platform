import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { type Database, getDatabase } from "@/lib/db/client";
import { facebookPublicationManifest } from "@/lib/db/facebook-runtime-schema";
import { productMediaAsset } from "@/lib/db/product-media-schema";
import {
  aggregateRecord,
  auditEvent,
  evidence,
  socialBrowserJob,
  socialPublication,
  videoGeneratedAsset,
  workspaceProjectItem,
} from "@/lib/db/schema";
import { videoProjectSchema } from "@/lib/video/contracts";
import { assertCurrentProductFactsForVideo } from "@/lib/video/product-fact-runtime-store";
import { assertWorkspaceProjectAccess } from "@/lib/workspace/access";
import { facebookMediaSubmitFormSchema } from "./facebook-account-forms";
import {
  FACEBOOK_MEDIA_LIMITS,
  type FacebookMediaPayload,
  parseFacebookMedia,
  parseFacebookMediaPayload,
} from "./facebook-media-contract";
import {
  configuredFacebookWorkerScope,
  facebookTextPayloadSchema,
} from "./facebook-worker-protocol";
import { assertPublicationEligible } from "./publication-store";
import {
  digestSocialWorkerPayload,
  type SignedSocialWorkerCommand,
  verifySocialWorkerCommand,
  verifySocialWorkerPayload,
} from "./worker-protocol";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type ReadDb = Pick<Database, "select">;
type Selection = {
  projectId: string;
  contentRef: string;
  format: "image" | "video";
  mediaId: string;
};

async function sourceFor(selection: Selection, database: ReadDb, now: Date) {
  const [record] = await database
    .select({ content: aggregateRecord })
    .from(aggregateRecord)
    .innerJoin(workspaceProjectItem, eq(workspaceProjectItem.aggregateId, aggregateRecord.id))
    .where(
      and(
        eq(aggregateRecord.id, selection.contentRef),
        eq(workspaceProjectItem.projectId, selection.projectId),
      ),
    );
  if (!record) throw new Error("media_content_missing");
  const content = record.content;
  if (selection.format === "video") {
    if (content.type !== "video" || content.state !== "VIDEO_APPROVED") {
      throw new Error("video_not_approved");
    }
    const video = videoProjectSchema.parse(content.payload);
    await assertCurrentProductFactsForVideo(video, database);
    if (selection.mediaId !== video.renderedAssetRef) throw new Error("video_not_approved");
    const [asset] = await database
      .select()
      .from(videoGeneratedAsset)
      .where(eq(videoGeneratedAsset.assetRef, selection.mediaId));
    if (
      asset?.contentType !== "video/mp4" ||
      asset.sizeBytes <= 0 ||
      asset.sizeBytes > FACEBOOK_MEDIA_LIMITS.video
    ) {
      throw new Error("video_asset_invalid");
    }
    return {
      blobKey: asset.blobPath,
      content,
      contentType: "video/mp4" as const,
      sizeBytes: asset.sizeBytes,
      assetRef: asset.assetRef,
      sha256: null as string | null,
      text: "",
    };
  }
  if (
    content.type !== "content" ||
    content.state !== "CONTENT_APPROVED" ||
    typeof content.payload.body !== "string"
  ) {
    throw new Error("image_content_not_approved");
  }
  const [asset] = await database
    .select({ asset: productMediaAsset, evidence })
    .from(productMediaAsset)
    .innerJoin(evidence, eq(evidence.id, productMediaAsset.evidenceId))
    .where(eq(productMediaAsset.id, selection.mediaId));
  const productId = content.payload.product_id;
  if (
    !asset ||
    asset.asset.productId !== productId ||
    asset.asset.mediaType !== "image" ||
    asset.asset.reviewStatus !== "approved" ||
    !asset.asset.reviewedBy ||
    !asset.asset.reviewedAt ||
    !asset.asset.reviewEvidenceRef ||
    !asset.asset.publicDistributionAllowed ||
    (asset.asset.rightsExpiresAt && asset.asset.rightsExpiresAt <= now)
  ) {
    throw new Error("image_rights_invalid");
  }
  const [product] = await database
    .select({ state: aggregateRecord.state })
    .from(aggregateRecord)
    .where(and(eq(aggregateRecord.id, asset.asset.productId), eq(aggregateRecord.type, "product")));
  if (
    product?.state !== "PRODUCT_READY" ||
    !["image/jpeg", "image/png"].includes(asset.evidence.contentType)
  ) {
    throw new Error("image_product_invalid");
  }
  return {
    blobKey: asset.evidence.blobKey,
    content,
    contentType: asset.evidence.contentType as "image/jpeg" | "image/png",
    sizeBytes: asset.evidence.sizeBytes,
    assetRef: asset.evidence.id,
    sha256: asset.evidence.sha256,
    text: content.payload.body,
  };
}

async function digestVideo(blobKey: string, sizeBytes: number) {
  const blob = await get(blobKey, {
    access: "private",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  if (!blob?.stream || blob.statusCode !== 200) throw new Error("private_video_unavailable");
  const reader = blob.stream.getReader();
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > sizeBytes || bytes > FACEBOOK_MEDIA_LIMITS.video) {
        throw new Error("video_size_mismatch");
      }
      hash.update(value);
    }
    if (bytes !== sizeBytes) throw new Error("video_size_mismatch");
    return hash.digest("hex");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function submitFacebookMediaPublication(
  input: unknown,
  actorId: string,
  database: Database = getDatabase(),
) {
  if (actorId !== process.env.SOCIAL_FACEBOOK_OWNER_USER_ID)
    throw new Error("facebook_account_owner_required");
  const value = facebookMediaSubmitFormSchema.parse(input);
  const scope = configuredFacebookWorkerScope();
  await assertWorkspaceProjectAccess(value.projectId, actorId, "write", database);
  const selected = await sourceFor(value, database, new Date());
  if (value.format === "video") {
    await assertCurrentProductFactsForVideo(
      videoProjectSchema.parse(selected.content.payload),
      database,
    );
  }
  const media = parseFacebookMedia({
    assetRef: selected.assetRef,
    contentType: selected.contentType,
    sizeBytes: selected.sizeBytes,
    sha256: selected.sha256 ?? (await digestVideo(selected.blobKey, selected.sizeBytes)),
  });
  return database.transaction(async (tx) => {
    await assertWorkspaceProjectAccess(value.projectId, actorId, "write", tx);
    await assertPublicationEligible(
      { ...value, channelRef: scope.channelRef, accountRef: scope.accountRef },
      tx,
      new Date(),
    );
    const current = await sourceFor(value, tx, new Date());
    if (
      current.content.version !== selected.content.version ||
      current.blobKey !== selected.blobKey ||
      current.assetRef !== media.assetRef ||
      current.contentType !== media.contentType ||
      current.sizeBytes !== media.sizeBytes ||
      (current.sha256 && current.sha256 !== media.sha256)
    ) {
      throw new Error("media_changed_during_confirmation");
    }
    const idempotencyKey = `facebook-media:${scope.accountRef}:${value.contentRef}:${selected.content.version}:${media.sha256}`;
    const [existing] = await tx
      .select({ id: socialBrowserJob.payloadRef })
      .from(socialBrowserJob)
      .where(eq(socialBrowserJob.idempotencyKey, idempotencyKey));
    if (existing) return { publicationId: existing.id };
    const publicationId = randomUUID();
    const jobId = randomUUID();
    await tx.insert(socialBrowserJob).values({
      id: jobId,
      channelRef: scope.channelRef,
      accountRef: scope.accountRef,
      kind: "publish",
      idempotencyKey,
      payloadRef: publicationId,
      status: "queued",
    });
    await tx.insert(socialPublication).values({
      id: publicationId,
      projectId: value.projectId,
      channelRef: scope.channelRef,
      accountRef: scope.accountRef,
      contentRef: value.contentRef,
      format: value.format,
      confirmationRef: `human-${randomUUID()}`,
      browserJobId: jobId,
      status: "submitted",
    });
    await tx.insert(facebookPublicationManifest).values({
      publicationId,
      contentVersion: current.content.version,
      format: value.format,
      caption: current.text,
      media,
      mediaId: value.mediaId,
      confirmedBy: actorId,
    });
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      actorType: "human",
      actorId,
      action: "facebook_media.confirmed",
      subjectType: "social_publication",
      subjectId: publicationId,
      metadata: { format: value.format, digest: media.sha256 },
      occurredAt: new Date(),
    });
    return { publicationId };
  });
}

export async function buildFacebookMediaPayload(
  tx: Tx,
  publication: typeof socialPublication.$inferSelect,
  now: Date,
): Promise<FacebookMediaPayload> {
  const [manifest] = await tx
    .select()
    .from(facebookPublicationManifest)
    .where(eq(facebookPublicationManifest.publicationId, publication.id));
  if (!manifest || !["image", "video"].includes(manifest.format)) {
    throw new Error("media_manifest_missing");
  }
  const source = await sourceFor(
    {
      ...publication,
      format: manifest.format as "image" | "video",
      mediaId: manifest.mediaId,
    },
    tx,
    now,
  );
  if (
    source.content.version !== manifest.contentVersion ||
    source.assetRef !== manifest.media.assetRef ||
    source.contentType !== manifest.media.contentType ||
    source.sizeBytes !== manifest.media.sizeBytes ||
    source.text !== manifest.caption ||
    (source.sha256 && source.sha256 !== manifest.media.sha256)
  ) {
    throw new Error("media_manifest_stale");
  }
  return parseFacebookMediaPayload({
    version: 2,
    channelRef: publication.channelRef,
    accountRef: publication.accountRef,
    publicationId: publication.id,
    format: manifest.format,
    text: manifest.caption,
    media: manifest.media,
  });
}

export async function readFacebookPublicationMedia(
  signed: SignedSocialWorkerCommand,
  payload: Record<string, unknown>,
  database: Database = getDatabase(),
  authorizeOnly = false,
) {
  const scope = configuredFacebookWorkerScope();
  const command = await verifySocialWorkerCommand(signed, scope.workerId, {
    claim: async () => true,
  });
  verifySocialWorkerPayload(command, payload);
  const mediaPayload = parseFacebookMediaPayload(payload);
  if (
    command.kind !== "publish" ||
    command.payloadRef !== mediaPayload.publicationId ||
    mediaPayload.accountRef !== scope.accountRef ||
    mediaPayload.channelRef !== scope.channelRef
  ) {
    throw new Error("media_scope_invalid");
  }
  const source = await database.transaction(async (tx) => {
    const [publication] = await tx
      .select()
      .from(socialPublication)
      .where(
        and(
          eq(socialPublication.id, command.payloadRef),
          eq(socialPublication.status, "submitted"),
          eq(socialPublication.browserJobId, command.jobId),
          eq(socialPublication.accountRef, scope.accountRef),
          eq(socialPublication.channelRef, scope.channelRef),
        ),
      );
    const [job] = await tx
      .select()
      .from(socialBrowserJob)
      .where(and(eq(socialBrowserJob.id, command.jobId), eq(socialBrowserJob.status, "claimed")));
    if (!publication || !job) throw new Error("media_job_not_claimed");
    await assertPublicationEligible(
      { ...publication, format: mediaPayload.format },
      tx,
      new Date(),
    );
    const expected = await buildFacebookMediaPayload(tx, publication, new Date());
    if (
      digestSocialWorkerPayload(expected as unknown as Record<string, unknown>) !==
      command.payloadDigest
    ) {
      throw new Error("media_payload_changed");
    }
    const [manifest] = await tx
      .select()
      .from(facebookPublicationManifest)
      .where(eq(facebookPublicationManifest.publicationId, publication.id));
    if (!manifest) throw new Error("media_manifest_missing");
    return sourceFor(
      {
        ...publication,
        format: mediaPayload.format,
        mediaId: manifest.mediaId,
      },
      tx,
      new Date(),
    );
  });
  if (authorizeOnly) return { stream: null, media: mediaPayload.media };
  const blob = await get(source.blobKey, {
    access: "private",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  if (!blob?.stream || blob.statusCode !== 200 || blob.blob.contentType !== source.contentType) {
    throw new Error("media_unavailable");
  }
  return { stream: blob.stream, media: mediaPayload.media };
}

export async function listFacebookMediaOptions(
  projectId: string,
  actorId: string,
  database: Database = getDatabase(),
) {
  await assertWorkspaceProjectAccess(projectId, actorId, "write", database);
  const records = await database
    .select({ record: aggregateRecord })
    .from(workspaceProjectItem)
    .innerJoin(aggregateRecord, eq(workspaceProjectItem.aggregateId, aggregateRecord.id))
    .where(eq(workspaceProjectItem.projectId, projectId));
  const result: Array<{
    contentRef: string;
    mediaId: string;
    format: "image" | "video";
    label: string;
  }> = [];
  for (const { record } of records) {
    if (record.type === "video" && record.state === "VIDEO_APPROVED") {
      const video = videoProjectSchema.parse(record.payload);
      if (video.renderedAssetRef) {
        result.push({
          contentRef: record.id,
          mediaId: video.renderedAssetRef,
          format: "video",
          label: `视频 · ${video.objective}`,
        });
      }
    } else if (
      record.type === "content" &&
      record.state === "CONTENT_APPROVED" &&
      typeof record.payload.product_id === "string"
    ) {
      const assets = await database
        .select({ id: productMediaAsset.id, description: productMediaAsset.description })
        .from(productMediaAsset)
        .where(
          and(
            eq(productMediaAsset.productId, record.payload.product_id),
            eq(productMediaAsset.mediaType, "image"),
            eq(productMediaAsset.reviewStatus, "approved"),
            eq(productMediaAsset.publicDistributionAllowed, true),
          ),
        );
      for (const asset of assets) {
        result.push({
          contentRef: record.id,
          mediaId: asset.id,
          format: "image",
          label: `图片 · ${String(record.payload.hook ?? "已审核文案")} · ${asset.description || asset.id.slice(0, 8)}`,
        });
      }
    }
  }
  return result;
}

export async function authorizeFacebookPublication(
  signed: SignedSocialWorkerCommand,
  payload: Record<string, unknown>,
  database: Database = getDatabase(),
) {
  if (payload.format !== "text") {
    await readFacebookPublicationMedia(signed, payload, database, true);
    return;
  }
  const scope = configuredFacebookWorkerScope();
  const command = await verifySocialWorkerCommand(signed, scope.workerId, {
    claim: async () => true,
  });
  const current = facebookTextPayloadSchema.parse(verifySocialWorkerPayload(command, payload));
  if (
    command.kind !== "publish" ||
    command.payloadRef !== current.publicationId ||
    current.accountRef !== scope.accountRef ||
    current.channelRef !== scope.channelRef
  ) {
    throw new Error("publication_scope_invalid");
  }
  await database.transaction(async (tx) => {
    const [publication] = await tx
      .select()
      .from(socialPublication)
      .where(
        and(
          eq(socialPublication.id, current.publicationId),
          eq(socialPublication.browserJobId, command.jobId),
          eq(socialPublication.accountRef, scope.accountRef),
          eq(socialPublication.channelRef, scope.channelRef),
          eq(socialPublication.status, "submitted"),
        ),
      );
    const [job] = await tx
      .select()
      .from(socialBrowserJob)
      .where(and(eq(socialBrowserJob.id, command.jobId), eq(socialBrowserJob.status, "claimed")));
    if (!publication || !job) throw new Error("publication_not_claimed");
    const { record } = await assertPublicationEligible(
      { ...publication, format: "text" },
      tx,
      new Date(),
    );
    if (record.type !== "content" || record.payload.body !== current.text) {
      throw new Error("publication_changed");
    }
  });
}
