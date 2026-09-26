import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";

import { type Database, getDatabase } from "@/lib/db/client";
import {
  aggregateRecord,
  approval,
  auditEvent,
  socialChannelControl,
  socialPublication,
  user,
  workspaceProject,
  workspaceProjectItem,
  workspaceProjectMember,
} from "@/lib/db/schema";
import type { ProductReady } from "@/lib/product/verification";
import { assertWorkspaceProjectAccess } from "./access";

import { createWorkspaceProjectSchema, workspaceProjectStatusChangeSchema } from "./contracts";
import {
  deriveWorkspacePipeline,
  deriveWorkspaceTasks,
  type WorkspaceTaskSnapshot,
} from "./task-model";

export type WorkspaceProjectSummary = {
  memberRole?: "owner" | "editor" | "viewer";
  id: string;
  title: string;
  kind: "marketing" | "sales";
  status: "active" | "archived";
  updatedAt: Date;
};
export type WorkspaceProductReference = { id: string; productName: string; internalSku: string };
export type WorkspaceTaskSummary = {
  id: string;
  projectId: string;
  projectTitle: string;
  nodeKind:
    | "product"
    | "content"
    | "video"
    | "publication"
    | "rfq"
    | "quotation"
    | "lead"
    | "delivery";
  title: string;
  detail: string;
  priority: "attention" | "overdue" | "review" | "complete";
  state?: "actionable" | "waiting" | "processing" | "attention" | "scheduled";
  responsibleLabel?: string;
  source?: { kind: "product" | "rfq"; id: string };
  createdAt: Date;
  dueAt?: Date;
  actionLabel?: string;
  taskType?:
    | "approval"
    | "follow_up"
    | "publication"
    | "rfq"
    | "opportunity"
    | "revision"
    | "create"
    | "send"
    | "processing";
};
export type WorkspacePipelineSummary = WorkspaceProjectSummary & {
  currentStage: string;
  nextAction: string;
  currentStageId?: string;
  nextActionHref?: string;
  recordCount: number;
  publishedCount: number;
  leadCount: number;
  opportunityCount: number;
  relatedMarketingProjectTitle?: string;
};

export async function listWorkspaceProjects(
  actorId: string,
  database: Database = getDatabase(),
): Promise<WorkspaceProjectSummary[]> {
  return database
    .select({
      memberRole: workspaceProjectMember.role,
      id: workspaceProject.id,
      title: workspaceProject.title,
      kind: workspaceProject.kind,
      status: workspaceProject.status,
      updatedAt: workspaceProject.updatedAt,
    })
    .from(workspaceProject)
    .innerJoin(
      workspaceProjectMember,
      and(
        eq(workspaceProjectMember.projectId, workspaceProject.id),
        eq(workspaceProjectMember.userId, actorId),
      ),
    )
    .orderBy(desc(workspaceProject.updatedAt));
}

/** Load authorized data once, then derive all next-action surfaces from the same snapshot. */
export async function readWorkspaceTaskSnapshot(
  actorId: string,
  database: Database = getDatabase(),
  projectId?: string,
): Promise<WorkspaceTaskSnapshot> {
  const projects = await database
    .select({
      id: workspaceProject.id,
      title: workspaceProject.title,
      kind: workspaceProject.kind,
      status: workspaceProject.status,
      updatedAt: workspaceProject.updatedAt,
      memberRole: workspaceProjectMember.role,
      appRole: user.role,
    })
    .from(workspaceProjectMember)
    .innerJoin(workspaceProject, eq(workspaceProject.id, workspaceProjectMember.projectId))
    .innerJoin(user, eq(user.id, workspaceProjectMember.userId))
    .where(
      and(
        eq(workspaceProjectMember.userId, actorId),
        projectId ? eq(workspaceProject.id, projectId) : undefined,
      ),
    );
  const ids = projects.map((project) => project.id);
  if (!ids.length)
    return { projects: [], records: [], approvals: [], publications: [], hasActiveChannel: false };
  const [records, approvals, publications, channels] = await Promise.all([
    database
      .select({
        id: aggregateRecord.id,
        projectId: workspaceProjectItem.projectId,
        type: aggregateRecord.type,
        state: aggregateRecord.state,
        version: aggregateRecord.version,
        payload: aggregateRecord.payload,
        relation: workspaceProjectItem.relation,
        createdAt: aggregateRecord.createdAt,
        updatedAt: aggregateRecord.updatedAt,
      })
      .from(workspaceProjectItem)
      .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
      .where(inArray(workspaceProjectItem.projectId, ids)),
    database
      .select({
        id: approval.id,
        aggregateId: approval.aggregateId,
        gate: approval.gate,
        status: approval.status,
        requestedAt: approval.requestedAt,
        createdAt: approval.createdAt,
      })
      .from(approval)
      .innerJoin(workspaceProjectItem, eq(workspaceProjectItem.aggregateId, approval.aggregateId))
      .where(
        and(
          inArray(workspaceProjectItem.projectId, ids),
          eq(workspaceProjectItem.relation, "owned"),
        ),
      ),
    database
      .select({
        id: socialPublication.id,
        projectId: socialPublication.projectId,
        contentRef: socialPublication.contentRef,
        status: socialPublication.status,
        createdAt: socialPublication.createdAt,
      })
      .from(socialPublication)
      .where(inArray(socialPublication.projectId, ids)),
    database
      .select({ id: socialChannelControl.id })
      .from(socialChannelControl)
      .where(
        and(
          eq(socialChannelControl.enabled, true),
          eq(socialChannelControl.circuitStatus, "active"),
        ),
      )
      .limit(1),
  ]);
  return { projects, records, approvals, publications, hasActiveChannel: channels.length > 0 };
}

export async function listWorkspaceTasks(
  actorId: string,
  database: Database = getDatabase(),
  projectId?: string,
): Promise<WorkspaceTaskSummary[]> {
  return deriveWorkspaceTasks(
    await readWorkspaceTaskSnapshot(actorId, database, projectId),
    new Date(),
  );
}
export async function listWorkspacePipeline(
  actorId: string,
  database: Database = getDatabase(),
): Promise<WorkspacePipelineSummary[]> {
  const snapshot = await readWorkspaceTaskSnapshot(actorId, database);
  return deriveWorkspacePipeline(snapshot, deriveWorkspaceTasks(snapshot, new Date()));
}

export async function createWorkspaceProject(
  input: unknown,
  actorId: string,
  database: Database = getDatabase(),
): Promise<WorkspaceProjectSummary> {
  const value = createWorkspaceProjectSchema.parse(input);
  const id = randomUUID();
  const now = new Date();
  await database.transaction(async (tx) => {
    await tx
      .insert(workspaceProject)
      .values({ id, title: value.title, kind: value.kind, createdById: actorId });
    await tx.insert(workspaceProjectMember).values({
      id: randomUUID(),
      projectId: id,
      userId: actorId,
      role: "owner",
      createdById: actorId,
    });
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "workspace_project.created",
      actorType: "human",
      actorId,
      subjectType: "workspace_project",
      subjectId: id,
      metadata: { kind: value.kind },
      occurredAt: now,
    });
  });
  return { id, title: value.title, kind: value.kind, status: "active", updatedAt: now };
}

export async function getWorkspaceProject(
  projectId: string,
  actorId: string,
  database: Database = getDatabase(),
): Promise<(WorkspaceProjectSummary & { memberRole: "owner" | "editor" | "viewer" }) | null> {
  // Missing and inaccessible projects have the same read result. Keep membership
  // in the query itself; do not catch database failures as if they were 404s.
  const [row] = await database
    .select({
      memberRole: workspaceProjectMember.role,
      id: workspaceProject.id,
      title: workspaceProject.title,
      kind: workspaceProject.kind,
      status: workspaceProject.status,
      updatedAt: workspaceProject.updatedAt,
    })
    .from(workspaceProject)
    .innerJoin(workspaceProjectMember, eq(workspaceProjectMember.projectId, workspaceProject.id))
    .where(
      and(
        eq(workspaceProject.id, projectId),
        eq(workspaceProjectMember.userId, actorId),
        inArray(workspaceProjectMember.role, ["owner", "editor", "viewer"]),
      ),
    );
  return row ?? null;
}

export async function listWorkspaceProjectAggregateIds(
  projectId: string,
  aggregateType:
    | "product"
    | "content"
    | "video"
    | "rfq"
    | "quotation"
    | "lead"
    | "delivery_confirmation",
  database: Database = getDatabase(),
) {
  const rows = await database
    .select({ aggregateId: workspaceProjectItem.aggregateId })
    .from(workspaceProjectItem)
    .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
    .where(
      and(eq(workspaceProjectItem.projectId, projectId), eq(aggregateRecord.type, aggregateType)),
    );
  return rows.map((row) => row.aggregateId);
}

export async function assertWorkspaceProjectKind(
  projectId: string,
  expectedKind: "marketing" | "sales",
  actorId: string,
  database: Database = getDatabase(),
) {
  await assertWorkspaceProjectAccess(projectId, actorId, "write", database);
  const [project] = await database
    .select({ id: workspaceProject.id, kind: workspaceProject.kind })
    .from(workspaceProject)
    .where(eq(workspaceProject.id, projectId));
  if (!project || project.kind !== expectedKind)
    throw new Error(
      expectedKind === "marketing"
        ? "该操作只能在产品营销项目中执行。"
        : "该操作只能在销售机会项目中执行。",
    );
  return project;
}

export async function assertWorkspaceAggregateLink(
  projectId: string,
  aggregateId: string,
  expectedKind: "marketing" | "sales",
  aggregateType:
    | "product"
    | "content"
    | "video"
    | "rfq"
    | "quotation"
    | "lead"
    | "delivery_confirmation",
  actorId: string,
  database: Database = getDatabase(),
) {
  await assertWorkspaceProjectKind(projectId, expectedKind, actorId, database);
  const roles =
    aggregateType === "product"
      ? ["product_source", "product_reference"]
      : aggregateType === "content"
        ? ["marketing_content"]
        : aggregateType === "video"
          ? ["marketing_video"]
          : aggregateType === "rfq"
            ? ["sales_rfq"]
            : aggregateType === "quotation"
              ? ["sales_quotation"]
              : aggregateType === "lead"
                ? ["sales_lead"]
                : aggregateType === "delivery_confirmation"
                  ? ["delivery_confirmation"]
                  : [];
  if (!roles.length) throw new Error("该业务类型尚未定义项目归属规则。");
  const [link] = await database
    .select({ id: workspaceProjectItem.id })
    .from(workspaceProjectItem)
    .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
    .where(
      and(
        eq(workspaceProjectItem.projectId, projectId),
        eq(workspaceProjectItem.aggregateId, aggregateId),
        eq(aggregateRecord.type, aggregateType),
        inArray(workspaceProjectItem.role, roles),
      ),
    );
  if (!link) throw new Error("该记录不属于当前项目。");
}

export async function linkReadyProductToSalesProject(
  projectId: string,
  productId: string,
  actorId: string,
  database: Database = getDatabase(),
) {
  await database.transaction(async (tx) => {
    await assertWorkspaceProjectAccess(projectId, actorId, "write", tx);
    const [project] = await tx
      .select({ kind: workspaceProject.kind })
      .from(workspaceProject)
      .where(eq(workspaceProject.id, projectId))
      .for("update");
    if (project?.kind !== "sales") throw new Error("产品引用只能添加到销售机会项目。");
    const [product] = await tx
      .select({ state: aggregateRecord.state })
      .from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, productId), eq(aggregateRecord.type, "product")))
      .for("update");
    if (product?.state !== "PRODUCT_READY") throw new Error("只能引用已通过 Gate 01 的产品。");
    await tx
      .insert(workspaceProjectItem)
      .values({
        id: randomUUID(),
        projectId,
        aggregateId: productId,
        role: "product_reference",
        relation: "reference",
      })
      .onConflictDoNothing();
    await tx
      .update(workspaceProject)
      .set({ updatedAt: new Date() })
      .where(eq(workspaceProject.id, projectId));
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "workspace_project.ready_product_linked",
      actorType: "human",
      actorId,
      subjectType: "workspace_project",
      subjectId: projectId,
      metadata: { product_id: productId },
      occurredAt: new Date(),
    });
  });
}

export async function listProjectReadyProductReferences(
  projectId: string,
  database: Database = getDatabase(),
): Promise<WorkspaceProductReference[]> {
  const rows = await database
    .select({ id: aggregateRecord.id, payload: aggregateRecord.payload })
    .from(workspaceProjectItem)
    .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
    .where(
      and(
        eq(workspaceProjectItem.projectId, projectId),
        inArray(workspaceProjectItem.role, ["product_source", "product_reference"]),
        eq(aggregateRecord.type, "product"),
        eq(aggregateRecord.state, "PRODUCT_READY"),
      ),
    )
    .orderBy(desc(workspaceProjectItem.createdAt));
  return rows.flatMap((row) => {
    const product = row.payload as unknown as ProductReady;
    const productName = product.product?.product_name;
    const internalSku = product.product?.internal_sku;
    return typeof productName === "string" && typeof internalSku === "string"
      ? [{ id: row.id, productName, internalSku }]
      : [];
  });
}

/** Owner-only lifecycle change; the project row is the business write serialization point. */
export async function changeWorkspaceProjectStatus(
  input: unknown,
  actorId: string,
  database: Database = getDatabase(),
) {
  const value = workspaceProjectStatusChangeSchema.parse(input);
  return database.transaction(async (tx) => {
    await assertWorkspaceProjectAccess(value.projectId, actorId, "manage", tx);
    const [project] = await tx
      .select()
      .from(workspaceProject)
      .where(eq(workspaceProject.id, value.projectId))
      .for("update");
    if (project.status === value.status) return { id: project.id, status: project.status };
    await tx
      .update(workspaceProject)
      .set({ status: value.status, updatedAt: new Date() })
      .where(eq(workspaceProject.id, project.id));
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action:
        value.status === "archived" ? "workspace_project.archived" : "workspace_project.reopened",
      actorType: "human",
      actorId,
      subjectType: "workspace_project",
      subjectId: project.id,
      metadata: { previous_status: project.status, status: value.status },
      occurredAt: new Date(),
    });
    return { id: project.id, status: value.status };
  });
}
