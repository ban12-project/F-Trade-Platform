import { randomUUID } from "node:crypto";

import { and, desc, eq, type InferInsertModel, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { getDatabase } from "@/lib/db/client";
import {
  aggregateRecord,
  approval,
  auditEvent,
  workflowEvent,
  workspaceProject,
  workspaceProjectItem,
} from "@/lib/db/schema";
import type { productCatalogFormSchema, productReviewFormSchema } from "@/lib/form-schemas";
import type { ProductApproval, ProductDraft } from "@/lib/product/verification";
import {
  approveProductDraft,
  rejectProductDraft,
  reviewProductDraft,
} from "@/lib/product/verification";
import { assertTransition } from "@/lib/workflow/transitions";

export type ProductCatalogInput = z.infer<typeof productCatalogFormSchema>;
export type ProductReviewInput = z.infer<typeof productReviewFormSchema>;

export type ProductCatalogEntry = {
  id: string;
  state: string;
  createdAt: Date;
  productName: string;
  internalSku: string;
  productType: string;
  verificationStatus: string;
  blockingFields: string[];
  approvalStatus: "pending" | "approved" | "rejected" | null;
};

export type ProductCatalogDetail = ProductCatalogEntry & {
  draft: ProductDraft;
  approvalId: string | null;
};

export type ProductCatalogDashboard = {
  total: number;
  pendingReview: number;
  ready: number;
  queue: ProductCatalogEntry[];
};

function optionalText(value: string) {
  const normalized = value.trim();
  return normalized || undefined;
}

function optionalNumber(value: string) {
  const normalized = optionalText(value);
  return normalized === undefined ? undefined : Number(normalized);
}

function splitOeNumbers(value: string) {
  const numbers = value
    .split(/[\n,;，；]/)
    .map((number) => number.trim())
    .filter(Boolean);
  return numbers.length > 0 ? [...new Set(numbers)] : undefined;
}

function evidenceForPresentFields(
  draft: Omit<ProductDraft, "field_evidence">,
  evidenceRef: string,
) {
  return Object.fromEntries(
    (["product", "specifications", "commercial"] as const).flatMap((section) =>
      Object.entries(draft[section] ?? {})
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([field]) => [`${section}.${field}`, evidenceRef]),
    ),
  );
}

/** Builds a review-only draft. It intentionally cannot produce ProductReady. */
export function buildProductCatalogDraft(
  input: ProductCatalogInput,
  recordId: string = randomUUID(),
): ProductDraft {
  const product = {
    product_name: input.productName.trim(),
    product_type: input.productType,
    internal_sku: input.internalSku.trim(),
    ...(splitOeNumbers(input.oeNumbers) ? { oe_numbers: splitOeNumbers(input.oeNumbers) } : {}),
    ...(optionalText(input.application) ? { application: optionalText(input.application) } : {}),
    ...(optionalText(input.vehicleBrand)
      ? { vehicle_brand: optionalText(input.vehicleBrand) }
      : {}),
    ...(optionalText(input.vehicleModel)
      ? { vehicle_model: optionalText(input.vehicleModel) }
      : {}),
  };
  const specifications = {
    ...(optionalNumber(input.clutchDiameterMm)
      ? { clutch_diameter_mm: optionalNumber(input.clutchDiameterMm) }
      : {}),
    ...(optionalNumber(input.splineCount)
      ? { spline_count: optionalNumber(input.splineCount) }
      : {}),
    ...(optionalText(input.splineSize) ? { spline_size: optionalText(input.splineSize) } : {}),
    ...(optionalText(input.frictionMaterial)
      ? { friction_material: optionalText(input.frictionMaterial) }
      : {}),
  };
  const partialDraft = {
    record_id: recordId,
    source_ref: input.sourceRef,
    evidence_refs: [input.evidenceRef],
    verification_status: "review_required" as const,
    blocking_missing_fields: [],
    optional_missing_fields: [],
    product,
    ...(Object.keys(specifications).length > 0 ? { specifications } : {}),
  };
  return reviewProductDraft({
    ...partialDraft,
    field_evidence: evidenceForPresentFields(partialDraft, input.evidenceRef),
  });
}

export async function createProductCatalogDraft(
  input: ProductCatalogInput,
  actorId: string,
  projectId?: string,
) {
  const id = randomUUID();
  const draft = buildProductCatalogDraft(input, id);
  const now = new Date();
  const workflowEventId = randomUUID();
  const approvalId = randomUUID();
  assertTransition({
    eventId: workflowEventId,
    entityType: "product",
    entityId: id,
    fromState: "PRODUCT_IMPORTED",
    toState: "PRODUCT_REVIEW_REQUIRED",
    actorType: "human",
    actorId,
    occurredAt: now.toISOString(),
    evidenceRefs: draft.evidence_refs,
  });

  const database = getDatabase();
  const aggregateValues: InferInsertModel<typeof aggregateRecord> = {
    id,
    type: "product",
    state: "PRODUCT_REVIEW_REQUIRED",
    payload: draft as unknown as Record<string, unknown>,
    createdByType: "human",
    createdById: actorId,
  };
  const workflowValues: InferInsertModel<typeof workflowEvent> = {
    id: workflowEventId,
    aggregateId: id,
    fromState: "PRODUCT_IMPORTED",
    toState: "PRODUCT_REVIEW_REQUIRED",
    actorType: "human",
    actorId,
    evidenceRefs: draft.evidence_refs,
    occurredAt: now,
  };
  const approvalValues: InferInsertModel<typeof approval> = {
    id: approvalId,
    aggregateId: id,
    gate: "gate_01_truth",
    status: "pending",
    requestedByType: "human",
    requestedById: actorId,
    requestedAt: now,
  };
  const auditValues: InferInsertModel<typeof auditEvent> = {
    id: randomUUID(),
    action: "product_draft_created",
    actorType: "human",
    actorId,
    aggregateId: id,
    subjectType: "product",
    subjectId: id,
    metadata: {
      verification_status: draft.verification_status,
      blocking_field_count: draft.blocking_missing_fields.length,
    },
    occurredAt: now,
  };
  await database.transaction(async (tx) => {
    if (projectId) {
      const [project] = await tx
        .select({ kind: workspaceProject.kind })
        .from(workspaceProject)
        .where(eq(workspaceProject.id, projectId))
        .for("update");
      if (!project || project.kind !== "marketing")
        throw new Error("产品草稿只能关联到产品营销项目。");
    }
    await tx.insert(aggregateRecord).values(aggregateValues);
    if (projectId)
      await tx.insert(workspaceProjectItem).values({
        id: randomUUID(),
        projectId,
        aggregateId: id,
        role: "product_source",
        relation: "owned",
      });
    await tx.insert(approval).values(approvalValues);
    await tx.insert(workflowEvent).values(workflowValues);
    await tx.insert(auditEvent).values(auditValues);
  });

  return { id, draft, approvalId };
}

/** Persists a Product Agent result as review-only work; callers must never promote it to Ready. */
export async function createProductAgentDraft(
  draft: ProductDraft,
  actorId: string,
  metadata: Record<string, unknown>,
  projectId?: string,
) {
  if (draft.verification_status !== "review_required")
    throw new Error("Product Agent output must require Gate 01 review.");
  const id = draft.record_id;
  const now = new Date();
  const approvalId = randomUUID();
  const eventId = randomUUID();
  assertTransition({
    eventId,
    entityType: "product",
    entityId: id,
    fromState: "PRODUCT_IMPORTED",
    toState: "PRODUCT_REVIEW_REQUIRED",
    actorType: "agent",
    actorId: "product_agent",
    occurredAt: now.toISOString(),
    evidenceRefs: draft.evidence_refs,
  });
  await getDatabase().transaction(async (tx) => {
    if (projectId) {
      const [project] = await tx
        .select({ kind: workspaceProject.kind })
        .from(workspaceProject)
        .where(eq(workspaceProject.id, projectId))
        .for("update");
      if (!project || project.kind !== "marketing")
        throw new Error("Product Agent 草稿只能关联到产品营销项目。");
    }
    await tx.insert(aggregateRecord).values({
      id,
      type: "product",
      state: "PRODUCT_REVIEW_REQUIRED",
      payload: draft as unknown as Record<string, unknown>,
      createdByType: "agent",
      createdById: "product_agent",
    });
    if (projectId)
      await tx.insert(workspaceProjectItem).values({
        id: randomUUID(),
        projectId,
        aggregateId: id,
        role: "product_source",
        relation: "owned",
      });
    await tx.insert(approval).values({
      id: approvalId,
      aggregateId: id,
      gate: "gate_01_truth",
      status: "pending",
      requestedByType: "human",
      requestedById: actorId,
      requestedAt: now,
    });
    await tx.insert(workflowEvent).values({
      id: eventId,
      aggregateId: id,
      fromState: "PRODUCT_IMPORTED",
      toState: "PRODUCT_REVIEW_REQUIRED",
      actorType: "agent",
      actorId: "product_agent",
      evidenceRefs: draft.evidence_refs,
      occurredAt: now,
    });
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "product_agent_draft_created",
      actorType: "agent",
      actorId: "product_agent",
      aggregateId: id,
      subjectType: "product",
      subjectId: id,
      metadata: {
        ...metadata,
        requested_by: actorId,
        blocking_field_count: draft.blocking_missing_fields.length,
      },
      occurredAt: now,
    });
  });
  return { id, approvalId, draft };
}

export function productCatalogDisplayIdentity(product: ProductDraft["product"] | undefined) {
  return {
    productName:
      typeof product?.product_name === "string" ? product.product_name : "未填写产品名称",
    internalSku:
      typeof product?.internal_sku === "string" ? product.internal_sku : "未填写产品编号",
  };
}

function catalogEntry(
  row: typeof aggregateRecord.$inferSelect,
  approvalRow?: Pick<typeof approval.$inferSelect, "id" | "status">,
): ProductCatalogEntry {
  const payload = row.payload as Partial<ProductDraft>;
  const product = payload.product ?? {};
  const identity = productCatalogDisplayIdentity(payload.product);
  return {
    id: row.id,
    state: row.state,
    createdAt: row.createdAt,
    ...identity,
    productType: typeof product.product_type === "string" ? product.product_type : "unknown",
    verificationStatus:
      typeof payload.verification_status === "string"
        ? payload.verification_status
        : "review_required",
    blockingFields: Array.isArray(payload.blocking_missing_fields)
      ? payload.blocking_missing_fields.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    approvalStatus: approvalRow?.status ?? null,
  };
}

async function catalogEntriesForRows(rows: Array<typeof aggregateRecord.$inferSelect>) {
  const database = getDatabase();
  const approvalRows =
    rows.length === 0
      ? []
      : await database
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
  const approvalsByAggregate = new Map<string, (typeof approvalRows)[number]>();
  for (const approvalRow of approvalRows) {
    if (!approvalsByAggregate.has(approvalRow.aggregateId)) {
      approvalsByAggregate.set(approvalRow.aggregateId, approvalRow);
    }
  }
  return rows.map((row) => catalogEntry(row, approvalsByAggregate.get(row.id)));
}

export async function listProductCatalogEntries(limit = 50) {
  const rows = await getDatabase()
    .select()
    .from(aggregateRecord)
    .where(eq(aggregateRecord.type, "product"))
    .orderBy(desc(aggregateRecord.createdAt))
    .limit(limit);
  return catalogEntriesForRows(rows);
}

export async function listProjectProductCatalogEntries(projectId: string, limit = 50) {
  const rows = await getDatabase()
    .select({ record: aggregateRecord })
    .from(workspaceProjectItem)
    .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
    .where(and(eq(workspaceProjectItem.projectId, projectId), eq(aggregateRecord.type, "product")))
    .orderBy(desc(workspaceProjectItem.createdAt))
    .limit(limit);
  return catalogEntriesForRows(rows.map((row) => row.record));
}

export async function getProductCatalogDashboard(queueLimit = 6): Promise<ProductCatalogDashboard> {
  const database = getDatabase();
  const [totalRows, pendingReviewRows, readyRows, queueRows] = await Promise.all([
    database
      .select({ count: sql<number>`count(*)` })
      .from(aggregateRecord)
      .where(eq(aggregateRecord.type, "product")),
    database
      .select({ count: sql<number>`count(*)` })
      .from(aggregateRecord)
      .where(
        and(
          eq(aggregateRecord.type, "product"),
          eq(aggregateRecord.state, "PRODUCT_REVIEW_REQUIRED"),
        ),
      ),
    database
      .select({ count: sql<number>`count(*)` })
      .from(aggregateRecord)
      .where(and(eq(aggregateRecord.type, "product"), eq(aggregateRecord.state, "PRODUCT_READY"))),
    database
      .select()
      .from(aggregateRecord)
      .where(
        and(
          eq(aggregateRecord.type, "product"),
          inArray(aggregateRecord.state, ["PRODUCT_REVIEW_REQUIRED", "PRODUCT_REVISION_REQUIRED"]),
        ),
      )
      .orderBy(desc(aggregateRecord.createdAt))
      .limit(queueLimit),
  ]);

  return {
    total: Number(totalRows[0]?.count ?? 0),
    pendingReview: Number(pendingReviewRows[0]?.count ?? 0),
    ready: Number(readyRows[0]?.count ?? 0),
    queue: await catalogEntriesForRows(queueRows),
  };
}

export async function getProductCatalogDetail(
  productId: string,
): Promise<ProductCatalogDetail | null> {
  const database = getDatabase();
  const [row] = await database
    .select()
    .from(aggregateRecord)
    .where(and(eq(aggregateRecord.id, productId), eq(aggregateRecord.type, "product")))
    .limit(1);
  if (!row) return null;
  const [approvalRow] = await database
    .select({ id: approval.id, status: approval.status })
    .from(approval)
    .where(and(eq(approval.aggregateId, productId), eq(approval.gate, "gate_01_truth")))
    .orderBy(desc(approval.requestedAt), desc(approval.createdAt))
    .limit(1);
  const entry = catalogEntry(row, approvalRow);
  return {
    ...entry,
    draft: row.payload as unknown as ProductDraft,
    approvalId: approvalRow?.id ?? null,
  };
}

export async function getProjectProductCatalogDetail(
  projectId: string,
  productId: string,
): Promise<ProductCatalogDetail | null> {
  const [link] = await getDatabase()
    .select({ id: workspaceProjectItem.id })
    .from(workspaceProjectItem)
    .where(
      and(
        eq(workspaceProjectItem.projectId, projectId),
        eq(workspaceProjectItem.aggregateId, productId),
      ),
    );
  return link ? getProductCatalogDetail(productId) : null;
}

export async function decideProductCatalogReview(input: ProductReviewInput, actorId: string) {
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
      .where(and(eq(aggregateRecord.id, input.productId), eq(aggregateRecord.type, "product")))
      .for("update");
    if (!aggregate) throw new Error("产品草稿不存在。");
    if (aggregate.state !== "PRODUCT_REVIEW_REQUIRED")
      throw new Error("该产品当前不处于待审核状态。");

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
    if (!pendingApproval) throw new Error("未找到待处理的 Gate 01 审核请求。");

    const productApproval: ProductApproval = {
      approval_id: pendingApproval.id,
      gate: "gate_01_truth",
      entity_type: "product",
      entity_id: aggregate.id,
      status: input.decision,
      decision: {
        actor_type: "human",
        decided_by: actorId,
        decided_at: now.toISOString(),
        evidence_ref: input.evidenceRef,
        ...(input.notes ? { notes: input.notes } : {}),
      },
    };
    const draft = aggregate.payload as unknown as ProductDraft;
    const payload =
      input.decision === "approved"
        ? approveProductDraft(draft, productApproval)
        : rejectProductDraft(draft, productApproval);
    const nextState = input.decision === "approved" ? "PRODUCT_READY" : "PRODUCT_REVISION_REQUIRED";
    assertTransition(
      {
        eventId,
        entityType: "product",
        entityId: aggregate.id,
        fromState: "PRODUCT_REVIEW_REQUIRED",
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
      .set({
        state: nextState,
        payload: payload as unknown as Record<string, unknown>,
        version: sql`${aggregateRecord.version} + 1`,
      })
      .where(
        and(eq(aggregateRecord.id, aggregate.id), eq(aggregateRecord.version, aggregate.version)),
      )
      .returning({ id: aggregateRecord.id });
    if (!updated) throw new Error("产品审核与另一项操作冲突，请刷新后重试。");
    await tx.insert(workflowEvent).values({
      id: eventId,
      aggregateId: aggregate.id,
      fromState: "PRODUCT_REVIEW_REQUIRED",
      toState: nextState,
      actorType: "human",
      actorId,
      gate: "gate_01_truth",
      approvalId: pendingApproval.id,
      evidenceRefs: [input.evidenceRef],
      occurredAt: now,
    });
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "product_gate_01_decided",
      actorType: "human",
      actorId,
      aggregateId: aggregate.id,
      subjectType: "product",
      subjectId: aggregate.id,
      metadata: { decision: input.decision, approval_id: pendingApproval.id },
      occurredAt: now,
    });
    return { state: nextState, approvalId: pendingApproval.id };
  });
}

export async function reviseProductCatalogDraft(
  productId: string,
  input: ProductCatalogInput,
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
      })
      .from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, productId), eq(aggregateRecord.type, "product")))
      .for("update");
    if (!aggregate) throw new Error("产品草稿不存在。");
    if (aggregate.state !== "PRODUCT_REVISION_REQUIRED")
      throw new Error("该产品当前不处于待修订状态。");

    const draft = buildProductCatalogDraft(input, productId);
    assertTransition({
      eventId,
      entityType: "product",
      entityId: productId,
      fromState: "PRODUCT_REVISION_REQUIRED",
      toState: "PRODUCT_REVIEW_REQUIRED",
      actorType: "human",
      actorId,
      occurredAt: now.toISOString(),
      evidenceRefs: draft.evidence_refs,
    });
    const [updated] = await tx
      .update(aggregateRecord)
      .set({
        state: "PRODUCT_REVIEW_REQUIRED",
        payload: draft as unknown as Record<string, unknown>,
        version: sql`${aggregateRecord.version} + 1`,
      })
      .where(
        and(eq(aggregateRecord.id, aggregate.id), eq(aggregateRecord.version, aggregate.version)),
      )
      .returning({ id: aggregateRecord.id });
    if (!updated) throw new Error("产品修订与另一项操作冲突，请刷新后重试。");
    await tx.insert(approval).values({
      id: approvalId,
      aggregateId: productId,
      gate: "gate_01_truth",
      status: "pending",
      requestedByType: "human",
      requestedById: actorId,
      requestedAt: now,
    });
    await tx.insert(workflowEvent).values({
      id: eventId,
      aggregateId: productId,
      fromState: "PRODUCT_REVISION_REQUIRED",
      toState: "PRODUCT_REVIEW_REQUIRED",
      actorType: "human",
      actorId,
      evidenceRefs: draft.evidence_refs,
      occurredAt: now,
    });
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "product_draft_revised",
      actorType: "human",
      actorId,
      aggregateId: productId,
      subjectType: "product",
      subjectId: productId,
      metadata: {
        approval_id: approvalId,
        blocking_field_count: draft.blocking_missing_fields.length,
      },
      occurredAt: now,
    });
    return { approvalId, draft };
  });
}
