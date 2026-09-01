import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { getDatabase, type Database } from "@/lib/db/client";
import { aggregateRecord, approval, auditEvent, videoJob, workflowEvent, workspaceProject, workspaceProjectItem } from "@/lib/db/schema";
import { videoProjectSchema, type VideoProject } from "./contracts";
import { buildVideoCreative } from "./creative";
import type { ProductReady } from "@/lib/product/verification";
import { assertTransition } from "@/lib/workflow/transitions";
import type { videoProjectDraftFormSchema, videoReviewFormSchema } from "@/lib/form-schemas";
import type { z } from "zod";
import { type VideoCanvasDocument } from "./canvas-contracts";
import { createMarketingVideoDraftFormSchema, marketingVideoDraftSchema, type MarketingVideoDraft } from "./edit-contracts";
import type { UploadedVideoSourceAsset } from "./uploaded-assets";

export type VideoProjectDraftInput = z.infer<typeof videoProjectDraftFormSchema>;
export type VideoReviewInput = z.infer<typeof videoReviewFormSchema>;
export type ReadyVideoProductSource = { id: string; productName: string; internalSku: string; factOptions: Array<{ value: string; label: string }> };
export type VideoWorkspaceEntry = { id: string; state: string; createdAt: Date; productId: string; productName: string; objective: string; platforms: VideoProject["platforms"]; approvalStatus: "pending" | "approved" | "rejected" | null; previewAssetRef: string | null };
export type MarketingVideoEditorEntry = VideoWorkspaceEntry & { draft: MarketingVideoDraft; targetAudience: string };

function hasValue(value: unknown) { return value !== undefined && value !== null && value !== ""; }
function factOptions(product: ProductReady) {
  return (["product", "specifications", "commercial"] as const).flatMap((section) => Object.entries(product[section] ?? {})
    .filter(([, value]) => hasValue(value))
    .flatMap(([field]) => {
      const path = `${section}.${field}`;
      return product.field_evidence[path] && product.evidence_refs.includes(product.field_evidence[path]!) ? [{ value: path, label: path }] : [];
    }));
}

export async function listReadyVideoProductSources(projectId?: string): Promise<ReadyVideoProductSource[]> {
  const rows = projectId
    ? (await getDatabase().select({ record: aggregateRecord }).from(workspaceProjectItem)
      .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
      .where(and(eq(workspaceProjectItem.projectId, projectId), eq(aggregateRecord.type, "product"), eq(aggregateRecord.state, "PRODUCT_READY")))
      .orderBy(desc(workspaceProjectItem.createdAt))).map((row) => row.record)
    : await getDatabase().select().from(aggregateRecord).where(and(eq(aggregateRecord.type, "product"), eq(aggregateRecord.state, "PRODUCT_READY"))).orderBy(desc(aggregateRecord.createdAt));
  return rows.flatMap((row) => {
    const product = row.payload as unknown as ProductReady;
    if (product.record_id !== row.id || product.verification_status !== "verified" || typeof product.product?.product_name !== "string" || typeof product.product?.internal_sku !== "string") return [];
    const options = factOptions(product); return options.length ? [{ id: row.id, productName: product.product.product_name, internalSku: product.product.internal_sku, factOptions: options }] : [];
  });
}

export async function createMarketingVideoEditProject(input: unknown, actorId: string, uploadedAssets: UploadedVideoSourceAsset[]) {
  const value = createMarketingVideoDraftFormSchema.parse(input);
  if (!uploadedAssets.length) throw new Error("请上传至少一个营销素材。");
  if (uploadedAssets.length > 3) throw new Error("MVP1 每条视频最多使用三个素材。");
  const id = randomUUID();
  const now = new Date();
  return getDatabase().transaction(async (tx) => {
    const [workspace] = await tx.select({ id: workspaceProject.id, kind: workspaceProject.kind }).from(workspaceProject).where(eq(workspaceProject.id, value.projectId)).for("update");
    if (!workspace || workspace.kind !== "marketing") throw new Error("只能在产品营销项目中创建营销视频。");
    const [product] = await tx.select({ id: aggregateRecord.id, state: aggregateRecord.state, payload: aggregateRecord.payload }).from(aggregateRecord).where(and(eq(aggregateRecord.id, value.productId), eq(aggregateRecord.type, "product"))).for("update");
    if (!product || product.state !== "PRODUCT_READY") throw new Error("只能从已通过 Gate 01 的产品创建营销视频。");
    const ready = product.payload as unknown as ProductReady;
    const selectedFacts = ["product.product_name", value.factPath].filter((path, index, paths) => paths.indexOf(path) === index && Boolean(ready.field_evidence[path]));
    const clips = uploadedAssets.map((asset, index) => ({
      clipId: `clip-${String(index + 1).padStart(3, "0")}`,
      assetRef: asset.assetRef,
      mediaType: asset.mediaType as "image" | "video",
      trimStartMs: 0,
      durationMs: asset.mediaType === "image" ? 3_000 : 5_000,
      fitMode: "contain" as const,
      audioMode: "muted" as const,
      subtitle: "",
      claimRefs: [] as string[],
    }));
    const editDraft = marketingVideoDraftSchema.parse({ version: 1, platform: value.platform, clips, ctaText: "Contact us for details" });
    const creative = buildVideoCreative({
      productId: product.id,
      objective: value.objective,
      targetAudience: value.targetAudience,
      factPaths: selectedFacts,
      sourceAssets: uploadedAssets,
      platforms: [value.platform],
      scenes: clips.map((clip) => ({ prompt: "用户上传的授权营销素材", durationSeconds: clip.durationMs / 1_000, claimRefs: [], assetRefs: [clip.assetRef] })),
    }, ready, id);
    const project = videoProjectSchema.parse({ ...creative, status: "draft", editDraft });
    await tx.insert(aggregateRecord).values({ id, type: "video", state: "VIDEO_DRAFT", payload: project, createdByType: "human", createdById: actorId });
    await tx.insert(workspaceProjectItem).values({ id: randomUUID(), projectId: value.projectId, aggregateId: id, role: "marketing_video" });
    await tx.update(workspaceProject).set({ updatedAt: now }).where(eq(workspaceProject.id, value.projectId));
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "marketing_video_edit.created", actorType: "human", actorId, aggregateId: id, subjectType: "video", subjectId: id, metadata: { project_id: value.projectId, platform: value.platform, clip_count: clips.length }, occurredAt: now });
    return { id, project };
  });
}

export async function listProjectMarketingVideoEntries(projectId: string, database: Database = getDatabase()): Promise<MarketingVideoEditorEntry[]> {
  const rows = await database.select({ record: aggregateRecord, createdAt: workspaceProjectItem.createdAt })
    .from(workspaceProjectItem).innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
    .where(and(eq(workspaceProjectItem.projectId, projectId), eq(aggregateRecord.type, "video"))).orderBy(desc(workspaceProjectItem.createdAt));
  if (!rows.length) return [];
  const approvals = await database.select({ aggregateId: approval.aggregateId, status: approval.status }).from(approval)
    .where(and(eq(approval.gate, "gate_01_truth"), inArray(approval.aggregateId, rows.map(({ record }) => record.id)))).orderBy(desc(approval.requestedAt));
  const approvalByVideo = new Map<string, "pending" | "approved" | "rejected">();
  for (const item of approvals) if (!approvalByVideo.has(item.aggregateId)) approvalByVideo.set(item.aggregateId, item.status);
  return rows.flatMap(({ record, createdAt }) => {
    const project = videoProjectSchema.safeParse(record.payload);
    if (!project.success || !project.data.editDraft) return [];
    const productName = project.data.factualClaims.find((claim) => claim.field === "product.product_name")?.value ?? "已核验产品";
    return [{ id: record.id, state: record.state, createdAt, productId: project.data.productId, productName, objective: project.data.objective, targetAudience: project.data.targetAudience, platforms: project.data.platforms, approvalStatus: approvalByVideo.get(record.id) ?? null, previewAssetRef: project.data.renderedAssetRef ?? null, draft: project.data.editDraft }];
  });
}

export async function getMarketingVideoEditProject(videoId: string, database: Database = getDatabase()) {
  const [record] = await database.select({ state: aggregateRecord.state, payload: aggregateRecord.payload }).from(aggregateRecord)
    .where(and(eq(aggregateRecord.id, videoId), eq(aggregateRecord.type, "video")));
  if (!record) throw new Error("营销视频不存在。");
  const project = videoProjectSchema.parse(record.payload);
  if (!project.editDraft) throw new Error("该视频不是 MVP1 剪辑项目。");
  return { state: record.state, project };
}

export async function assertMarketingVideoProjectLink(projectId: string, videoId: string, database: Database = getDatabase()) {
  const [link] = await database.select({ id: workspaceProjectItem.id }).from(workspaceProjectItem)
    .where(and(eq(workspaceProjectItem.projectId, projectId), eq(workspaceProjectItem.aggregateId, videoId)));
  if (!link) throw new Error("该营销视频不属于当前项目。");
}

export async function updateMarketingVideoEditDraft(videoId: string, draftInput: unknown, actorId: string, database: Database = getDatabase()) {
  const draft = marketingVideoDraftSchema.parse(draftInput);
  return database.transaction(async (tx) => {
    const [record] = await tx.select().from(aggregateRecord).where(and(eq(aggregateRecord.id, videoId), eq(aggregateRecord.type, "video"))).for("update");
    if (!record || !["VIDEO_DRAFT", "VIDEO_REVISION_REQUIRED"].includes(record.state)) throw new Error("当前视频状态不能修改剪辑稿。");
    const current = videoProjectSchema.parse(record.payload);
    const assetRefs = new Set(current.sourceAssets.map((asset) => asset.assetRef));
    const claimRefs = new Set(current.factualClaims.map((claim) => claim.field));
    for (const clip of draft.clips) {
      if (!assetRefs.has(clip.assetRef)) throw new Error("剪辑稿引用了不属于当前视频的素材。");
      if (!clip.claimRefs.every((claimRef) => claimRefs.has(claimRef))) throw new Error("剪辑稿引用了未经核验的产品事实。");
    }
    const project = videoProjectSchema.parse({ ...current, status: record.state === "VIDEO_REVISION_REQUIRED" ? "revision_required" : "draft", editDraft: draft, renderedAssetRef: undefined });
    await tx.update(aggregateRecord).set({ payload: project, version: sql`${aggregateRecord.version} + 1` }).where(eq(aggregateRecord.id, videoId));
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "marketing_video_edit.saved", actorType: "human", actorId, aggregateId: videoId, subjectType: "video", subjectId: videoId, metadata: { duration_ms: draft.clips.reduce((sum, clip) => sum + clip.durationMs, 0), clip_count: draft.clips.length }, occurredAt: new Date() });
    return project;
  });
}

export async function beginMarketingVideoRender(videoId: string, actorId: string, database: Database = getDatabase()) {
  const now = new Date(); const eventId = randomUUID();
  return database.transaction(async (tx) => {
    const [record] = await tx.select().from(aggregateRecord).where(and(eq(aggregateRecord.id, videoId), eq(aggregateRecord.type, "video"))).for("update");
    if (!record || !["VIDEO_DRAFT", "VIDEO_REVISION_REQUIRED"].includes(record.state)) throw new Error("当前视频状态不能开始合成。");
    const project = videoProjectSchema.parse(record.payload);
    if (!project.editDraft) throw new Error("视频缺少可合成的剪辑稿。");
    const evidenceRefs = [...new Set([...project.factualClaims.map((claim) => claim.evidenceRef), ...project.sourceAssets.map((asset) => asset.rightsEvidenceRef)])];
    assertTransition({ eventId, entityType: "video", entityId: videoId, fromState: record.state, toState: "VIDEO_RENDERING", actorType: "human", actorId, occurredAt: now.toISOString(), evidenceRefs });
    const renderingProject = videoProjectSchema.parse({ ...project, status: "rendering", renderedAssetRef: undefined });
    await tx.update(aggregateRecord).set({ state: "VIDEO_RENDERING", payload: renderingProject, version: sql`${aggregateRecord.version} + 1` }).where(eq(aggregateRecord.id, videoId));
    await tx.insert(workflowEvent).values({ id: eventId, aggregateId: videoId, fromState: record.state, toState: "VIDEO_RENDERING", actorType: "human", actorId, evidenceRefs, occurredAt: now });
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "marketing_video_render.started", actorType: "human", actorId, aggregateId: videoId, subjectType: "video", subjectId: videoId, metadata: { duration_ms: project.editDraft.clips.reduce((sum, clip) => sum + clip.durationMs, 0) }, occurredAt: now });
    return renderingProject;
  });
}

export async function completeMarketingVideoRender(videoId: string, assetRef: string, database: Database = getDatabase()) {
  const now = new Date(); const eventId = randomUUID(); const approvalId = randomUUID(); const actorId = "ffmpeg:mvp1-editor";
  return database.transaction(async (tx) => {
    const [record] = await tx.select().from(aggregateRecord).where(and(eq(aggregateRecord.id, videoId), eq(aggregateRecord.type, "video"))).for("update");
    if (!record || record.state !== "VIDEO_RENDERING") throw new Error("视频合成状态已发生变化，请刷新后重试。");
    const project = videoProjectSchema.parse(record.payload);
    const evidenceRefs = [...new Set([...project.factualClaims.map((claim) => claim.evidenceRef), ...project.sourceAssets.map((asset) => asset.rightsEvidenceRef), assetRef])];
    assertTransition({ eventId, entityType: "video", entityId: videoId, fromState: "VIDEO_RENDERING", toState: "VIDEO_REVIEW_REQUIRED", actorType: "system", actorId, occurredAt: now.toISOString(), evidenceRefs });
    const reviewProject = videoProjectSchema.parse({ ...project, status: "review_required", renderedAssetRef: assetRef });
    await tx.insert(approval).values({ id: approvalId, aggregateId: videoId, gate: "gate_01_truth", status: "pending", requestedByType: "system", requestedById: actorId, requestedAt: now });
    await tx.update(aggregateRecord).set({ state: "VIDEO_REVIEW_REQUIRED", payload: reviewProject, version: sql`${aggregateRecord.version} + 1` }).where(eq(aggregateRecord.id, videoId));
    await tx.insert(workflowEvent).values({ id: eventId, aggregateId: videoId, fromState: "VIDEO_RENDERING", toState: "VIDEO_REVIEW_REQUIRED", actorType: "system", actorId, evidenceRefs, occurredAt: now });
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "marketing_video_render.completed", actorType: "system", actorId, aggregateId: videoId, subjectType: "video", subjectId: videoId, metadata: { asset_ref: assetRef, approval_id: approvalId }, occurredAt: now });
    return { project: reviewProject, approvalId };
  });
}

export async function failMarketingVideoRender(videoId: string, reason: string, database: Database = getDatabase()) {
  const now = new Date(); const eventId = randomUUID(); const actorId = "ffmpeg:mvp1-editor";
  return database.transaction(async (tx) => {
    const [record] = await tx.select().from(aggregateRecord).where(and(eq(aggregateRecord.id, videoId), eq(aggregateRecord.type, "video"))).for("update");
    if (!record || record.state !== "VIDEO_RENDERING") return;
    const project = videoProjectSchema.parse(record.payload);
    const evidenceRefs = [...new Set(project.sourceAssets.map((asset) => asset.rightsEvidenceRef))];
    assertTransition({ eventId, entityType: "video", entityId: videoId, fromState: "VIDEO_RENDERING", toState: "VIDEO_REVISION_REQUIRED", actorType: "system", actorId, occurredAt: now.toISOString(), evidenceRefs });
    const revisionProject = videoProjectSchema.parse({ ...project, status: "revision_required" });
    await tx.update(aggregateRecord).set({ state: "VIDEO_REVISION_REQUIRED", payload: revisionProject, version: sql`${aggregateRecord.version} + 1` }).where(eq(aggregateRecord.id, videoId));
    await tx.insert(workflowEvent).values({ id: eventId, aggregateId: videoId, fromState: "VIDEO_RENDERING", toState: "VIDEO_REVISION_REQUIRED", actorType: "system", actorId, evidenceRefs, occurredAt: now });
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "marketing_video_render.failed", actorType: "system", actorId, aggregateId: videoId, subjectType: "video", subjectId: videoId, metadata: { reason: reason.slice(0, 500) }, occurredAt: now });
  });
}

export async function createVideoProject(input: VideoProjectDraftInput, actorId: string, uploadedAssets: VideoProject["sourceAssets"] = []) {
  const now = new Date(); const id = randomUUID(); const approvalId = randomUUID(); const eventId = randomUUID();
  return getDatabase().transaction(async (tx) => {
    const [product] = await tx.select({ id: aggregateRecord.id, state: aggregateRecord.state, payload: aggregateRecord.payload }).from(aggregateRecord).where(and(eq(aggregateRecord.id, input.productId), eq(aggregateRecord.type, "product"))).for("update");
    if (!product || product.state !== "PRODUCT_READY") throw new Error("只能从已通过 Gate 01 的产品创建视频项目。 ");
    const ready = product.payload as unknown as ProductReady;
    if (ready.record_id !== product.id || ready.verification_status !== "verified") throw new Error("产品就绪记录不完整，无法创建视频项目。 ");
    const sourceAssets = [...uploadedAssets, ...(input.assetRef && input.rightsEvidenceRef ? [{ assetRef: input.assetRef, mediaType: "image" as const, rightsEvidenceRef: input.rightsEvidenceRef }] : [])];
    const project = buildVideoCreative({ productId: product.id, objective: input.objective, targetAudience: input.targetAudience, factPaths: [input.factPath], sourceAssets, platforms: input.platforms, scenes: [{ prompt: input.scenePrompt, durationSeconds: input.durationSeconds, claimRefs: [input.factPath], assetRefs: sourceAssets.map((asset) => asset.assetRef) }] }, ready, id);
    assertTransition({ eventId, entityType: "video", entityId: id, fromState: "VIDEO_DRAFT", toState: "VIDEO_REVIEW_REQUIRED", actorType: "human", actorId, occurredAt: now.toISOString(), evidenceRefs: [...project.factualClaims.map((claim) => claim.evidenceRef), ...sourceAssets.map((asset) => asset.rightsEvidenceRef)] });
    await tx.insert(aggregateRecord).values({ id, type: "video", state: "VIDEO_REVIEW_REQUIRED", payload: project, createdByType: "human", createdById: actorId });
    await tx.insert(approval).values({ id: approvalId, aggregateId: id, gate: "gate_01_truth", status: "pending", requestedByType: "human", requestedById: actorId, requestedAt: now });
    await tx.insert(workflowEvent).values({ id: eventId, aggregateId: id, fromState: "VIDEO_DRAFT", toState: "VIDEO_REVIEW_REQUIRED", actorType: "human", actorId, evidenceRefs: [...project.factualClaims.map((claim) => claim.evidenceRef), ...sourceAssets.map((asset) => asset.rightsEvidenceRef)], occurredAt: now });
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "video_project.created", actorType: "human", actorId, aggregateId: id, subjectType: "video_project", subjectId: id, metadata: { product_id: product.id, platform_count: project.platforms.length, scene_count: project.scenes.length }, occurredAt: now });
    return { id, approvalId, project };
  });
}

function sceneConnectsToGenerate(sceneId: string, edges: VideoCanvasDocument["edges"]) {
  const visited = new Set<string>();
  const pending = [sceneId];
  while (pending.length) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    if (current === "generate") return true;
    visited.add(current);
    for (const edge of edges) if (edge.source === current) pending.push(edge.target);
  }
  return false;
}

/** Converts a fully configured canvas into one reviewable project; all facts are reloaded from ProductReady. */
export async function createVideoProjectFromCanvas(document: VideoCanvasDocument, actorId: string) {
  if (!document.brief || !document.factBinding || !document.assetBinding || !document.platforms?.length) throw new Error("请完成简报、已验证事实、素材权利和目标平台后再创建项目。");
  const sceneNodeIds = document.nodes.filter((node) => node.id.startsWith("scene-")).map((node) => node.id);
  if (!sceneNodeIds.length || !document.scenes) throw new Error("请至少添加并填写一个镜头节点。");
  const canvasSnapshotSha256 = createHash("sha256").update(JSON.stringify(document)).digest("hex");
  const scenes = sceneNodeIds.map((sceneId) => {
    const scene = document.scenes?.[sceneId];
    if (!scene) throw new Error("每个镜头节点都必须填写镜头说明和时长。");
    if (!sceneConnectsToGenerate(sceneId, document.edges)) throw new Error("每个镜头节点都必须连接到生成视频节点。");
    return scene;
  });
  const now = new Date(); const id = randomUUID(); const approvalId = randomUUID(); const eventId = randomUUID();
  return getDatabase().transaction(async (tx) => {
    const [product] = await tx.select({ id: aggregateRecord.id, state: aggregateRecord.state, payload: aggregateRecord.payload }).from(aggregateRecord).where(and(eq(aggregateRecord.id, document.factBinding!.productId), eq(aggregateRecord.type, "product"))).for("update");
    if (!product || product.state !== "PRODUCT_READY") throw new Error("所选产品不再是已核验产品。");
    const ready = product.payload as unknown as ProductReady;
    if (ready.record_id !== product.id || ready.verification_status !== "verified") throw new Error("产品就绪记录不完整，无法创建视频项目。");
    const project = buildVideoCreative({
      productId: product.id,
      objective: document.brief!.objective,
      targetAudience: document.brief!.targetAudience,
      factPaths: [document.factBinding!.factPath],
      sourceAssets: [{ assetRef: document.assetBinding!.assetRef, mediaType: "image", rightsEvidenceRef: document.assetBinding!.rightsEvidenceRef }],
      platforms: document.platforms!,
      scenes: scenes.map((scene) => ({ prompt: scene.prompt, durationSeconds: scene.durationSeconds, claimRefs: [document.factBinding!.factPath], assetRefs: [document.assetBinding!.assetRef] })),
    }, ready, id);
    const evidenceRefs = [...project.factualClaims.map((claim) => claim.evidenceRef), document.assetBinding!.rightsEvidenceRef];
    assertTransition({ eventId, entityType: "video", entityId: id, fromState: "VIDEO_DRAFT", toState: "VIDEO_REVIEW_REQUIRED", actorType: "human", actorId, occurredAt: now.toISOString(), evidenceRefs });
    await tx.insert(aggregateRecord).values({ id, type: "video", state: "VIDEO_REVIEW_REQUIRED", payload: project, createdByType: "human", createdById: actorId });
    await tx.insert(approval).values({ id: approvalId, aggregateId: id, gate: "gate_01_truth", status: "pending", requestedByType: "human", requestedById: actorId, requestedAt: now });
    await tx.insert(workflowEvent).values({ id: eventId, aggregateId: id, fromState: "VIDEO_DRAFT", toState: "VIDEO_REVIEW_REQUIRED", actorType: "human", actorId, evidenceRefs, occurredAt: now });
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "video_project.created_from_canvas", actorType: "human", actorId, aggregateId: id, subjectType: "video_project", subjectId: id, metadata: { product_id: product.id, platform_count: project.platforms.length, scene_count: project.scenes.length, canvas_snapshot_sha256: canvasSnapshotSha256 }, occurredAt: now });
    return { id, approvalId, project };
  });
}

/** Gate 01 decision for a video plan. Approval never starts generation or publication. */
export async function decideVideoReview(input: VideoReviewInput, actorId: string) {
  const now = new Date(); const eventId = randomUUID();
  return getDatabase().transaction(async (tx) => {
    const [aggregate] = await tx.select({ id: aggregateRecord.id, state: aggregateRecord.state, version: aggregateRecord.version, payload: aggregateRecord.payload })
      .from(aggregateRecord).where(and(eq(aggregateRecord.id, input.videoId), eq(aggregateRecord.type, "video"))).for("update");
    if (!aggregate || aggregate.state !== "VIDEO_REVIEW_REQUIRED") throw new Error("该视频计划当前不处于待确认状态。");
    const [pendingApproval] = await tx.select().from(approval).where(and(eq(approval.aggregateId, aggregate.id), eq(approval.gate, "gate_01_truth"), eq(approval.status, "pending"))).for("update");
    if (!pendingApproval) throw new Error("未找到待处理的视频事实确认请求。");
    const nextState = input.decision === "approved" ? "VIDEO_APPROVED" : "VIDEO_REVISION_REQUIRED";
    const current = videoProjectSchema.parse(aggregate.payload);
    const project = videoProjectSchema.parse({ ...current, status: input.decision === "approved" ? "approved" : "revision_required", ...(input.decision === "approved" ? { approvalRefs: [...current.approvalRefs, pendingApproval.id] } : {}) });
    assertTransition({ eventId, entityType: "video", entityId: aggregate.id, fromState: "VIDEO_REVIEW_REQUIRED", toState: nextState, actorType: "human", actorId, occurredAt: now.toISOString(), evidenceRefs: [input.evidenceRef], gate: "gate_01_truth", approvalRef: pendingApproval.id }, { id: pendingApproval.id, aggregateId: aggregate.id, gate: "gate_01_truth", status: input.decision, decidedByType: "human", decidedById: actorId, evidenceRef: input.evidenceRef });
    await tx.update(approval).set({ status: input.decision, decidedByType: "human", decidedById: actorId, decidedAt: now, evidenceRef: input.evidenceRef, ...(input.notes ? { notes: input.notes } : {}) }).where(eq(approval.id, pendingApproval.id));
    const [updated] = await tx.update(aggregateRecord).set({ state: nextState, payload: project, version: sql`${aggregateRecord.version} + 1` }).where(and(eq(aggregateRecord.id, aggregate.id), eq(aggregateRecord.version, aggregate.version))).returning({ id: aggregateRecord.id });
    if (!updated) throw new Error("视频确认与另一项操作冲突，请刷新后重试。");
    await tx.insert(workflowEvent).values({ id: eventId, aggregateId: aggregate.id, fromState: "VIDEO_REVIEW_REQUIRED", toState: nextState, actorType: "human", actorId, gate: "gate_01_truth", approvalId: pendingApproval.id, evidenceRefs: [input.evidenceRef], occurredAt: now });
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "video_gate_01_decided", actorType: "human", actorId, aggregateId: aggregate.id, subjectType: "video", subjectId: aggregate.id, metadata: { decision: input.decision, approval_id: pendingApproval.id }, occurredAt: now });
    return { state: nextState, approvalId: pendingApproval.id };
  });
}

export async function listVideoWorkspaceEntries(limit = 50): Promise<VideoWorkspaceEntry[]> {
  const rows = await getDatabase().select().from(aggregateRecord).where(eq(aggregateRecord.type, "video")).orderBy(desc(aggregateRecord.createdAt)).limit(limit);
  if (!rows.length) return [];
  const [approvals, completedJobs] = await Promise.all([
    getDatabase().select({ aggregateId: approval.aggregateId, status: approval.status }).from(approval).where(and(eq(approval.gate, "gate_01_truth"), inArray(approval.aggregateId, rows.map((row) => row.id)))).orderBy(desc(approval.requestedAt)),
    getDatabase().select({ videoProjectId: videoJob.videoProjectId, resultAssetRef: videoJob.resultAssetRef }).from(videoJob).where(and(inArray(videoJob.videoProjectId, rows.map((row) => row.id)), eq(videoJob.status, "succeeded"))).orderBy(desc(videoJob.updatedAt)),
  ]);
  const statusByProject = new Map<string, "pending" | "approved" | "rejected">(); for (const item of approvals) if (!statusByProject.has(item.aggregateId)) statusByProject.set(item.aggregateId, item.status);
  const previewAssetByProject = new Map<string, string>();
  for (const job of completedJobs) if (job.resultAssetRef && !previewAssetByProject.has(job.videoProjectId)) previewAssetByProject.set(job.videoProjectId, job.resultAssetRef);
  return rows.flatMap((row) => {
    const project = row.payload as Partial<VideoProject>; const productName = project.factualClaims?.find((claim) => claim.field === "product.product_name")?.value ?? "已核验产品";
    if (!project.productId || !project.objective || !project.platforms) return [];
    return [{ id: row.id, state: row.state, createdAt: row.createdAt, productId: project.productId, productName, objective: project.objective, platforms: project.platforms, approvalStatus: statusByProject.get(row.id) ?? null, previewAssetRef: previewAssetByProject.get(row.id) ?? null }];
  });
}
