import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, sql, type InferInsertModel } from "drizzle-orm";

import { getDatabase } from "@/lib/db/client";
import { aggregateRecord, approval, auditEvent, workflowEvent, workspaceProject, workspaceProjectItem } from "@/lib/db/schema";
import { assertTransition } from "@/lib/workflow/transitions";

import { productCatalogFormSchema, type ProductCatalogForm } from "./catalog-form-schema";
import { reviewProductDraft, type ProductDraft } from "./verification";

export type EvidenceBoundProductCatalogInput = ProductCatalogForm;

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

function fieldEvidence(input: EvidenceBoundProductCatalogInput) {
  const entries: Array<[string, unknown, string]> = [
    ["product.product_name", input.productName, input.productNameEvidenceRef],
    ["product.product_type", input.productType, input.productTypeEvidenceRef],
    ["product.internal_sku", input.internalSku, input.internalSkuEvidenceRef],
    ["product.oe_numbers", splitOeNumbers(input.oeNumbers), input.oeNumbersEvidenceRef],
    ["product.application", optionalText(input.application), input.applicationEvidenceRef],
    ["product.vehicle_brand", optionalText(input.vehicleBrand), input.vehicleBrandEvidenceRef],
    ["product.vehicle_model", optionalText(input.vehicleModel), input.vehicleModelEvidenceRef],
    ["specifications.clutch_diameter_mm", optionalNumber(input.clutchDiameterMm), input.clutchDiameterMmEvidenceRef],
    ["specifications.spline_count", optionalNumber(input.splineCount), input.splineCountEvidenceRef],
    ["specifications.spline_size", optionalText(input.splineSize), input.splineSizeEvidenceRef],
    ["specifications.friction_material", optionalText(input.frictionMaterial), input.frictionMaterialEvidenceRef],
  ];
  return Object.fromEntries(entries.flatMap(([path, value, evidenceRef]) =>
    value === undefined || value === null || value === "" ? [] : [[path, evidenceRef]],
  ));
}

/** Builds a review-only manual draft without copying one evidence ref to every fact. */
export function buildEvidenceBoundProductCatalogDraft(
  inputValue: unknown,
  recordId: string = randomUUID(),
): ProductDraft {
  const input = productCatalogFormSchema.parse(inputValue);
  const product = {
    product_name: input.productName,
    product_type: input.productType,
    internal_sku: input.internalSku,
    ...(splitOeNumbers(input.oeNumbers) ? { oe_numbers: splitOeNumbers(input.oeNumbers) } : {}),
    ...(optionalText(input.application) ? { application: optionalText(input.application) } : {}),
    ...(optionalText(input.vehicleBrand) ? { vehicle_brand: optionalText(input.vehicleBrand) } : {}),
    ...(optionalText(input.vehicleModel) ? { vehicle_model: optionalText(input.vehicleModel) } : {}),
  };
  const specifications = {
    ...(optionalNumber(input.clutchDiameterMm) ? { clutch_diameter_mm: optionalNumber(input.clutchDiameterMm) } : {}),
    ...(optionalNumber(input.splineCount) ? { spline_count: optionalNumber(input.splineCount) } : {}),
    ...(optionalText(input.splineSize) ? { spline_size: optionalText(input.splineSize) } : {}),
    ...(optionalText(input.frictionMaterial) ? { friction_material: optionalText(input.frictionMaterial) } : {}),
  };
  const explicitEvidence = fieldEvidence(input);
  const evidenceRefs = [...new Set(Object.values(explicitEvidence))];
  return reviewProductDraft({
    record_id: recordId,
    source_ref: input.sourceRef,
    evidence_refs: evidenceRefs,
    field_evidence: explicitEvidence,
    verification_status: "review_required",
    blocking_missing_fields: [],
    optional_missing_fields: [],
    product,
    ...(Object.keys(specifications).length > 0 ? { specifications } : {}),
  });
}

export async function createEvidenceBoundProductCatalogDraft(
  inputValue: unknown,
  actorId: string,
  projectId?: string,
) {
  const input = productCatalogFormSchema.parse(inputValue);
  const id = randomUUID();
  const draft = buildEvidenceBoundProductCatalogDraft(input, id);
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
      field_evidence_count: Object.keys(draft.field_evidence).length,
      evidence_ref_count: draft.evidence_refs.length,
      evidence_mode: "per_field",
    },
    occurredAt: now,
  };

  await getDatabase().transaction(async (tx) => {
    if (projectId) {
      const [project] = await tx.select({ kind: workspaceProject.kind, status: workspaceProject.status })
        .from(workspaceProject)
        .where(eq(workspaceProject.id, projectId))
        .for("update");
      if (!project || project.kind !== "marketing" || project.status !== "active") {
        throw new Error("产品草稿只能关联到进行中的产品营销项目。");
      }
    }
    await tx.insert(aggregateRecord).values(aggregateValues);
    if (projectId) await tx.insert(workspaceProjectItem).values({
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

export async function reviseEvidenceBoundProductCatalogDraft(
  productId: string,
  inputValue: unknown,
  actorId: string,
) {
  const input = productCatalogFormSchema.parse(inputValue);
  const now = new Date();
  const eventId = randomUUID();
  const approvalId = randomUUID();
  return getDatabase().transaction(async (tx) => {
    const [aggregate] = await tx.select({
      id: aggregateRecord.id,
      state: aggregateRecord.state,
      version: aggregateRecord.version,
    }).from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, productId), eq(aggregateRecord.type, "product")))
      .for("update");
    if (!aggregate) throw new Error("产品草稿不存在。");
    if (aggregate.state !== "PRODUCT_REVISION_REQUIRED") throw new Error("该产品当前不处于待修订状态。");

    const draft = buildEvidenceBoundProductCatalogDraft(input, productId);
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
    const [updated] = await tx.update(aggregateRecord).set({
      state: "PRODUCT_REVIEW_REQUIRED",
      payload: draft as unknown as Record<string, unknown>,
      version: sql`${aggregateRecord.version} + 1`,
    }).where(and(eq(aggregateRecord.id, aggregate.id), eq(aggregateRecord.version, aggregate.version)))
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
        field_evidence_count: Object.keys(draft.field_evidence).length,
        evidence_ref_count: draft.evidence_refs.length,
        evidence_mode: "per_field",
      },
      occurredAt: now,
    });
    return { approvalId, draft };
  });
}
