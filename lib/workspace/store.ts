import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";

import { getDatabase, type Database } from "@/lib/db/client";
import { aggregateRecord, approval, auditEvent, workspaceCanvasDocument, workspaceProject, workspaceProjectItem } from "@/lib/db/schema";
import type { ProductReady } from "@/lib/product/verification";

import { createWorkspaceProjectSchema, createWorkspaceTemplate, normalizeLegacyWorkspaceTemplate, saveWorkspaceCanvasSchema, workspaceCanvasDocumentSchema, type WorkspaceCanvasDocument } from "./contracts";

export class WorkspaceCanvasRevisionConflictError extends Error {
  constructor() { super("项目画布已在另一处更新。请刷新后再保存，避免覆盖他人的修改。"); }
}

export type WorkspaceProjectSummary = { id: string; title: string; kind: "marketing" | "sales"; status: "active" | "archived"; updatedAt: Date };
export type WorkspaceProjectDetail = WorkspaceProjectSummary & { document: WorkspaceCanvasDocument; revision: number };
export type WorkspaceProductReference = { id: string; productName: string; internalSku: string };
export type WorkspaceTaskSummary = {
  id: string;
  projectId: string;
  projectTitle: string;
  nodeKind: "product" | "content" | "video" | "rfq";
  title: string;
  detail: string;
  priority: "review" | "complete";
  createdAt: Date;
};

export async function listWorkspaceProjects(database: Database = getDatabase()): Promise<WorkspaceProjectSummary[]> {
  return database.select({ id: workspaceProject.id, title: workspaceProject.title, kind: workspaceProject.kind, status: workspaceProject.status, updatedAt: workspaceProject.updatedAt })
    .from(workspaceProject).orderBy(desc(workspaceProject.updatedAt));
}

function taskTitle(type: string, payload: Record<string, unknown>) {
  if (type === "product") {
    const product = payload.product as Record<string, unknown> | undefined;
    return typeof product?.product_name === "string" ? product.product_name : "产品资料待审核";
  }
  if (type === "content") return typeof payload.hook === "string" ? payload.hook : "营销内容待审核";
  if (type === "video") return typeof payload.objective === "string" ? payload.objective : "营销视频待审核";
  const product = payload.product as Record<string, unknown> | undefined;
  return typeof product?.product_type === "string" ? `询盘：${product.product_type}` : "询盘资料待补充";
}

export async function listWorkspaceTasks(database: Database = getDatabase()): Promise<WorkspaceTaskSummary[]> {
  const reviewRows = await database.select({
    id: aggregateRecord.id,
    type: aggregateRecord.type,
    payload: aggregateRecord.payload,
    createdAt: approval.requestedAt,
    projectId: workspaceProject.id,
    projectTitle: workspaceProject.title,
    role: workspaceProjectItem.role,
  }).from(approval)
    .innerJoin(aggregateRecord, eq(aggregateRecord.id, approval.aggregateId))
    .innerJoin(workspaceProjectItem, and(eq(workspaceProjectItem.aggregateId, aggregateRecord.id), eq(workspaceProjectItem.relation, "owned")))
    .innerJoin(workspaceProject, eq(workspaceProject.id, workspaceProjectItem.projectId))
    .where(and(eq(approval.status, "pending"), inArray(workspaceProjectItem.role, ["product_source", "marketing_content", "marketing_video"])))
    .orderBy(desc(approval.requestedAt));
  const rfqRows = await database.select({
    id: aggregateRecord.id,
    payload: aggregateRecord.payload,
    createdAt: aggregateRecord.createdAt,
    projectId: workspaceProject.id,
    projectTitle: workspaceProject.title,
  }).from(workspaceProjectItem)
    .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
    .innerJoin(workspaceProject, eq(workspaceProject.id, workspaceProjectItem.projectId))
    .where(and(eq(workspaceProjectItem.role, "sales_rfq"), eq(workspaceProjectItem.relation, "owned"), eq(aggregateRecord.state, "RFQ_COLLECTING")))
    .orderBy(desc(aggregateRecord.createdAt));
  const seenReviewIds = new Set<string>();
  const reviewTasks = reviewRows.flatMap((row): WorkspaceTaskSummary[] => {
    if (seenReviewIds.has(row.id)) return [];
    seenReviewIds.add(row.id);
    const nodeKind = row.type === "product" ? "product" : row.type === "content" ? "content" : row.type === "video" ? "video" : null;
    if (!nodeKind) return [];
    return [{ id: row.id, projectId: row.projectId, projectTitle: row.projectTitle, nodeKind, title: taskTitle(row.type, row.payload), detail: "等待人工审核", priority: "review", createdAt: row.createdAt }];
  });
  const rfqTasks = rfqRows.map((row): WorkspaceTaskSummary => {
    const missing = (row.payload.missing_fields as unknown[] | undefined)?.filter((item): item is string => typeof item === "string").length ?? 0;
    return { id: row.id, projectId: row.projectId, projectTitle: row.projectTitle, nodeKind: "rfq", title: taskTitle("rfq", row.payload), detail: missing ? `还缺 ${missing} 项资料` : "等待提交为完整询盘", priority: "complete", createdAt: row.createdAt };
  });
  return [...reviewTasks, ...rfqTasks].sort((left, right) => left.priority === right.priority ? right.createdAt.getTime() - left.createdAt.getTime() : left.priority === "review" ? -1 : 1);
}

export async function createWorkspaceProject(input: unknown, actorId: string, database: Database = getDatabase()): Promise<WorkspaceProjectDetail> {
  const value = createWorkspaceProjectSchema.parse(input);
  const id = randomUUID(); const document = createWorkspaceTemplate(value.kind); const now = new Date();
  await database.transaction(async (tx) => {
    await tx.insert(workspaceProject).values({ id, title: value.title, kind: value.kind, createdById: actorId });
    await tx.insert(workspaceCanvasDocument).values({ id: randomUUID(), projectId: id, document, revision: 1 });
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "workspace_project.created", actorType: "human", actorId, subjectType: "workspace_project", subjectId: id, metadata: { kind: value.kind }, occurredAt: now });
  });
  return { id, title: value.title, kind: value.kind, status: "active", updatedAt: now, document, revision: 1 };
}

export async function getWorkspaceProject(projectId: string, database: Database = getDatabase()): Promise<WorkspaceProjectDetail | null> {
  const [row] = await database.select({ id: workspaceProject.id, title: workspaceProject.title, kind: workspaceProject.kind, status: workspaceProject.status, updatedAt: workspaceProject.updatedAt, document: workspaceCanvasDocument.document, revision: workspaceCanvasDocument.revision })
    .from(workspaceProject).innerJoin(workspaceCanvasDocument, eq(workspaceCanvasDocument.projectId, workspaceProject.id)).where(eq(workspaceProject.id, projectId));
  return row ? { ...row, document: normalizeLegacyWorkspaceTemplate(row.kind, workspaceCanvasDocumentSchema.parse(row.document)) } : null;
}

export async function saveWorkspaceCanvas(projectId: string, input: unknown, actorId: string, database: Database = getDatabase()): Promise<WorkspaceProjectDetail> {
  const value = saveWorkspaceCanvasSchema.parse(input); const now = new Date();
  return database.transaction(async (tx) => {
    const [project] = await tx.select({ id: workspaceProject.id, title: workspaceProject.title, kind: workspaceProject.kind, status: workspaceProject.status }).from(workspaceProject).where(eq(workspaceProject.id, projectId)).for("update");
    if (!project) throw new Error("项目不存在。");
    const [existing] = await tx.select({ revision: workspaceCanvasDocument.revision }).from(workspaceCanvasDocument).where(eq(workspaceCanvasDocument.projectId, projectId)).for("update");
    if (!existing || existing.revision !== value.expectedRevision) throw new WorkspaceCanvasRevisionConflictError();
    const revision = existing.revision + 1;
    await tx.update(workspaceCanvasDocument).set({ document: value.document, revision, updatedAt: now }).where(eq(workspaceCanvasDocument.projectId, projectId));
    await tx.update(workspaceProject).set({ updatedAt: now }).where(eq(workspaceProject.id, projectId));
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "workspace_canvas.saved", actorType: "human", actorId, subjectType: "workspace_project", subjectId: projectId, metadata: { revision, node_count: value.document.nodes.length }, occurredAt: now });
    return { ...project, document: value.document, revision, updatedAt: now };
  });
}

export async function listWorkspaceProjectAggregateIds(
  projectId: string,
  aggregateType: "product" | "content" | "video" | "rfq" | "quotation" | "lead" | "delivery_confirmation",
  database: Database = getDatabase(),
) {
  const rows = await database.select({ aggregateId: workspaceProjectItem.aggregateId })
    .from(workspaceProjectItem)
    .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
    .where(and(eq(workspaceProjectItem.projectId, projectId), eq(aggregateRecord.type, aggregateType)));
  return rows.map((row) => row.aggregateId);
}

export async function assertWorkspaceProjectKind(
  projectId: string,
  expectedKind: "marketing" | "sales",
  database: Database = getDatabase(),
) {
  const [project] = await database.select({ id: workspaceProject.id, kind: workspaceProject.kind })
    .from(workspaceProject)
    .where(eq(workspaceProject.id, projectId));
  if (!project || project.kind !== expectedKind) throw new Error(expectedKind === "marketing" ? "该操作只能在产品营销项目中执行。" : "该操作只能在销售机会项目中执行。");
  return project;
}

export async function assertWorkspaceAggregateLink(
  projectId: string,
  aggregateId: string,
  expectedKind: "marketing" | "sales",
  aggregateType: "product" | "content" | "video" | "rfq" | "quotation" | "lead" | "delivery_confirmation",
  database: Database = getDatabase(),
) {
  await assertWorkspaceProjectKind(projectId, expectedKind, database);
  const roles = aggregateType === "product" ? ["product_source", "product_reference"]
    : aggregateType === "content" ? ["marketing_content"]
      : aggregateType === "video" ? ["marketing_video"]
        : aggregateType === "rfq" ? ["sales_rfq"] : [];
  if (!roles.length) throw new Error("该业务类型尚未定义项目归属规则。");
  const [link] = await database.select({ id: workspaceProjectItem.id })
    .from(workspaceProjectItem)
    .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
    .where(and(
      eq(workspaceProjectItem.projectId, projectId),
      eq(workspaceProjectItem.aggregateId, aggregateId),
      eq(aggregateRecord.type, aggregateType),
      inArray(workspaceProjectItem.role, roles),
    ));
  if (!link) throw new Error("该记录不属于当前项目。");
}

export async function linkReadyProductToSalesProject(projectId: string, productId: string, actorId: string, database: Database = getDatabase()) {
  await database.transaction(async (tx) => {
    const [project] = await tx.select({ kind: workspaceProject.kind }).from(workspaceProject).where(eq(workspaceProject.id, projectId)).for("update");
    if (!project || project.kind !== "sales") throw new Error("产品引用只能添加到销售机会项目。");
    const [product] = await tx.select({ state: aggregateRecord.state }).from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, productId), eq(aggregateRecord.type, "product"))).for("update");
    if (!product || product.state !== "PRODUCT_READY") throw new Error("只能引用已通过 Gate 01 的产品。");
    await tx.insert(workspaceProjectItem).values({ id: randomUUID(), projectId, aggregateId: productId, role: "product_reference", relation: "reference" }).onConflictDoNothing();
    await tx.update(workspaceProject).set({ updatedAt: new Date() }).where(eq(workspaceProject.id, projectId));
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "workspace_project.ready_product_linked", actorType: "human", actorId, subjectType: "workspace_project", subjectId: projectId, metadata: { product_id: productId }, occurredAt: new Date() });
  });
}

export async function listProjectReadyProductReferences(projectId: string, database: Database = getDatabase()): Promise<WorkspaceProductReference[]> {
  const rows = await database.select({ id: aggregateRecord.id, payload: aggregateRecord.payload })
    .from(workspaceProjectItem)
    .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
    .where(and(eq(workspaceProjectItem.projectId, projectId), inArray(workspaceProjectItem.role, ["product_source", "product_reference"]), eq(aggregateRecord.type, "product"), eq(aggregateRecord.state, "PRODUCT_READY")))
    .orderBy(desc(workspaceProjectItem.createdAt));
  return rows.flatMap((row) => {
    const product = row.payload as unknown as ProductReady;
    const productName = product.product?.product_name;
    const internalSku = product.product?.internal_sku;
    return typeof productName === "string" && typeof internalSku === "string" ? [{ id: row.id, productName, internalSku }] : [];
  });
}
