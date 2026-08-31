import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { getDatabase, type Database } from "@/lib/db/client";
import { aggregateRecord, auditEvent, workspaceCanvasDocument, workspaceProject, workspaceProjectItem } from "@/lib/db/schema";

import { createWorkspaceProjectSchema, saveWorkspaceCanvasSchema, workspaceCanvasDocumentSchema, type WorkspaceCanvasDocument } from "./contracts";

export class WorkspaceCanvasRevisionConflictError extends Error {
  constructor() { super("项目画布已在另一处更新。请刷新后再保存，避免覆盖他人的修改。"); }
}

export type WorkspaceProjectSummary = { id: string; title: string; kind: "marketing" | "sales"; status: "active" | "archived"; updatedAt: Date };
export type WorkspaceProjectDetail = WorkspaceProjectSummary & { document: WorkspaceCanvasDocument; revision: number };

function template(kind: "marketing" | "sales"): WorkspaceCanvasDocument {
  const labels = kind === "marketing"
    ? [["product", "product", "产品资料"], ["approval", "approval", "人工事实审核"], ["content", "content", "营销内容"], ["video", "video", "视频计划"]] as const
    : [["rfq", "rfq", "客户询盘"], ["product", "product", "产品引用"], ["quotation", "quotation", "报价交接"], ["approval", "approval", "人工确认"]] as const;
  const nodes = labels.map(([id, kindName, label], index) => ({ id, kind: kindName, label, locked: true, position: { x: index * 260, y: index % 2 ? 140 : 40 } })) as WorkspaceCanvasDocument["nodes"];
  return { version: 1, nodes, edges: nodes.slice(1).map((node, index) => ({ id: `edge-${index + 1}`, source: nodes[index]!.id, target: node.id, kind: index === 0 ? "requires_review" : "depends_on" })) };
}

export async function listWorkspaceProjects(database: Database = getDatabase()): Promise<WorkspaceProjectSummary[]> {
  return database.select({ id: workspaceProject.id, title: workspaceProject.title, kind: workspaceProject.kind, status: workspaceProject.status, updatedAt: workspaceProject.updatedAt })
    .from(workspaceProject).orderBy(desc(workspaceProject.updatedAt));
}

export async function createWorkspaceProject(input: unknown, actorId: string, database: Database = getDatabase()): Promise<WorkspaceProjectDetail> {
  const value = createWorkspaceProjectSchema.parse(input);
  const id = randomUUID(); const document = template(value.kind); const now = new Date();
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
  return row ? { ...row, document: workspaceCanvasDocumentSchema.parse(row.document) } : null;
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
