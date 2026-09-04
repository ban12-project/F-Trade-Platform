import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import contentSchema from "@/contracts/content/content.schema.json";
import { compileContract } from "@/lib/contracts/validator";
import { getDatabase } from "@/lib/db/client";
import {
  aggregateRecord,
  approval,
  auditEvent,
  workflowEvent,
  workspaceProject,
  workspaceProjectItem,
  workspaceProjectMember,
} from "@/lib/db/schema";
import type { contentDraftFormSchema, contentReviewFormSchema } from "@/lib/form-schemas";
import type { ProductReady } from "@/lib/product/verification";
import { assertTransition } from "@/lib/workflow/transitions";
import { assertWorkspaceProjectAccess } from "@/lib/workspace/access";

export type ContentDraftInput = z.infer<typeof contentDraftFormSchema>;
export type ContentReviewInput = z.infer<typeof contentReviewFormSchema>;

type ContentStatus = "review_required" | "revision_required" | "approved" | "published";

export type ContentRecord = {
  content_id: string;
  product_id: string;
  content_type: "product" | "factory_capability" | "industry_knowledge";
  objective: string;
  target_customer: string;
  platform: "pending-channel-decision";
  hook: string;
  body: string;
  product_facts: Array<{ field: string; value: string; evidence_ref: string }>;
  call_to_action: string;
  hashtags: string[];
  visual_instruction: string;
  status: ContentStatus;
  approval_ref?: string;
};

export type ReadyProductContentSource = {
  id: string;
  productName: string;
  internalSku: string;
  factOptions: Array<{ path: string; label: string; value: string; evidenceRef: string }>;
};

export type ContentCatalogEntry = {
  id: string;
  state: string;
  createdAt: Date;
  contentType: ContentRecord["content_type"];
  productId: string;
  productName: string;
  hook: string;
  approvalStatus: "pending" | "approved" | "rejected" | null;
};

export type ContentCatalogDetail = ContentCatalogEntry & {
  content: ContentRecord;
  approvalId: string | null;
};

export type ContentCatalogDashboard = {
  total: number;
  pendingReview: number;
  queue: ContentCatalogEntry[];
};
export type ContentCopyCandidate = {
  id: string;
  projectTitle: string;
  productName: string;
  hook: string;
};

const parseContent = compileContract<ContentRecord>(contentSchema);
const forbiddenVisualClaims = [
  "spline",
  "geometry",
  "bolt hole",
  "dimension",
  "friction material",
  "part count",
  "花键",
  "孔位",
  "尺寸",
  "摩擦材料",
  "零件数量",
];

function presentFactOptions(product: ProductReady): ReadyProductContentSource["factOptions"] {
  return (["product", "specifications", "commercial"] as const).flatMap((section) =>
    Object.entries(product[section] ?? {}).flatMap(([field, value]) => {
      const path = `${section}.${field}`;
      const evidenceRef = product.field_evidence[path];
      if (!evidenceRef || value === undefined || value === null || value === "") return [];
      const text = Array.isArray(value) ? value.join(", ") : String(value);
      return [{ path, label: path, value: text, evidenceRef }];
    }),
  );
}

function splitHashtags(value: string) {
  return [
    ...new Set(
      value
        .split(/[\s,，;；]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => (item.startsWith("#") ? item : `#${item}`)),
    ),
  ];
}

export function assertContentVisualInstruction(value: string) {
  const normalized = value.toLowerCase();
  const match = forbiddenVisualClaims.find((term) => normalized.includes(term));
  if (match) throw new Error(`视觉说明不能声称或描绘工程事实：${match}。`);
}

/** Creates a review-only content record from a ProductReady field and its existing evidence. */
export function buildContentDraft(
  input: ContentDraftInput,
  readyProduct: ProductReady,
  contentId: string = randomUUID(),
) {
  if (
    readyProduct.verification_status !== "verified" ||
    readyProduct.record_id !== input.productId
  ) {
    throw new Error("只能引用匹配的已通过 Gate 01 产品。");
  }
  const sourceFact = presentFactOptions(readyProduct).find((fact) => fact.path === input.factPath);
  if (!sourceFact) throw new Error("所选产品字段没有已核验的证据，不能用于内容。");
  const productNameFact = presentFactOptions(readyProduct).find(
    (fact) => fact.path === "product.product_name",
  );
  if (!productNameFact) throw new Error("产品名称缺少已核验的证据，不能用于内容。");
  assertContentVisualInstruction(input.visualInstruction);
  return parseContent({
    content_id: contentId,
    product_id: readyProduct.record_id,
    content_type: input.contentType,
    objective: input.objective,
    target_customer: input.targetCustomer,
    platform: "pending-channel-decision",
    hook: input.hook,
    body: input.body,
    product_facts:
      sourceFact.path === productNameFact.path
        ? [
            {
              field: sourceFact.path,
              value: sourceFact.value,
              evidence_ref: sourceFact.evidenceRef,
            },
          ]
        : [
            {
              field: productNameFact.path,
              value: productNameFact.value,
              evidence_ref: productNameFact.evidenceRef,
            },
            {
              field: sourceFact.path,
              value: sourceFact.value,
              evidence_ref: sourceFact.evidenceRef,
            },
          ],
    call_to_action: input.callToAction,
    hashtags: splitHashtags(input.hashtags),
    visual_instruction: input.visualInstruction,
    status: "review_required",
  });
}

function contentEntry(
  row: typeof aggregateRecord.$inferSelect,
  approvalRow?: Pick<typeof approval.$inferSelect, "id" | "status">,
): ContentCatalogEntry | null {
  const content = row.payload as Partial<ContentRecord>;
  if (
    typeof content.content_id !== "string" ||
    typeof content.product_id !== "string" ||
    typeof content.content_type !== "string" ||
    typeof content.hook !== "string"
  )
    return null;
  const productName =
    content.product_facts?.find((fact) => fact.field === "product.product_name")?.value ??
    "已核验产品";
  return {
    id: row.id,
    state: row.state,
    createdAt: row.createdAt,
    contentType: content.content_type as ContentRecord["content_type"],
    productId: content.product_id,
    productName,
    hook: content.hook,
    approvalStatus: approvalRow?.status ?? null,
  };
}

function readyProductSources(
  rows: Array<typeof aggregateRecord.$inferSelect>,
): ReadyProductContentSource[] {
  return rows.flatMap((row) => {
    const product = row.payload as unknown as ProductReady;
    if (
      product.verification_status !== "verified" ||
      typeof product.product?.product_name !== "string" ||
      typeof product.product?.internal_sku !== "string"
    )
      return [];
    return [
      {
        id: row.id,
        productName: product.product.product_name,
        internalSku: product.product.internal_sku,
        factOptions: presentFactOptions(product),
      },
    ];
  });
}

export async function listReadyProductContentSources(
  projectId?: string,
): Promise<ReadyProductContentSource[]> {
  if (projectId) {
    const rows = await getDatabase()
      .select({ record: aggregateRecord })
      .from(workspaceProjectItem)
      .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
      .where(
        and(
          eq(workspaceProjectItem.projectId, projectId),
          eq(aggregateRecord.type, "product"),
          eq(aggregateRecord.state, "PRODUCT_READY"),
        ),
      )
      .orderBy(desc(workspaceProjectItem.createdAt));
    return readyProductSources(rows.map((row) => row.record));
  }
  return readyProductSources(
    await getDatabase()
      .select()
      .from(aggregateRecord)
      .where(and(eq(aggregateRecord.type, "product"), eq(aggregateRecord.state, "PRODUCT_READY")))
      .orderBy(desc(aggregateRecord.createdAt)),
  );
}

export async function createContentDraft(
  input: ContentDraftInput,
  actorId: string,
  projectId?: string,
) {
  const now = new Date();
  const id = randomUUID();
  const approvalId = randomUUID();
  const eventId = randomUUID();
  return getDatabase().transaction(async (tx) => {
    if (projectId) {
      const [workspace] = await tx
        .select({ kind: workspaceProject.kind })
        .from(workspaceProject)
        .where(eq(workspaceProject.id, projectId))
        .for("update");
      if (!workspace || workspace.kind !== "marketing")
        throw new Error("内容草稿只能关联到产品营销项目。");
      const [productLink] = await tx
        .select({ id: workspaceProjectItem.id })
        .from(workspaceProjectItem)
        .where(
          and(
            eq(workspaceProjectItem.projectId, projectId),
            eq(workspaceProjectItem.aggregateId, input.productId),
          ),
        );
      if (!productLink) throw new Error("只能使用当前营销项目中已核验的产品。");
    }
    const [product] = await tx
      .select({
        id: aggregateRecord.id,
        state: aggregateRecord.state,
        payload: aggregateRecord.payload,
      })
      .from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, input.productId), eq(aggregateRecord.type, "product")))
      .for("update");
    if (!product || product.state !== "PRODUCT_READY")
      throw new Error("只能引用已通过 Gate 01 的产品。");
    const readyProduct = product.payload as unknown as ProductReady;
    const content = buildContentDraft(input, readyProduct, id);
    assertTransition({
      eventId,
      entityType: "content",
      entityId: id,
      fromState: "CONTENT_GENERATING",
      toState: "CONTENT_REVIEW_REQUIRED",
      actorType: "human",
      actorId,
      occurredAt: now.toISOString(),
      evidenceRefs: content.product_facts.map((fact) => fact.evidence_ref),
    });
    await tx
      .insert(aggregateRecord)
      .values({
        id,
        type: "content",
        state: "CONTENT_REVIEW_REQUIRED",
        payload: content,
        createdByType: "human",
        createdById: actorId,
      });
    if (projectId)
      await tx
        .insert(workspaceProjectItem)
        .values({
          id: randomUUID(),
          projectId,
          aggregateId: id,
          role: "marketing_content",
          relation: "owned",
        });
    await tx
      .insert(approval)
      .values({
        id: approvalId,
        aggregateId: id,
        gate: "gate_01_truth",
        status: "pending",
        requestedByType: "human",
        requestedById: actorId,
        requestedAt: now,
      });
    await tx
      .insert(workflowEvent)
      .values({
        id: eventId,
        aggregateId: id,
        fromState: "CONTENT_GENERATING",
        toState: "CONTENT_REVIEW_REQUIRED",
        actorType: "human",
        actorId,
        evidenceRefs: content.product_facts.map((fact) => fact.evidence_ref),
        occurredAt: now,
      });
    await tx
      .insert(auditEvent)
      .values({
        id: randomUUID(),
        action: "content_draft_created",
        actorType: "human",
        actorId,
        aggregateId: id,
        subjectType: "content",
        subjectId: id,
        metadata: { content_type: content.content_type, product_id: product.id },
        occurredAt: now,
      });
    return { id, approvalId, content };
  });
}

export async function listCrossProjectContentCandidates(
  projectId: string,
  actorId: string,
): Promise<ContentCopyCandidate[]> {
  const rows = await getDatabase()
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
        eq(workspaceProjectItem.role, "marketing_content"),
        eq(workspaceProjectItem.relation, "owned"),
        eq(aggregateRecord.type, "content"),
      ),
    )
    .orderBy(desc(workspaceProjectItem.createdAt));
  return rows.flatMap((row) => {
    const parsed = (() => {
      try {
        return parseContent(row.payload);
      } catch {
        return null;
      }
    })();
    if (!parsed) return [];
    return [
      {
        id: row.id,
        projectTitle: row.projectTitle,
        productName:
          parsed.product_facts.find((fact) => fact.field === "product.product_name")?.value ??
          "已核验产品",
        hook: parsed.hook,
      },
    ];
  });
}

export async function copyContentDraftToProject(
  sourceContentId: string,
  projectId: string,
  actorId: string,
) {
  const id = randomUUID();
  const approvalId = randomUUID();
  const eventId = randomUUID();
  const now = new Date();
  return getDatabase().transaction(async (tx) => {
    const [workspace] = await tx
      .select({ kind: workspaceProject.kind })
      .from(workspaceProject)
      .where(eq(workspaceProject.id, projectId))
      .for("update");
    if (!workspace || workspace.kind !== "marketing")
      throw new Error("内容只能复制到产品营销项目。");
    const [source] = await tx
      .select({ payload: aggregateRecord.payload, ownerProjectId: workspaceProjectItem.projectId })
      .from(aggregateRecord)
      .innerJoin(
        workspaceProjectItem,
        and(
          eq(workspaceProjectItem.aggregateId, aggregateRecord.id),
          eq(workspaceProjectItem.role, "marketing_content"),
          eq(workspaceProjectItem.relation, "owned"),
        ),
      )
      .where(and(eq(aggregateRecord.id, sourceContentId), eq(aggregateRecord.type, "content")))
      .for("update");
    if (!source || source.ownerProjectId === projectId)
      throw new Error(source ? "该内容已经属于当前项目。" : "源内容不存在或没有明确归属。");
    await assertWorkspaceProjectAccess(source.ownerProjectId, actorId, "view", tx);
    const current = parseContent(source.payload);
    const [product] = await tx
      .select({ state: aggregateRecord.state })
      .from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, current.product_id), eq(aggregateRecord.type, "product")))
      .for("update");
    if (!product || product.state !== "PRODUCT_READY")
      throw new Error("源内容引用的产品已不再可用于新草稿。");
    await tx
      .insert(workspaceProjectItem)
      .values({
        id: randomUUID(),
        projectId,
        aggregateId: current.product_id,
        role: "product_reference",
        relation: "reference",
      })
      .onConflictDoNothing();
    const content = parseContent({
      ...current,
      content_id: id,
      status: "review_required",
      approval_ref: undefined,
    });
    const evidenceRefs = content.product_facts.map((fact) => fact.evidence_ref);
    assertTransition({
      eventId,
      entityType: "content",
      entityId: id,
      fromState: "CONTENT_GENERATING",
      toState: "CONTENT_REVIEW_REQUIRED",
      actorType: "human",
      actorId,
      occurredAt: now.toISOString(),
      evidenceRefs,
    });
    await tx
      .insert(aggregateRecord)
      .values({
        id,
        type: "content",
        state: "CONTENT_REVIEW_REQUIRED",
        payload: content,
        createdByType: "human",
        createdById: actorId,
      });
    await tx
      .insert(workspaceProjectItem)
      .values({
        id: randomUUID(),
        projectId,
        aggregateId: id,
        role: "marketing_content",
        relation: "owned",
      });
    await tx
      .insert(approval)
      .values({
        id: approvalId,
        aggregateId: id,
        gate: "gate_01_truth",
        status: "pending",
        requestedByType: "human",
        requestedById: actorId,
        requestedAt: now,
      });
    await tx
      .insert(workflowEvent)
      .values({
        id: eventId,
        aggregateId: id,
        fromState: "CONTENT_GENERATING",
        toState: "CONTENT_REVIEW_REQUIRED",
        actorType: "human",
        actorId,
        evidenceRefs,
        occurredAt: now,
      });
    await tx
      .update(workspaceProject)
      .set({ updatedAt: now })
      .where(eq(workspaceProject.id, projectId));
    await tx
      .insert(auditEvent)
      .values({
        id: randomUUID(),
        action: "content_draft.copied_to_project",
        actorType: "human",
        actorId,
        aggregateId: id,
        subjectType: "content",
        subjectId: id,
        metadata: { copied_from: sourceContentId, project_id: projectId },
        occurredAt: now,
      });
    return { id, approvalId, content };
  });
}

async function latestApprovals(rows: Array<typeof aggregateRecord.$inferSelect>) {
  if (rows.length === 0)
    return new Map<string, { id: string; status: "pending" | "approved" | "rejected" }>();
  const approvalRows = await getDatabase()
    .select({ id: approval.id, aggregateId: approval.aggregateId, status: approval.status })
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
    .orderBy(desc(approval.requestedAt), desc(approval.createdAt));
  const results = new Map<string, (typeof approvalRows)[number]>();
  for (const row of approvalRows)
    if (!results.has(row.aggregateId)) results.set(row.aggregateId, row);
  return results;
}

export async function listContentCatalogEntries(limit = 50) {
  const rows = await getDatabase()
    .select()
    .from(aggregateRecord)
    .where(eq(aggregateRecord.type, "content"))
    .orderBy(desc(aggregateRecord.createdAt))
    .limit(limit);
  const approvals = await latestApprovals(rows);
  return rows.flatMap((row) => {
    const entry = contentEntry(row, approvals.get(row.id));
    return entry ? [entry] : [];
  });
}

export async function listProjectContentCatalogEntries(projectId: string, limit = 50) {
  const rows = await getDatabase()
    .select({ record: aggregateRecord })
    .from(workspaceProjectItem)
    .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
    .where(
      and(
        eq(workspaceProjectItem.projectId, projectId),
        eq(workspaceProjectItem.role, "marketing_content"),
        eq(workspaceProjectItem.relation, "owned"),
        eq(aggregateRecord.type, "content"),
      ),
    )
    .orderBy(desc(workspaceProjectItem.createdAt))
    .limit(limit);
  const records = rows.map((row) => row.record);
  const approvals = await latestApprovals(records);
  return records.flatMap((row) => {
    const entry = contentEntry(row, approvals.get(row.id));
    return entry ? [entry] : [];
  });
}

export async function getContentCatalogDashboard(queueLimit = 6): Promise<ContentCatalogDashboard> {
  const database = getDatabase();
  const [totalRows, pendingReviewRows, queueRows] = await Promise.all([
    database
      .select({ count: sql<number>`count(*)` })
      .from(aggregateRecord)
      .where(eq(aggregateRecord.type, "content")),
    database
      .select({ count: sql<number>`count(*)` })
      .from(aggregateRecord)
      .where(
        and(
          eq(aggregateRecord.type, "content"),
          eq(aggregateRecord.state, "CONTENT_REVIEW_REQUIRED"),
        ),
      ),
    database
      .select()
      .from(aggregateRecord)
      .where(
        and(
          eq(aggregateRecord.type, "content"),
          inArray(aggregateRecord.state, ["CONTENT_REVIEW_REQUIRED", "CONTENT_REVISION_REQUIRED"]),
        ),
      )
      .orderBy(desc(aggregateRecord.createdAt))
      .limit(queueLimit),
  ]);
  const approvals = await latestApprovals(queueRows);

  return {
    total: Number(totalRows[0]?.count ?? 0),
    pendingReview: Number(pendingReviewRows[0]?.count ?? 0),
    queue: queueRows.flatMap((row) => {
      const entry = contentEntry(row, approvals.get(row.id));
      return entry ? [entry] : [];
    }),
  };
}

export async function getContentCatalogDetail(
  contentId: string,
): Promise<ContentCatalogDetail | null> {
  const database = getDatabase();
  const [row] = await database
    .select()
    .from(aggregateRecord)
    .where(and(eq(aggregateRecord.id, contentId), eq(aggregateRecord.type, "content")))
    .limit(1);
  if (!row) return null;
  const [approvalRow] = await database
    .select({ id: approval.id, status: approval.status })
    .from(approval)
    .where(and(eq(approval.aggregateId, contentId), eq(approval.gate, "gate_01_truth")))
    .orderBy(desc(approval.requestedAt), desc(approval.createdAt))
    .limit(1);
  const entry = contentEntry(row, approvalRow);
  return entry
    ? { ...entry, content: row.payload as ContentRecord, approvalId: approvalRow?.id ?? null }
    : null;
}

export async function getProjectContentCatalogDetail(
  projectId: string,
  contentId: string,
): Promise<ContentCatalogDetail | null> {
  const [link] = await getDatabase()
    .select({ id: workspaceProjectItem.id })
    .from(workspaceProjectItem)
    .where(
      and(
        eq(workspaceProjectItem.projectId, projectId),
        eq(workspaceProjectItem.aggregateId, contentId),
      ),
    );
  return link ? getContentCatalogDetail(contentId) : null;
}

export async function decideContentReview(input: ContentReviewInput, actorId: string) {
  const now = new Date();
  const eventId = randomUUID();
  return getDatabase().transaction(async (tx) => {
    const [aggregate] = await tx
      .select({
        id: aggregateRecord.id,
        state: aggregateRecord.state,
        version: aggregateRecord.version,
        payload: aggregateRecord.payload,
      })
      .from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, input.contentId), eq(aggregateRecord.type, "content")))
      .for("update");
    if (!aggregate || aggregate.state !== "CONTENT_REVIEW_REQUIRED")
      throw new Error("该内容当前不处于待审核状态。");
    const [pendingApproval] = await tx
      .select()
      .from(approval)
      .where(
        and(
          eq(approval.aggregateId, aggregate.id),
          eq(approval.gate, "gate_01_truth"),
          eq(approval.status, "pending"),
        ),
      )
      .for("update");
    if (!pendingApproval) throw new Error("未找到待处理的 Gate 01 内容审核请求。");
    const nextState =
      input.decision === "approved" ? "CONTENT_APPROVED" : "CONTENT_REVISION_REQUIRED";
    const content = parseContent({
      ...(aggregate.payload as ContentRecord),
      status: input.decision === "approved" ? "approved" : "revision_required",
      ...(input.decision === "approved" ? { approval_ref: pendingApproval.id } : {}),
    });
    assertTransition(
      {
        eventId,
        entityType: "content",
        entityId: aggregate.id,
        fromState: "CONTENT_REVIEW_REQUIRED",
        toState: nextState,
        actorType: "human",
        actorId,
        occurredAt: now.toISOString(),
        evidenceRefs: [input.evidenceRef],
        gate: "gate_01_truth",
        approvalRef: pendingApproval.id,
      },
      {
        id: pendingApproval.id,
        aggregateId: aggregate.id,
        gate: "gate_01_truth",
        status: input.decision,
        decidedByType: "human",
        decidedById: actorId,
        evidenceRef: input.evidenceRef,
      },
    );
    await tx
      .update(approval)
      .set({
        status: input.decision,
        decidedByType: "human",
        decidedById: actorId,
        decidedAt: now,
        evidenceRef: input.evidenceRef,
        ...(input.notes ? { notes: input.notes } : {}),
      })
      .where(eq(approval.id, pendingApproval.id));
    const [updated] = await tx
      .update(aggregateRecord)
      .set({ state: nextState, payload: content, version: sql`${aggregateRecord.version} + 1` })
      .where(
        and(eq(aggregateRecord.id, aggregate.id), eq(aggregateRecord.version, aggregate.version)),
      )
      .returning({ id: aggregateRecord.id });
    if (!updated) throw new Error("内容审核与另一项操作冲突，请刷新后重试。");
    await tx
      .insert(workflowEvent)
      .values({
        id: eventId,
        aggregateId: aggregate.id,
        fromState: "CONTENT_REVIEW_REQUIRED",
        toState: nextState,
        actorType: "human",
        actorId,
        gate: "gate_01_truth",
        approvalId: pendingApproval.id,
        evidenceRefs: [input.evidenceRef],
        occurredAt: now,
      });
    await tx
      .insert(auditEvent)
      .values({
        id: randomUUID(),
        action: "content_gate_01_decided",
        actorType: "human",
        actorId,
        aggregateId: aggregate.id,
        subjectType: "content",
        subjectId: aggregate.id,
        metadata: { decision: input.decision, approval_id: pendingApproval.id },
        occurredAt: now,
      });
    return { state: nextState, approvalId: pendingApproval.id };
  });
}

export async function reviseContentDraft(
  contentId: string,
  input: ContentDraftInput,
  actorId: string,
) {
  const now = new Date();
  const eventId = randomUUID();
  const approvalId = randomUUID();
  return getDatabase().transaction(async (tx) => {
    const [aggregate] = await tx
      .select({
        id: aggregateRecord.id,
        state: aggregateRecord.state,
        version: aggregateRecord.version,
        payload: aggregateRecord.payload,
      })
      .from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, contentId), eq(aggregateRecord.type, "content")))
      .for("update");
    if (!aggregate || aggregate.state !== "CONTENT_REVISION_REQUIRED")
      throw new Error("该内容当前不处于待修订状态。");
    const currentContent = aggregate.payload as ContentRecord;
    if (input.productId !== currentContent.product_id)
      throw new Error("修订不能改写内容所引用的产品。请另建内容草稿。");
    const [product] = await tx
      .select({ state: aggregateRecord.state, payload: aggregateRecord.payload })
      .from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, input.productId), eq(aggregateRecord.type, "product")))
      .for("update");
    if (!product || product.state !== "PRODUCT_READY")
      throw new Error("引用产品不再处于 Product Ready，不能重新送审。");
    const content = buildContentDraft(input, product.payload as unknown as ProductReady, contentId);
    assertTransition({
      eventId,
      entityType: "content",
      entityId: contentId,
      fromState: "CONTENT_REVISION_REQUIRED",
      toState: "CONTENT_REVIEW_REQUIRED",
      actorType: "human",
      actorId,
      occurredAt: now.toISOString(),
      evidenceRefs: content.product_facts.map((fact) => fact.evidence_ref),
    });
    const [updated] = await tx
      .update(aggregateRecord)
      .set({
        state: "CONTENT_REVIEW_REQUIRED",
        payload: content,
        version: sql`${aggregateRecord.version} + 1`,
      })
      .where(
        and(eq(aggregateRecord.id, aggregate.id), eq(aggregateRecord.version, aggregate.version)),
      )
      .returning({ id: aggregateRecord.id });
    if (!updated) throw new Error("内容修订与另一项操作冲突，请刷新后重试。");
    await tx
      .insert(approval)
      .values({
        id: approvalId,
        aggregateId: contentId,
        gate: "gate_01_truth",
        status: "pending",
        requestedByType: "human",
        requestedById: actorId,
        requestedAt: now,
      });
    await tx
      .insert(workflowEvent)
      .values({
        id: eventId,
        aggregateId: contentId,
        fromState: "CONTENT_REVISION_REQUIRED",
        toState: "CONTENT_REVIEW_REQUIRED",
        actorType: "human",
        actorId,
        evidenceRefs: content.product_facts.map((fact) => fact.evidence_ref),
        occurredAt: now,
      });
    await tx
      .insert(auditEvent)
      .values({
        id: randomUUID(),
        action: "content_draft_revised",
        actorType: "human",
        actorId,
        aggregateId: contentId,
        subjectType: "content",
        subjectId: contentId,
        metadata: { approval_id: approvalId, content_type: content.content_type },
        occurredAt: now,
      });
    return { approvalId, content };
  });
}
