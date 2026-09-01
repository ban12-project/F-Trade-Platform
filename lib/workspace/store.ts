import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { getDatabase, type Database } from "@/lib/db/client";
import { aggregateRecord, auditEvent, workspaceCanvasDocument, workspaceProject, workspaceProjectItem } from "@/lib/db/schema";
import type { ProductReady } from "@/lib/product/verification";

import { createWorkspaceProjectSchema, createWorkspaceTemplate, normalizeLegacyWorkspaceTemplate, saveWorkspaceCanvasSchema, workspaceCanvasDocumentSchema, type WorkspaceCanvasDocument } from "./contracts";

export class WorkspaceCanvasRevisionConflictError extends Error {
  constructor() { super("项目画布已在另一处更新。请刷新后再保存，避免覆盖他人的修改。"); }
}

export type WorkspaceProjectSummary = { id: string; title: string; kind: "marketing" | "sales"; status: "active" | "archived"; updatedAt: Date };
export type WorkspaceProjectDetail = WorkspaceProjectSummary & { document: WorkspaceCanvasDocument; revision: number };
export type WorkspaceProductReference = { id: string; productName: string; internalSku: string };

export async function listWorkspaceProjects(database: Database = getDatabase()): Promise<WorkspaceProjectSummary[]> {
  return database.select({ id: workspaceProject.id, title: workspaceProject.title, kind: workspaceProject.kind, status: workspaceProject.status, updatedAt: workspaceProject.updatedAt })
    .from(workspaceProject).orderBy(desc(workspaceProject.updatedAt));
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
    const aggregateIds = value.document.nodes.flatMap((node) => node.aggregateId ? [node.aggregateId] : []);
    if (aggregateIds.length) {
      const items = await tx.select({ aggregateId: workspaceProjectItem.aggregateId }).from(workspaceProjectItem).where(and(eq(workspaceProjectItem.projectId, projectId), inArray(workspaceProjectItem.aggregateId, aggregateIds)));
      if (items.length !== new Set(aggregateIds).size) throw new Error("画布只能引用已关联到该项目的记录。");
    }
    const revision = existing.revision + 1;
    await tx.update(workspaceCanvasDocument).set({ document: value.document, revision, updatedAt: now }).where(eq(workspaceCanvasDocument.projectId, projectId));
    await tx.update(workspaceProject).set({ updatedAt: now }).where(eq(workspaceProject.id, projectId));
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "workspace_canvas.saved", actorType: "human", actorId, subjectType: "workspace_project", subjectId: projectId, metadata: { revision, node_count: value.document.nodes.length }, occurredAt: now });
    return { ...project, document: value.document, revision, updatedAt: now };
  });
}

export async function linkWorkspaceAggregate(projectId: string, aggregateId: string, role: string, actorId: string, database: Database = getDatabase()) {
  if (!/^[a-z][a-z0-9_-]{1,80}$/i.test(role)) throw new Error("项目关联角色无效。");
  await database.transaction(async (tx) => {
    const [aggregate] = await tx.select({ id: aggregateRecord.id }).from(aggregateRecord).where(eq(aggregateRecord.id, aggregateId));
    if (!aggregate) throw new Error("要关联的记录不存在。");
    await tx.insert(workspaceProjectItem).values({ id: randomUUID(), projectId, aggregateId, role }).onConflictDoNothing();
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "workspace_project.aggregate_linked", actorType: "human", actorId, subjectType: "workspace_project", subjectId: projectId, metadata: { aggregate_id: aggregateId, role }, occurredAt: new Date() });
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
  const [link] = await database.select({ id: workspaceProjectItem.id })
    .from(workspaceProjectItem)
    .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
    .where(and(
      eq(workspaceProjectItem.projectId, projectId),
      eq(workspaceProjectItem.aggregateId, aggregateId),
      eq(aggregateRecord.type, aggregateType),
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
    await tx.insert(workspaceProjectItem).values({ id: randomUUID(), projectId, aggregateId: productId, role: "product_reference" }).onConflictDoNothing();
    await tx.update(workspaceProject).set({ updatedAt: new Date() }).where(eq(workspaceProject.id, projectId));
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "workspace_project.ready_product_linked", actorType: "human", actorId, subjectType: "workspace_project", subjectId: projectId, metadata: { product_id: productId }, occurredAt: new Date() });
  });
}

export async function listProjectReadyProductReferences(projectId: string, database: Database = getDatabase()): Promise<WorkspaceProductReference[]> {
  const rows = await database.select({ id: aggregateRecord.id, payload: aggregateRecord.payload })
    .from(workspaceProjectItem)
    .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
    .where(and(eq(workspaceProjectItem.projectId, projectId), eq(aggregateRecord.type, "product"), eq(aggregateRecord.state, "PRODUCT_READY")))
    .orderBy(desc(workspaceProjectItem.createdAt));
  return rows.flatMap((row) => {
    const product = row.payload as unknown as ProductReady;
    const productName = product.product?.product_name;
    const internalSku = product.product?.internal_sku;
    return typeof productName === "string" && typeof internalSku === "string" ? [{ id: row.id, productName, internalSku }] : [];
  });
}
