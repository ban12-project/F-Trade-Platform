import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { type Database, getDatabase } from "@/lib/db/client";
import {
  aggregateRecord,
  approval,
  auditEvent,
  videoJob,
  workflowEvent,
  workspaceProject,
  workspaceProjectItem,
  workspaceProjectMember,
} from "@/lib/db/schema";
import type { ProductReady } from "@/lib/product/verification";
import { assertTransition } from "@/lib/workflow/transitions";
import {
  assertAggregateWorkspaceWrite,
  assertWorkspaceProjectAccess,
} from "@/lib/workspace/access";
import { isPrivateTestOnlyVideo, type VideoProject, videoProjectSchema } from "./contracts";
import { buildVideoCreative } from "./creative";
import {
  authorizeLockedVideoDraft,
  authorizeOwnedVideoDraft,
  authorizeReadableVideoDraftSource,
  parseVideoDraftIdentity,
  VideoDraftAccessError,
  type VideoDraftIdentity,
} from "./draft-write-access";
import {
  createMarketingVideoDraftFormSchema,
  type MarketingVideoDraft,
  marketingVideoDraftSchema,
} from "./edit-contracts";
import {
  latestVideoProcessingJobs,
  queueLockedVideoProcessingJob,
  type VideoProcessingSummary,
} from "./processing-jobs";
import { assertLockedVideoProductContext } from "./product-context-guard";
import { assertVideoRetentionForId } from "./retention-access";
import { videoRetainedCondition } from "./retention-policy";
import type { UploadedVideoSourceAsset } from "./uploaded-assets";

export type ReadyVideoProductSource = {
  id: string;
  productName: string;
  internalSku: string;
  factOptions: Array<{ value: string; label: string }>;
};
export type VideoWorkspaceEntry = {
  id: string;
  state: string;
  createdAt: Date;
  productId: string;
  productName: string;
  objective: string;
  platforms: VideoProject["platforms"];
  approvalStatus: "pending" | "approved" | "rejected" | null;
  previewAssetRef: string | null;
};
export type MarketingVideoEditorEntry = VideoWorkspaceEntry & {
  draft: MarketingVideoDraft;
  targetAudience: string;
  captionFactOptions: Array<{ field: string; value: string }>;
  downloadAvailable: boolean;
  privateTestOnly: boolean;
  processingJob: VideoProcessingSummary | null;
};
export type MarketingVideoCopyCandidate = {
  id: string;
  projectTitle: string;
  productName: string;
  objective: string;
};

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}
function factOptions(product: ProductReady) {
  return (["product", "specifications", "commercial"] as const).flatMap((section) =>
    Object.entries(product[section] ?? {})
      .filter(([, value]) => hasValue(value))
      .flatMap(([field]) => {
        const path = `${section}.${field}`;
        return product.field_evidence[path] &&
          product.evidence_refs.includes(product.field_evidence[path]!)
          ? [{ value: path, label: path }]
          : [];
      }),
  );
}

export async function listReadyVideoProductSources(
  projectId?: string,
  productId?: string,
): Promise<ReadyVideoProductSource[]> {
  const rows = projectId
    ? (
        await getDatabase()
          .select({ record: aggregateRecord })
          .from(workspaceProjectItem)
          .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
          .where(
            and(
              eq(workspaceProjectItem.projectId, projectId),
              eq(aggregateRecord.type, "product"),
              eq(aggregateRecord.state, "PRODUCT_READY"),
              productId ? eq(aggregateRecord.id, productId) : undefined,
            ),
          )
          .orderBy(desc(workspaceProjectItem.createdAt))
      ).map((row) => row.record)
    : await getDatabase()
        .select()
        .from(aggregateRecord)
        .where(and(eq(aggregateRecord.type, "product"), eq(aggregateRecord.state, "PRODUCT_READY")))
        .orderBy(desc(aggregateRecord.createdAt));
  return rows.flatMap((row) => {
    const product = row.payload as unknown as ProductReady;
    if (
      product.record_id !== row.id ||
      product.verification_status !== "verified" ||
      typeof product.product?.product_name !== "string" ||
      typeof product.product?.internal_sku !== "string"
    )
      return [];
    const options = factOptions(product);
    return options.length
      ? [
          {
            id: row.id,
            productName: product.product.product_name,
            internalSku: product.product.internal_sku,
            factOptions: options,
          },
        ]
      : [];
  });
}

export async function createMarketingVideoEditProject(
  input: unknown,
  identityInput: VideoDraftIdentity,
  uploadedAssets: UploadedVideoSourceAsset[],
  database: Database = getDatabase(),
) {
  const value = createMarketingVideoDraftFormSchema.parse(input);
  const identity = parseVideoDraftIdentity(identityInput);
  if (identity.projectId !== value.projectId) throw new VideoDraftAccessError();
  const actorId = identity.actorId;
  if (!uploadedAssets.length) throw new Error("请上传至少一个营销素材。");
  if (uploadedAssets.length > 3) throw new Error("MVP1 每条视频最多使用三个素材。");
  const id = randomUUID();
  return database.transaction(async (tx) => {
    await assertWorkspaceProjectAccess(value.projectId, actorId, "write", tx);
    const [workspace] = await tx
      .select({ id: workspaceProject.id, kind: workspaceProject.kind })
      .from(workspaceProject)
      .where(eq(workspaceProject.id, value.projectId))
      .for("update");
    if (workspace?.kind !== "marketing") throw new Error("只能在产品营销项目中创建营销视频。");
    const [productLink] = await tx
      .select({ id: workspaceProjectItem.id })
      .from(workspaceProjectItem)
      .where(
        and(
          eq(workspaceProjectItem.projectId, value.projectId),
          eq(workspaceProjectItem.aggregateId, value.productId),
        ),
      )
      .for("share");
    if (!productLink) throw new Error("只能使用当前营销项目中已关联的产品。");
    const [product] = await tx
      .select({
        id: aggregateRecord.id,
        state: aggregateRecord.state,
        payload: aggregateRecord.payload,
      })
      .from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, value.productId), eq(aggregateRecord.type, "product")))
      .for("update");
    if (product?.state !== "PRODUCT_READY")
      throw new Error("只能从已通过 Gate 01 的产品创建营销视频。");
    const ready = product.payload as unknown as ProductReady;
    if (ready.record_id !== product.id || ready.verification_status !== "verified")
      throw new Error("产品就绪记录不完整，无法创建视频项目。");
    const expiresAt = await authorizeLockedVideoDraft(tx, identity);
    const now = new Date();
    if (expiresAt <= now) throw new VideoDraftAccessError();
    const selectedFacts = ["product.product_name", value.factPath].filter(
      (path, index, paths) => paths.indexOf(path) === index && Boolean(ready.field_evidence[path]),
    );
    const clips = uploadedAssets.map((asset, index) => ({
      clipId: `clip-${String(index + 1).padStart(3, "0")}`,
      assetRef: asset.assetRef,
      mediaType: asset.mediaType as "image" | "video",
      trimStartMs: 0,
      durationMs: asset.mediaType === "image" ? 3_000 : 5_000,
      fitMode: "contain" as const,
      audioMode: "muted" as const,
      caption: { kind: "none" as const },
    }));
    const editDraft = marketingVideoDraftSchema.parse({
      version: 2,
      platform: value.platform,
      clips,
      ctaText: "Contact us for details",
    });
    const creative = buildVideoCreative(
      {
        productId: product.id,
        objective: value.objective,
        targetAudience: value.targetAudience,
        factPaths: selectedFacts,
        sourceAssets: uploadedAssets,
        platforms: [value.platform],
        scenes: clips.map((clip) => ({
          prompt: "用户上传的授权营销素材",
          durationSeconds: clip.durationMs / 1_000,
          claimRefs: [],
          assetRefs: [clip.assetRef],
        })),
      },
      ready,
      id,
    );
    const project = videoProjectSchema.parse({ ...creative, status: "draft", editDraft });
    await tx.insert(aggregateRecord).values({
      id,
      type: "video",
      state: "VIDEO_DRAFT",
      payload: project,
      createdByType: "human",
      createdById: actorId,
    });
    await tx.insert(workspaceProjectItem).values({
      id: randomUUID(),
      projectId: value.projectId,
      aggregateId: id,
      role: "marketing_video",
      relation: "owned",
    });
    await tx
      .update(workspaceProject)
      .set({ updatedAt: now })
      .where(eq(workspaceProject.id, value.projectId));
    const processingJob = await queueLockedVideoProcessingJob(tx, id, "ai_draft", identity);
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "marketing_video_edit.created",
      actorType: "human",
      actorId,
      aggregateId: id,
      subjectType: "video",
      subjectId: id,
      metadata: {
        project_id: value.projectId,
        platform: value.platform,
        clip_count: clips.length,
      },
      occurredAt: now,
    });
    return { id, project, processingJob: processingJob.job };
  });
}

export async function listProjectMarketingVideoEntries(
  projectId: string,
  database: Database = getDatabase(),
  id?: string,
): Promise<MarketingVideoEditorEntry[]> {
  const rows = await database
    .select({ record: aggregateRecord, createdAt: workspaceProjectItem.createdAt })
    .from(workspaceProjectItem)
    .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
    .where(
      and(
        eq(workspaceProjectItem.projectId, projectId),
        eq(workspaceProjectItem.role, "marketing_video"),
        eq(workspaceProjectItem.relation, "owned"),
        eq(aggregateRecord.type, "video"),
        id ? eq(aggregateRecord.id, id) : undefined,
        videoRetainedCondition(aggregateRecord.createdAt),
      ),
    )
    .orderBy(desc(workspaceProjectItem.createdAt));
  if (!rows.length) return [];
  const approvals = await database
    .select({ aggregateId: approval.aggregateId, status: approval.status })
    .from(approval)
    .where(
      and(
        eq(approval.gate, "gate_01_truth"),
        inArray(
          approval.aggregateId,
          rows.map(({ record }) => record.id),
        ),
      ),
    )
    .orderBy(desc(approval.requestedAt));
  const approvalByVideo = new Map<string, "pending" | "approved" | "rejected">();
  for (const item of approvals)
    if (!approvalByVideo.has(item.aggregateId)) approvalByVideo.set(item.aggregateId, item.status);
  const jobsByVideo = await latestVideoProcessingJobs(
    rows.map(({ record }) => record.id),
    database,
  );
  return rows.flatMap(({ record, createdAt }) => {
    const project = videoProjectSchema.safeParse(record.payload);
    if (!project.success || !project.data.editDraft) return [];
    const productName =
      project.data.factualClaims.find((claim) => claim.field === "product.product_name")?.value ??
      "已核验产品";
    const privateTestOnly = isPrivateTestOnlyVideo(project.data);
    return [
      {
        id: record.id,
        state: record.state,
        createdAt,
        productId: project.data.productId,
        productName,
        objective: project.data.objective,
        targetAudience: project.data.targetAudience,
        platforms: project.data.platforms,
        approvalStatus: approvalByVideo.get(record.id) ?? null,
        previewAssetRef: project.data.renderedAssetRef ?? null,
        draft: project.data.editDraft,
        captionFactOptions: project.data.factualClaims.map(({ field, value }) => ({
          field,
          value,
        })),
        downloadAvailable:
          record.state === "VIDEO_APPROVED" &&
          project.data.exportArtifact?.status === "approved" &&
          !privateTestOnly,
        privateTestOnly,
        processingJob: jobsByVideo.get(record.id) ?? null,
      },
    ];
  });
}

export async function listCrossProjectMarketingVideoCandidates(
  projectId: string,
  actorId: string,
  database: Database = getDatabase(),
): Promise<MarketingVideoCopyCandidate[]> {
  const rows = await database
    .select({
      id: aggregateRecord.id,
      payload: aggregateRecord.payload,
      projectTitle: workspaceProject.title,
    })
    .from(workspaceProjectItem)
    .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
    .innerJoin(workspaceProject, eq(workspaceProject.id, workspaceProjectItem.projectId))
    .innerJoin(
      workspaceProjectMember,
      and(
        eq(workspaceProjectMember.projectId, workspaceProject.id),
        eq(workspaceProjectMember.userId, actorId),
      ),
    )
    .where(
      and(
        ne(workspaceProjectItem.projectId, projectId),
        eq(workspaceProjectItem.role, "marketing_video"),
        eq(workspaceProjectItem.relation, "owned"),
        eq(aggregateRecord.type, "video"),
        videoRetainedCondition(aggregateRecord.createdAt),
      ),
    )
    .orderBy(desc(workspaceProjectItem.createdAt));
  return rows.flatMap((row) => {
    const parsed = videoProjectSchema.safeParse(row.payload);
    if (!parsed.success || !parsed.data.editDraft) return [];
    return [
      {
        id: row.id,
        projectTitle: row.projectTitle,
        productName:
          parsed.data.factualClaims.find((claim) => claim.field === "product.product_name")
            ?.value ?? "已核验产品",
        objective: parsed.data.objective,
      },
    ];
  });
}

export async function copyMarketingVideoDraftToProject(
  sourceVideoId: string,
  identityInput: VideoDraftIdentity,
  database: Database = getDatabase(),
) {
  z.uuid().parse(sourceVideoId);
  const identity = parseVideoDraftIdentity(identityInput);
  const { actorId, projectId } = identity;
  const id = randomUUID();
  return database.transaction(async (tx) => {
    await assertWorkspaceProjectAccess(projectId, actorId, "write", tx);
    const [workspace] = await tx
      .select({ kind: workspaceProject.kind })
      .from(workspaceProject)
      .where(eq(workspaceProject.id, projectId))
      .for("update");
    if (workspace?.kind !== "marketing") throw new Error("视频只能复制到产品营销项目。");
    const [source] = await tx
      .select({ payload: aggregateRecord.payload, ownerProjectId: workspaceProjectItem.projectId })
      .from(aggregateRecord)
      .innerJoin(
        workspaceProjectItem,
        and(
          eq(workspaceProjectItem.aggregateId, aggregateRecord.id),
          eq(workspaceProjectItem.role, "marketing_video"),
          eq(workspaceProjectItem.relation, "owned"),
        ),
      )
      .where(and(eq(aggregateRecord.id, sourceVideoId), eq(aggregateRecord.type, "video")))
      .for("update");
    if (!source || source.ownerProjectId === projectId)
      throw new Error(source ? "该视频已经属于当前项目。" : "源视频不存在或没有明确归属。");
    await assertWorkspaceProjectAccess(source.ownerProjectId, actorId, "view", tx);
    const current = videoProjectSchema.parse(source.payload);
    if (!current.editDraft) throw new Error("只能复制 MVP1 营销剪辑项目。");
    const [product] = await tx
      .select({ state: aggregateRecord.state })
      .from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, current.productId), eq(aggregateRecord.type, "product")))
      .for("update");
    if (product?.state !== "PRODUCT_READY") throw new Error("源视频引用的产品已不再可用于新草稿。");
    await authorizeReadableVideoDraftSource(tx, identity, source.ownerProjectId);
    const expiresAt = await authorizeLockedVideoDraft(tx, identity);
    await tx
      .insert(workspaceProjectItem)
      .values({
        id: randomUUID(),
        projectId,
        aggregateId: current.productId,
        role: "product_reference",
        relation: "reference",
      })
      .onConflictDoNothing();
    const now = new Date();
    if (expiresAt <= now) throw new VideoDraftAccessError();
    await assertVideoRetentionForId(tx, sourceVideoId);
    const project = videoProjectSchema.parse({
      ...current,
      id,
      status: "draft",
      approvalRefs: [],
      renderedAssetRef: undefined,
      exportArtifact: undefined,
    });
    await tx.insert(aggregateRecord).values({
      id,
      type: "video",
      state: "VIDEO_DRAFT",
      payload: project,
      createdByType: "human",
      createdById: actorId,
    });
    await tx.insert(workspaceProjectItem).values({
      id: randomUUID(),
      projectId,
      aggregateId: id,
      role: "marketing_video",
      relation: "owned",
    });
    await tx
      .update(workspaceProject)
      .set({ updatedAt: now })
      .where(eq(workspaceProject.id, projectId));
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "marketing_video_edit.copied_to_project",
      actorType: "human",
      actorId,
      aggregateId: id,
      subjectType: "video",
      subjectId: id,
      metadata: { copied_from: sourceVideoId, project_id: projectId },
      occurredAt: now,
    });
    return { id, project };
  });
}

export async function getMarketingVideoEditProject(
  videoId: string,
  database: Database = getDatabase(),
) {
  const [record] = await database
    .select({
      state: aggregateRecord.state,
      payload: aggregateRecord.payload,
      version: aggregateRecord.version,
    })
    .from(aggregateRecord)
    .where(and(eq(aggregateRecord.id, videoId), eq(aggregateRecord.type, "video")));
  if (!record) throw new Error("营销视频不存在。");
  await assertVideoRetentionForId(database, videoId);
  const project = videoProjectSchema.parse(record.payload);
  if (!project.editDraft) throw new Error("该视频不是 MVP1 剪辑项目。");
  return { state: record.state, project, version: record.version };
}

export async function assertMarketingVideoProjectLink(
  projectId: string,
  videoId: string,
  actorId: string,
  database: Database = getDatabase(),
) {
  await assertWorkspaceProjectAccess(projectId, actorId, "write", database);
  const [link] = await database
    .select({ id: workspaceProjectItem.id })
    .from(workspaceProjectItem)
    .where(
      and(
        eq(workspaceProjectItem.projectId, projectId),
        eq(workspaceProjectItem.aggregateId, videoId),
        eq(workspaceProjectItem.role, "marketing_video"),
        eq(workspaceProjectItem.relation, "owned"),
      ),
    );
  if (!link) throw new Error("该营销视频不属于当前项目。");
}

export async function updateMarketingVideoEditDraft(
  videoId: string,
  draftInput: unknown,
  identityInput: VideoDraftIdentity,
  database: Database = getDatabase(),
) {
  z.uuid().parse(videoId);
  const identity = parseVideoDraftIdentity(identityInput);
  return (
    await saveMarketingVideoEditDraft(videoId, draftInput, { kind: "human", identity }, database)
  ).project;
}

export class MarketingVideoDraftChangedError extends Error {
  constructor() {
    super("剪辑草稿版本已更新。");
    this.name = "MarketingVideoDraftChangedError";
  }
}

export class MarketingVideoSourceInvalidError extends Error {
  constructor() {
    super("无法确认当前产品事实与素材授权。");
    this.name = "MarketingVideoSourceInvalidError";
  }
}

/** AI output may only replace the exact draft snapshot used for generation. */
export async function applyMarketingVideoAiDraft(
  videoId: string,
  draftInput: unknown,
  actorId: string,
  expectedVersion: number,
  database: Database = getDatabase(),
) {
  const version = z.number().int().positive().parse(expectedVersion);
  return (
    await saveMarketingVideoEditDraft(
      videoId,
      draftInput,
      { kind: "ai", actorId, expectedVersion: version },
      database,
    )
  ).project;
}

/** Save and queue are one command: denied queue submission rolls back the edit. */
export async function saveMarketingVideoRenderRequest(
  videoId: string,
  draftInput: unknown,
  identityInput: VideoDraftIdentity,
  database: Database = getDatabase(),
) {
  z.uuid().parse(videoId);
  const identity = parseVideoDraftIdentity(identityInput);
  const result = await saveMarketingVideoEditDraft(
    videoId,
    draftInput,
    { kind: "human", identity, processingKind: "render" },
    database,
  );
  if (!result.processingJob) throw new Error("无法创建视频处理任务。");
  return result.processingJob;
}

type DraftWriter =
  | { kind: "human"; identity: VideoDraftIdentity; processingKind?: "render" }
  | { kind: "ai"; actorId: string; expectedVersion: number };
async function saveMarketingVideoEditDraft(
  videoId: string,
  draftInput: unknown,
  writer: DraftWriter,
  database: Database,
) {
  const draft = marketingVideoDraftSchema.parse(draftInput);
  const actorId = writer.kind === "human" ? writer.identity.actorId : writer.actorId;
  const expectedVersion = writer.kind === "ai" ? writer.expectedVersion : undefined;
  return database.transaction(async (tx) => {
    await assertAggregateWorkspaceWrite(videoId, tx, actorId);
    const [record] = await tx
      .select()
      .from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, videoId), eq(aggregateRecord.type, "video")))
      .for("update");
    if (!record || !["VIDEO_DRAFT", "VIDEO_REVISION_REQUIRED"].includes(record.state))
      throw new Error("当前视频状态不能修改剪辑稿。");
    if (expectedVersion !== undefined && record.version !== expectedVersion)
      throw new MarketingVideoDraftChangedError();
    const current = videoProjectSchema.parse(record.payload);
    if (expectedVersion !== undefined) {
      try {
        await assertLockedVideoProductContext(tx, current);
      } catch {
        throw new MarketingVideoSourceInvalidError();
      }
    }
    const assetRefs = new Set(current.sourceAssets.map((asset) => asset.assetRef));
    const claimRefs = new Set(current.factualClaims.map((claim) => claim.field));
    for (const clip of draft.clips) {
      if (!assetRefs.has(clip.assetRef)) throw new Error("剪辑稿引用了不属于当前视频的素材。");
      if (clip.caption.kind === "verified_fact" && !claimRefs.has(clip.caption.claimRef))
        throw new Error("剪辑稿引用了未经核验的产品事实。");
    }
    const expiresAt =
      writer.kind === "human"
        ? await authorizeOwnedVideoDraft(tx, writer.identity, videoId)
        : undefined;
    const project = videoProjectSchema.parse({
      ...current,
      status: record.state === "VIDEO_REVISION_REQUIRED" ? "revision_required" : "draft",
      editDraft: draft,
      renderedAssetRef: undefined,
      exportArtifact: undefined,
    });
    const now = new Date();
    if (expiresAt && expiresAt <= now) throw new VideoDraftAccessError();
    await assertVideoRetentionForId(tx, videoId);
    await tx
      .update(aggregateRecord)
      .set({ payload: project, version: sql`${aggregateRecord.version} + 1` })
      .where(eq(aggregateRecord.id, videoId));
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "marketing_video_edit.saved",
      actorType: "human",
      actorId,
      aggregateId: videoId,
      subjectType: "video",
      subjectId: videoId,
      metadata: {
        duration_ms: draft.clips.reduce((sum, clip) => sum + clip.durationMs, 0),
        clip_count: draft.clips.length,
        ...(expectedVersion === undefined ? {} : { generated_from_version: expectedVersion }),
      },
      occurredAt: now,
    });
    const processingJob =
      writer.kind === "human" && writer.processingKind
        ? (await queueLockedVideoProcessingJob(tx, videoId, writer.processingKind, writer.identity))
            .job
        : undefined;
    return { project, processingJob };
  });
}

export async function beginMarketingVideoRender(
  videoId: string,
  actorId: string,
  database: Database = getDatabase(),
) {
  const now = new Date();
  const eventId = randomUUID();
  return database.transaction(async (tx) => {
    await assertAggregateWorkspaceWrite(videoId, tx, actorId);
    const [record] = await tx
      .select()
      .from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, videoId), eq(aggregateRecord.type, "video")))
      .for("update");
    if (!record || !["VIDEO_DRAFT", "VIDEO_REVISION_REQUIRED"].includes(record.state))
      throw new Error("当前视频状态不能开始合成。");
    await assertVideoRetentionForId(tx, videoId);
    const project = videoProjectSchema.parse(record.payload);
    if (!project.editDraft) throw new Error("视频缺少可合成的剪辑稿。");
    const evidenceRefs = [
      ...new Set([
        ...project.factualClaims.map((claim) => claim.evidenceRef),
        ...project.sourceAssets.map((asset) => asset.rightsEvidenceRef),
      ]),
    ];
    assertTransition({
      eventId,
      entityType: "video",
      entityId: videoId,
      fromState: record.state,
      toState: "VIDEO_RENDERING",
      actorType: "human",
      actorId,
      occurredAt: now.toISOString(),
      evidenceRefs,
    });
    const renderingProject = videoProjectSchema.parse({
      ...project,
      status: "rendering",
      renderedAssetRef: undefined,
      exportArtifact: undefined,
    });
    await tx
      .update(aggregateRecord)
      .set({
        state: "VIDEO_RENDERING",
        payload: renderingProject,
        version: sql`${aggregateRecord.version} + 1`,
      })
      .where(eq(aggregateRecord.id, videoId));
    await tx.insert(workflowEvent).values({
      id: eventId,
      aggregateId: videoId,
      fromState: record.state,
      toState: "VIDEO_RENDERING",
      actorType: "human",
      actorId,
      evidenceRefs,
      occurredAt: now,
    });
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "marketing_video_render.started",
      actorType: "human",
      actorId,
      aggregateId: videoId,
      subjectType: "video",
      subjectId: videoId,
      metadata: {
        duration_ms: project.editDraft.clips.reduce((sum, clip) => sum + clip.durationMs, 0),
      },
      occurredAt: now,
    });
    return renderingProject;
  });
}

export async function completeMarketingVideoRender(
  videoId: string,
  assetRef: string,
  database: Database = getDatabase(),
) {
  const now = new Date();
  const eventId = randomUUID();
  const approvalId = randomUUID();
  const actorId = "ffmpeg:mvp1-editor";
  return database.transaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, videoId), eq(aggregateRecord.type, "video")))
      .for("update");
    if (record?.state !== "VIDEO_RENDERING")
      throw new Error("视频合成状态已发生变化，请刷新后重试。");
    await assertVideoRetentionForId(tx, videoId);
    const project = videoProjectSchema.parse(record.payload);
    const evidenceRefs = [
      ...new Set([
        ...project.factualClaims.map((claim) => claim.evidenceRef),
        ...project.sourceAssets.map((asset) => asset.rightsEvidenceRef),
        assetRef,
      ]),
    ];
    assertTransition({
      eventId,
      entityType: "video",
      entityId: videoId,
      fromState: "VIDEO_RENDERING",
      toState: "VIDEO_REVIEW_REQUIRED",
      actorType: "system",
      actorId,
      occurredAt: now.toISOString(),
      evidenceRefs,
    });
    const reviewProject = videoProjectSchema.parse({
      ...project,
      status: "review_required",
      renderedAssetRef: assetRef,
    });
    await tx.insert(approval).values({
      id: approvalId,
      aggregateId: videoId,
      gate: "gate_01_truth",
      status: "pending",
      requestedByType: "system",
      requestedById: actorId,
      requestedAt: now,
    });
    await tx
      .update(aggregateRecord)
      .set({
        state: "VIDEO_REVIEW_REQUIRED",
        payload: reviewProject,
        version: sql`${aggregateRecord.version} + 1`,
      })
      .where(eq(aggregateRecord.id, videoId));
    await tx.insert(workflowEvent).values({
      id: eventId,
      aggregateId: videoId,
      fromState: "VIDEO_RENDERING",
      toState: "VIDEO_REVIEW_REQUIRED",
      actorType: "system",
      actorId,
      evidenceRefs,
      occurredAt: now,
    });
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "marketing_video_render.completed",
      actorType: "system",
      actorId,
      aggregateId: videoId,
      subjectType: "video",
      subjectId: videoId,
      metadata: { asset_ref: assetRef, approval_id: approvalId },
      occurredAt: now,
    });
    return { project: reviewProject, approvalId };
  });
}

export async function failMarketingVideoRender(
  videoId: string,
  _reason: string,
  database: Database = getDatabase(),
) {
  const now = new Date();
  const eventId = randomUUID();
  const actorId = "ffmpeg:mvp1-editor";
  return database.transaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, videoId), eq(aggregateRecord.type, "video")))
      .for("update");
    if (record?.state !== "VIDEO_RENDERING") return;
    await assertVideoRetentionForId(tx, videoId);
    const project = videoProjectSchema.parse(record.payload);
    const evidenceRefs = [...new Set(project.sourceAssets.map((asset) => asset.rightsEvidenceRef))];
    assertTransition({
      eventId,
      entityType: "video",
      entityId: videoId,
      fromState: "VIDEO_RENDERING",
      toState: "VIDEO_REVISION_REQUIRED",
      actorType: "system",
      actorId,
      occurredAt: now.toISOString(),
      evidenceRefs,
    });
    const revisionProject = videoProjectSchema.parse({ ...project, status: "revision_required" });
    await tx
      .update(aggregateRecord)
      .set({
        state: "VIDEO_REVISION_REQUIRED",
        payload: revisionProject,
        version: sql`${aggregateRecord.version} + 1`,
      })
      .where(eq(aggregateRecord.id, videoId));
    await tx.insert(workflowEvent).values({
      id: eventId,
      aggregateId: videoId,
      fromState: "VIDEO_RENDERING",
      toState: "VIDEO_REVISION_REQUIRED",
      actorType: "system",
      actorId,
      evidenceRefs,
      occurredAt: now,
    });
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "marketing_video_render.failed",
      actorType: "system",
      actorId,
      aggregateId: videoId,
      subjectType: "video",
      subjectId: videoId,
      metadata: { failure_code: "RENDER_FAILED" },
      occurredAt: now,
    });
  });
}

export async function listVideoWorkspaceEntries(limit = 50): Promise<VideoWorkspaceEntry[]> {
  const rows = await getDatabase()
    .select()
    .from(aggregateRecord)
    .where(
      and(eq(aggregateRecord.type, "video"), videoRetainedCondition(aggregateRecord.createdAt)),
    )
    .orderBy(desc(aggregateRecord.createdAt))
    .limit(limit);
  if (!rows.length) return [];
  const [approvals, completedJobs] = await Promise.all([
    getDatabase()
      .select({ aggregateId: approval.aggregateId, status: approval.status })
      .from(approval)
      .where(
        and(
          eq(approval.gate, "gate_01_truth"),
          inArray(
            approval.aggregateId,
            rows.map((row) => row.id),
          ),
        ),
      )
      .orderBy(desc(approval.requestedAt)),
    getDatabase()
      .select({ videoProjectId: videoJob.videoProjectId, resultAssetRef: videoJob.resultAssetRef })
      .from(videoJob)
      .where(
        and(
          inArray(
            videoJob.videoProjectId,
            rows.map((row) => row.id),
          ),
          eq(videoJob.status, "succeeded"),
        ),
      )
      .orderBy(desc(videoJob.updatedAt)),
  ]);
  const statusByProject = new Map<string, "pending" | "approved" | "rejected">();
  for (const item of approvals)
    if (!statusByProject.has(item.aggregateId)) statusByProject.set(item.aggregateId, item.status);
  const previewAssetByProject = new Map<string, string>();
  for (const job of completedJobs)
    if (job.resultAssetRef && !previewAssetByProject.has(job.videoProjectId))
      previewAssetByProject.set(job.videoProjectId, job.resultAssetRef);
  return rows.flatMap((row) => {
    const project = row.payload as Partial<VideoProject>;
    const productName =
      project.factualClaims?.find((claim) => claim.field === "product.product_name")?.value ??
      "已核验产品";
    if (!project.productId || !project.objective || !project.platforms) return [];
    return [
      {
        id: row.id,
        state: row.state,
        createdAt: row.createdAt,
        productId: project.productId,
        productName,
        objective: project.objective,
        platforms: project.platforms,
        approvalStatus: statusByProject.get(row.id) ?? null,
        previewAssetRef: previewAssetByProject.get(row.id) ?? null,
      },
    ];
  });
}
