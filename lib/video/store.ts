import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import { getDatabase } from "@/lib/db/client";
import { aggregateRecord, approval, auditEvent, videoJob, workflowEvent } from "@/lib/db/schema";
import type { VideoProject } from "./contracts";
import { buildVideoCreative } from "./creative";
import type { ProductReady } from "@/lib/product/verification";
import { assertTransition } from "@/lib/workflow/transitions";
import type { videoProjectDraftFormSchema } from "@/lib/form-schemas";
import type { z } from "zod";
import { type VideoCanvasDocument } from "./canvas-contracts";

export type VideoProjectDraftInput = z.infer<typeof videoProjectDraftFormSchema>;
export type ReadyVideoProductSource = { id: string; productName: string; internalSku: string; factOptions: Array<{ value: string; label: string }> };
export type VideoWorkspaceEntry = { id: string; state: string; createdAt: Date; productId: string; productName: string; objective: string; platforms: VideoProject["platforms"]; approvalStatus: "pending" | "approved" | "rejected" | null; previewAssetRef: string | null };

function hasValue(value: unknown) { return value !== undefined && value !== null && value !== ""; }
function factOptions(product: ProductReady) {
  return (["product", "specifications", "commercial"] as const).flatMap((section) => Object.entries(product[section] ?? {})
    .filter(([, value]) => hasValue(value))
    .flatMap(([field]) => {
      const path = `${section}.${field}`;
      return product.field_evidence[path] && product.evidence_refs.includes(product.field_evidence[path]!) ? [{ value: path, label: path }] : [];
    }));
}

export async function listReadyVideoProductSources(): Promise<ReadyVideoProductSource[]> {
  const rows = await getDatabase().select().from(aggregateRecord).where(and(eq(aggregateRecord.type, "product"), eq(aggregateRecord.state, "PRODUCT_READY"))).orderBy(desc(aggregateRecord.createdAt));
  return rows.flatMap((row) => {
    const product = row.payload as unknown as ProductReady;
    if (product.record_id !== row.id || product.verification_status !== "verified" || typeof product.product?.product_name !== "string" || typeof product.product?.internal_sku !== "string") return [];
    const options = factOptions(product); return options.length ? [{ id: row.id, productName: product.product.product_name, internalSku: product.product.internal_sku, factOptions: options }] : [];
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
