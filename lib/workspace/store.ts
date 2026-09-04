import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";

import { getDatabase, type Database } from "@/lib/db/client";
import { aggregateRecord, approval, auditEvent, socialPublication, workspaceCanvasDocument, workspaceProject, workspaceProjectItem, workspaceProjectMember } from "@/lib/db/schema";
import type { ProductReady } from "@/lib/product/verification";
import { assertWorkspaceProjectAccess } from "./access";

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
  nodeKind: "product" | "content" | "video" | "publication" | "rfq" | "quotation" | "lead" | "delivery";
  title: string;
  detail: string;
  priority: "review" | "complete";
  createdAt: Date;
  dueAt?: Date;
  actionLabel?: string;
  taskType?: "approval" | "follow_up" | "publication" | "rfq" | "opportunity";
};
export type WorkspacePipelineSummary = WorkspaceProjectSummary & {
  currentStage: string;
  nextAction: string;
  recordCount: number;
  publishedCount: number;
  leadCount: number;
  opportunityCount: number;
  relatedMarketingProjectTitle?: string;
};

export async function listWorkspaceProjects(actorId: string, database: Database = getDatabase()): Promise<WorkspaceProjectSummary[]> {
  return database.select({ id: workspaceProject.id, title: workspaceProject.title, kind: workspaceProject.kind, status: workspaceProject.status, updatedAt: workspaceProject.updatedAt })
    .from(workspaceProject).innerJoin(workspaceProjectMember, and(eq(workspaceProjectMember.projectId, workspaceProject.id), eq(workspaceProjectMember.userId, actorId))).orderBy(desc(workspaceProject.updatedAt));
}

function taskTitle(type: string, payload: Record<string, unknown>) {
  if (type === "product") {
    const product = payload.product as Record<string, unknown> | undefined;
    return typeof product?.product_name === "string" ? product.product_name : "产品资料待审核";
  }
  if (type === "content") return typeof payload.hook === "string" ? payload.hook : "营销内容待审核";
  if (type === "video") return typeof payload.objective === "string" ? payload.objective : "营销视频待审核";
  if (type === "quotation") return "人工报价等待 Gate 02";
  if (type === "delivery_confirmation") return "交期等待 Gate 03";
  if (type === "lead") return payload.score_band === "HOT" ? "确认有效商机" : "客户跟进到期";
  const product = payload.product as Record<string, unknown> | undefined;
  return typeof product?.product_type === "string" ? `询盘：${product.product_type}` : "询盘资料待补充";
}

export async function listWorkspaceTasks(actorId: string, database: Database = getDatabase()): Promise<WorkspaceTaskSummary[]> {
  const visibleProjects = await database.select({ id: workspaceProjectMember.projectId }).from(workspaceProjectMember).where(eq(workspaceProjectMember.userId, actorId));
  const projectIds = visibleProjects.map((project) => project.id);
  if (!projectIds.length) return [];
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
    .where(and(eq(approval.status, "pending"), inArray(workspaceProject.id, projectIds), inArray(workspaceProjectItem.role, ["product_source", "marketing_content", "marketing_video", "sales_quotation", "delivery_confirmation"])))
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
    .where(and(inArray(workspaceProject.id, projectIds), eq(workspaceProjectItem.role, "sales_rfq"), eq(workspaceProjectItem.relation, "owned"), eq(aggregateRecord.state, "RFQ_COLLECTING")))
    .orderBy(desc(aggregateRecord.createdAt));
  const leadRows = await database.select({
    id: aggregateRecord.id, payload: aggregateRecord.payload, createdAt: aggregateRecord.createdAt,
    projectId: workspaceProject.id, projectTitle: workspaceProject.title,
  }).from(workspaceProjectItem)
    .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
    .innerJoin(workspaceProject, eq(workspaceProject.id, workspaceProjectItem.projectId))
    .where(and(inArray(workspaceProject.id, projectIds), eq(workspaceProjectItem.role, "sales_lead"), eq(workspaceProjectItem.relation, "owned"), inArray(aggregateRecord.state, ["LEAD_RECEIVED", "FOLLOW_UP"])))
    .orderBy(desc(aggregateRecord.updatedAt));
  const publicationRows = await database.select({ id: aggregateRecord.id, type: aggregateRecord.type, payload: aggregateRecord.payload, createdAt: aggregateRecord.createdAt, projectId: workspaceProject.id, projectTitle: workspaceProject.title })
    .from(workspaceProjectItem).innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId)).innerJoin(workspaceProject, eq(workspaceProject.id, workspaceProjectItem.projectId))
    .where(and(inArray(workspaceProject.id, projectIds), inArray(workspaceProjectItem.role, ["marketing_content", "marketing_video"]), inArray(aggregateRecord.state, ["CONTENT_APPROVED", "VIDEO_APPROVED"])))
    .orderBy(desc(aggregateRecord.updatedAt));
  const publicationStates = publicationRows.length ? await database.select({ id: socialPublication.id, contentRef: socialPublication.contentRef, status: socialPublication.status, createdAt: socialPublication.createdAt }).from(socialPublication).where(inArray(socialPublication.contentRef, publicationRows.map((row) => row.id))).orderBy(desc(socialPublication.createdAt)) : [];
  const latestPublicationByContent = new Map<string, { id: string; status: string }>();
  for (const publication of publicationStates) if (!latestPublicationByContent.has(publication.contentRef)) latestPublicationByContent.set(publication.contentRef, publication);
  const seenReviewIds = new Set<string>();
  const reviewTasks = reviewRows.flatMap((row): WorkspaceTaskSummary[] => {
    if (seenReviewIds.has(row.id)) return [];
    seenReviewIds.add(row.id);
    const nodeKind = row.type === "product" ? "product" : row.type === "content" ? "content" : row.type === "video" ? "video" : row.type === "quotation" ? "quotation" : row.type === "delivery_confirmation" ? "delivery" : null;
    if (!nodeKind) return [];
    const detail = row.type === "quotation" ? "等待管理员完成 Gate 02" : row.type === "delivery_confirmation" ? "等待管理员完成 Gate 03" : "等待人工审核";
    return [{ id: row.id, projectId: row.projectId, projectTitle: row.projectTitle, nodeKind, title: taskTitle(row.type, row.payload), detail, actionLabel: row.type === "quotation" ? "审核人工报价" : row.type === "delivery_confirmation" ? "确认交期" : "完成审核", priority: "review", taskType: "approval", createdAt: row.createdAt }];
  });
  const rfqTasks = rfqRows.map((row): WorkspaceTaskSummary => {
    const missing = (row.payload.missing_fields as unknown[] | undefined)?.filter((item): item is string => typeof item === "string").length ?? 0;
    return { id: row.id, projectId: row.projectId, projectTitle: row.projectTitle, nodeKind: "rfq", title: taskTitle("rfq", row.payload), detail: missing ? `还缺 ${missing} 项资料` : "等待提交为完整询盘", priority: "complete", taskType: "rfq", createdAt: row.createdAt };
  });
  const leadTasks = leadRows.map((row): WorkspaceTaskSummary => {
    const received = row.payload.status === "received";
    const due = typeof row.payload.next_follow_up_at === "string" && !Number.isNaN(Date.parse(row.payload.next_follow_up_at)) ? new Date(row.payload.next_follow_up_at) : undefined;
    const hot = row.payload.score_band === "HOT";
    return { id: row.id, projectId: row.projectId, projectTitle: row.projectTitle, nodeKind: "lead", title: received ? "入站线索等待 RFQ" : taskTitle("lead", row.payload), detail: received ? "消息已归属项目，等待业务人员录入询盘" : hot ? "规则评分已达 HOT，等待人工认定" : due ? `计划跟进：${due.toLocaleString("zh-CN")}` : "等待下一次人工跟进", actionLabel: received ? "录入 RFQ" : hot ? "确认有效商机" : "继续跟进", priority: hot ? "review" : "complete", taskType: received ? "rfq" : hot ? "opportunity" : "follow_up", createdAt: row.createdAt, ...(due ? { dueAt: due } : {}) };
  });
  const publicationTasks = publicationRows.flatMap((row): WorkspaceTaskSummary[] => {
    const publication = latestPublicationByContent.get(row.id);
    if (publication && ["submitted", "published"].includes(publication.status)) return [];
    const needsResolution = publication && ["unknown", "failed", "paused"].includes(publication.status);
    return [{ id: publication?.id ?? row.id, projectId: row.projectId, projectTitle: row.projectTitle, nodeKind: "publication", title: needsResolution ? "发布已暂停，等待人工核对" : row.type === "video" ? "已批准视频等待发布确认" : taskTitle("content", row.payload), detail: needsResolution ? "平台结果不确定或执行失败；禁止自动重试" : "需要逐帖人工确认后提交受控发布", actionLabel: needsResolution ? "核对发布状态" : "确认并提交发布", priority: "review", taskType: "publication", createdAt: row.createdAt }];
  });
  return [...reviewTasks, ...publicationTasks, ...rfqTasks, ...leadTasks].sort((left, right) => left.priority === right.priority ? right.createdAt.getTime() - left.createdAt.getTime() : left.priority === "review" ? -1 : 1);
}

export async function listWorkspacePipeline(actorId: string, database: Database = getDatabase()): Promise<WorkspacePipelineSummary[]> {
  const projects = await listWorkspaceProjects(actorId, database);
  if (!projects.length) return [];
  const rows = await database.select({ projectId: workspaceProjectItem.projectId, type: aggregateRecord.type, state: aggregateRecord.state, payload: aggregateRecord.payload })
    .from(workspaceProjectItem).innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
    .where(inArray(workspaceProjectItem.projectId, projects.map((project) => project.id)));
  const published = await database.select({ projectId: workspaceProjectItem.projectId, contentRef: socialPublication.contentRef })
    .from(socialPublication).innerJoin(workspaceProjectItem, eq(workspaceProjectItem.aggregateId, socialPublication.contentRef))
    .where(and(inArray(workspaceProjectItem.projectId, projects.map((project) => project.id)), eq(socialPublication.status, "published")));
  const marketingByPublication = new Map(published.map((item) => [item.contentRef, item.projectId]));
  const projectNames = new Map(projects.map((project) => [project.id, project.title]));
  return projects.map((project) => {
    const records = rows.filter((row) => row.projectId === project.id);
    const publicationCount = published.filter((row) => row.projectId === project.id).length;
    const leadRecords = records.filter((row) => row.type === "lead");
    const opportunityCount = leadRecords.filter((row) => row.state === "OPPORTUNITY").length;
    const sourcePublicationRef = leadRecords.map((row) => row.payload.source_publication_ref).find((value): value is string => typeof value === "string");
    const relatedMarketingProjectId = sourcePublicationRef ? marketingByPublication.get(sourcePublicationRef) : undefined;
    const stateSet = new Set(records.map((row) => row.state));
    const currentStage = project.kind === "marketing"
      ? publicationCount ? "已有发布成果" : stateSet.has("VIDEO_APPROVED") || stateSet.has("CONTENT_APPROVED") ? "等待发布" : stateSet.has("VIDEO_DRAFT") || stateSet.has("VIDEO_REVIEW_REQUIRED") ? "内容 / 视频" : "产品事实"
      : opportunityCount ? "有效商机" : stateSet.has("DELIVERY_CONFIRMATION_PENDING") || stateSet.has("DELIVERY_CONFIRMATION_CONFIRMED") ? "交期确认" : leadRecords.length ? "跟进" : stateSet.has("QUOTE_SENT") || stateSet.has("QUOTE_APPROVED") || stateSet.has("QUOTE_REVIEW_REQUIRED") ? "报价" : stateSet.has("RFQ_READY") || stateSet.has("RFQ_COLLECTING") ? "RFQ" : "入站线索";
    const nextAction = project.kind === "marketing"
      ? publicationCount ? "查看成果与入站转化" : currentStage === "等待发布" ? "确认发布结果" : currentStage === "内容 / 视频" ? "继续制作并提审" : "补全并审核产品事实"
      : opportunityCount ? "维护有效商机" : currentStage === "交期确认" ? "完成 Gate 03" : currentStage === "跟进" ? "执行下一次人工跟进" : currentStage === "报价" ? "完成报价审核或发送" : currentStage === "RFQ" ? "补全 RFQ" : "处理入站线索";
    return { ...project, currentStage, nextAction, recordCount: records.length, publishedCount: publicationCount, leadCount: leadRecords.length, opportunityCount, ...(relatedMarketingProjectId ? { relatedMarketingProjectTitle: projectNames.get(relatedMarketingProjectId) } : {}) };
  });
}

export async function createWorkspaceProject(input: unknown, actorId: string, database: Database = getDatabase()): Promise<WorkspaceProjectDetail> {
  const value = createWorkspaceProjectSchema.parse(input);
  const id = randomUUID(); const document = createWorkspaceTemplate(value.kind); const now = new Date();
  await database.transaction(async (tx) => {
    await tx.insert(workspaceProject).values({ id, title: value.title, kind: value.kind, createdById: actorId });
    await tx.insert(workspaceProjectMember).values({ id: randomUUID(), projectId: id, userId: actorId, role: "owner", createdById: actorId });
    await tx.insert(workspaceCanvasDocument).values({ id: randomUUID(), projectId: id, document, revision: 1 });
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "workspace_project.created", actorType: "human", actorId, subjectType: "workspace_project", subjectId: id, metadata: { kind: value.kind }, occurredAt: now });
  });
  return { id, title: value.title, kind: value.kind, status: "active", updatedAt: now, document, revision: 1 };
}

export async function getWorkspaceProject(projectId: string, actorId: string, database: Database = getDatabase()): Promise<WorkspaceProjectDetail | null> {
  await assertWorkspaceProjectAccess(projectId, actorId, "view", database);
  const [row] = await database.select({ id: workspaceProject.id, title: workspaceProject.title, kind: workspaceProject.kind, status: workspaceProject.status, updatedAt: workspaceProject.updatedAt, document: workspaceCanvasDocument.document, revision: workspaceCanvasDocument.revision })
    .from(workspaceProject).innerJoin(workspaceCanvasDocument, eq(workspaceCanvasDocument.projectId, workspaceProject.id)).where(eq(workspaceProject.id, projectId));
  return row ? { ...row, document: normalizeLegacyWorkspaceTemplate(row.kind, workspaceCanvasDocumentSchema.parse(row.document)) } : null;
}

export async function saveWorkspaceCanvas(projectId: string, input: unknown, actorId: string, database: Database = getDatabase()): Promise<WorkspaceProjectDetail> {
  const value = saveWorkspaceCanvasSchema.parse(input); const now = new Date();
  return database.transaction(async (tx) => {
    await assertWorkspaceProjectAccess(projectId, actorId, "write", tx);
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
  actorId: string,
  database: Database = getDatabase(),
) {
  await assertWorkspaceProjectAccess(projectId, actorId, "write", database);
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
  actorId: string,
  database: Database = getDatabase(),
) {
  await assertWorkspaceProjectKind(projectId, expectedKind, actorId, database);
  const roles = aggregateType === "product" ? ["product_source", "product_reference"]
    : aggregateType === "content" ? ["marketing_content"]
      : aggregateType === "video" ? ["marketing_video"]
        : aggregateType === "rfq" ? ["sales_rfq"]
          : aggregateType === "quotation" ? ["sales_quotation"]
            : aggregateType === "lead" ? ["sales_lead"]
              : aggregateType === "delivery_confirmation" ? ["delivery_confirmation"] : [];
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
    await assertWorkspaceProjectAccess(projectId, actorId, "write", tx);
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
