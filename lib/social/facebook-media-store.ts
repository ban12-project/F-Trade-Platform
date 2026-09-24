import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { get } from "@vercel/blob";
import { and, eq, sql } from "drizzle-orm";
import { type FleetState, publicationScopeActive } from "@/lib/browser-fleet/policy";
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
type ScopeDb = Pick<Database, "execute">;
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

/** Resolve the current, unique account binding. Legacy Worker scope is used
 * only while that Worker is explicitly enabled; fleet media jobs never borrow
 * its environment identifiers. */
export async function resolveFacebookMediaSubmissionScope(
  actorId: string,
  database: ScopeDb = getDatabase(),
  now = Date.now(),
) {
  if (process.env.SOCIAL_FACEBOOK_WORKER_ENABLED === "1") {
    const scope = configuredFacebookWorkerScope();
    return { channelRef: scope.channelRef, accountRef: scope.accountRef };
  }
  const result = await database.execute(sql`SELECT b.channel_ref, b.account_ref, n.document
    FROM browser_fleet_binding b
    JOIN browser_fleet_node n ON n.id = b.node_id
    JOIN social_channel_control c ON c.channel_ref = b.channel_ref AND c.account_ref = b.account_ref
    WHERE n.owner_id = ${actorId} AND n.status = 'active'
      AND c.enabled = true AND c.circuit_status = 'active'`);
  if (result.rows.length !== 1) throw new Error("facebook_media_scope_ambiguous");
  const row = result.rows[0];
  const state = row.document as FleetState;
  const accounts = Array.isArray(state?.accounts)
    ? state.accounts.filter(
        (account) =>
          account.channelRef === row.channel_ref && account.accountRef === row.account_ref,
      )
    : [];
  const account = accounts[0];
  if (
    accounts.length !== 1 ||
    !account.enabled ||
    account.authState !== "ready" ||
    !account.expectedEgressIp ||
    !state.capabilities?.includes("publish") ||
    !publicationScopeActive(state, account, now)
  )
    throw new Error("facebook_media_scope_inactive");
  return { channelRef: account.channelRef, accountRef: account.accountRef };
}

/** Reuse the original publication only when the broker can prove that no
 * publish authorization was ever issued. A new user confirmation is still
 * required through submitFacebookMediaPublication before this is called. */
export async function requeueUnsentFacebookMediaPublication(
  tx: Tx,
  jobId: string,
  publicationId: string,
  actorId: string,
) {
  const result = await tx.execute(sql`SELECT p.run_id, p.authorization_id, p.receipt,
    j.status AS job_status, j.failure_code, s.status AS publication_status,
    s.external_publication_ref, n.document
    FROM browser_fleet_publication p
    JOIN social_browser_job j ON j.id = p.job_id
    JOIN social_publication s ON s.id = j.payload_ref AND s.browser_job_id = j.id
    JOIN browser_fleet_node n ON n.id = p.node_id
    WHERE p.job_id = ${jobId} AND s.id = ${publicationId} AND n.owner_id = ${actorId}
    FOR UPDATE OF p, j, s`);
  const row = result.rows[0];
  const state = row?.document as FleetState | undefined;
  const run = state?.runs.find((item) => item.id === row.run_id);
  if (
    result.rows.length !== 1 ||
    row.job_status !== "paused" ||
    row.failure_code !== "fleet_publication_not_authorized" ||
    row.publication_status !== "failed" ||
    row.external_publication_ref !== null ||
    row.authorization_id !== null ||
    row.receipt !== null ||
    run?.status !== "failed" ||
    run.failure !== "publication_not_authorized" ||
    run.jobRef !== jobId
  )
    throw new Error("facebook_media_retry_not_proven_unsent");
  await tx.execute(sql`DELETE FROM browser_fleet_publication WHERE job_id = ${jobId}`);
  await tx
    .update(socialBrowserJob)
    .set({ status: "queued", failureCode: null, updatedAt: new Date() })
    .where(eq(socialBrowserJob.id, jobId));
  await tx
    .update(socialPublication)
    .set({ status: "submitted", updatedAt: new Date() })
    .where(eq(socialPublication.id, publicationId));
  await tx.insert(auditEvent).values({
    id: randomUUID(),
    actorType: "human",
    actorId,
    action: "facebook_media.preclick_requeued",
    subjectType: "social_publication",
    subjectId: publicationId,
    metadata: { reason: "no_publish_authorization" },
    occurredAt: new Date(),
  });
}

export async function submitFacebookMediaPublication(
  input: unknown,
  actorId: string,
  database: Database = getDatabase(),
) {
  if (actorId !== process.env.SOCIAL_FACEBOOK_OWNER_USER_ID)
    throw new Error("facebook_account_owner_required");
  const value = facebookMediaSubmitFormSchema.parse(input);
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
    const scope = await resolveFacebookMediaSubmissionScope(actorId, tx);
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
      .select({
        id: socialBrowserJob.payloadRef,
        jobId: socialBrowserJob.id,
        status: socialBrowserJob.status,
        failureCode: socialBrowserJob.failureCode,
      })
      .from(socialBrowserJob)
      .where(eq(socialBrowserJob.idempotencyKey, idempotencyKey))
      .for("update");
    if (existing) {
      if (
        existing.status === "paused" &&
        existing.failureCode !== "fleet_publication_not_authorized"
      )
        throw new Error("facebook_media_existing_attempt_requires_review");
      if (
        existing.status === "paused" &&
        existing.failureCode === "fleet_publication_not_authorized"
      ) {
        await requeueUnsentFacebookMediaPublication(tx, existing.jobId, existing.id, actorId);
      }
      return { publicationId: existing.id };
    }
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

/** One signed payload contract shared by job claiming and final authorization. */
export async function buildFacebookPublicationPayload(
  tx: Tx,
  publication: typeof socialPublication.$inferSelect,
  now: Date,
): Promise<Record<string, unknown>> {
  if (!["text", "image", "video"].includes(publication.format)) {
    throw new Error("publication_format_invalid");
  }
  const { record, gate } = await assertPublicationEligible(
    { ...publication, format: publication.format as "text" | "image" | "video" },
    tx,
    now,
  );
  if (publication.format !== "text") {
    return buildFacebookMediaPayload(tx, publication, now);
  }
  const [manifest] = await tx
    .select({ id: facebookPublicationManifest.publicationId })
    .from(facebookPublicationManifest)
    .where(eq(facebookPublicationManifest.publicationId, publication.id));
  if (manifest || record.type !== "content") throw new Error("publication_format_invalid");
  const payload = facebookTextPayloadSchema.parse({
    channelRef: publication.channelRef,
    accountRef: publication.accountRef,
    publicationId: publication.id,
    format: "text",
    text: record.payload.body,
  });
  const confirmation = publication.textConfirmation;
  if (
    !confirmation ||
    confirmation.contentVersion !== record.version ||
    confirmation.approvalRef !== gate.id ||
    confirmation.payloadDigest !== digestSocialWorkerPayload(payload)
  ) {
    throw new Error("text_confirmation_stale_or_missing");
  }
  return payload;
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
  if (
    !manifest ||
    !["image", "video"].includes(manifest.format) ||
    manifest.format !== publication.format
  ) {
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
      .where(
        and(
          eq(socialBrowserJob.id, command.jobId),
          eq(socialBrowserJob.status, "claimed"),
          sql`NOT EXISTS (SELECT 1 FROM browser_fleet_publication p WHERE p.job_id = ${socialBrowserJob.id})`,
          eq(socialBrowserJob.kind, "publish"),
          eq(socialBrowserJob.payloadRef, command.payloadRef),
          eq(socialBrowserJob.channelRef, scope.channelRef),
          eq(socialBrowserJob.accountRef, scope.accountRef),
        ),
      );
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
      .where(
        and(
          eq(socialBrowserJob.id, command.jobId),
          eq(socialBrowserJob.status, "claimed"),
          sql`NOT EXISTS (SELECT 1 FROM browser_fleet_publication p WHERE p.job_id = ${socialBrowserJob.id})`,
          eq(socialBrowserJob.kind, "publish"),
          eq(socialBrowserJob.payloadRef, command.payloadRef),
          eq(socialBrowserJob.channelRef, scope.channelRef),
          eq(socialBrowserJob.accountRef, scope.accountRef),
        ),
      );
    if (!publication || !job) throw new Error("publication_not_claimed");
    const expected = await buildFacebookPublicationPayload(tx, publication, new Date());
    if (digestSocialWorkerPayload(expected) !== command.payloadDigest) {
      throw new Error("publication_changed");
    }
  });
}

export type FacebookMediaSource = { blobKey: string; media: FacebookMediaPayload["media"] };
export async function resolveFacebookMediaSource(
  tx: Tx,
  publication: typeof socialPublication.$inferSelect,
  now: Date,
): Promise<FacebookMediaSource> {
  const payload = await buildFacebookPublicationPayload(tx, publication, now);
  const mediaPayload = parseFacebookMediaPayload(payload);
  const [manifest] = await tx
    .select()
    .from(facebookPublicationManifest)
    .where(eq(facebookPublicationManifest.publicationId, publication.id));
  if (!manifest) throw new Error("media_manifest_missing");
  const source = await sourceFor(
    { ...publication, format: mediaPayload.format, mediaId: manifest.mediaId },
    tx,
    now,
  );
  return { blobKey: source.blobKey, media: mediaPayload.media };
}
export async function openFacebookMediaSource(source: FacebookMediaSource) {
  const blob = await get(source.blobKey, {
    access: "private",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  if (
    !blob?.stream ||
    blob.statusCode !== 200 ||
    blob.blob.contentType !== source.media.contentType ||
    blob.blob.size !== source.media.sizeBytes
  ) {
    await blob?.stream?.cancel();
    throw new Error("media_unavailable");
  }
  return { stream: blob.stream, media: source.media };
}
