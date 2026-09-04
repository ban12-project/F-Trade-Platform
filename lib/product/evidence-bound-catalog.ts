import { randomUUID } from "node:crypto";

import { and, eq, sql, type InferInsertModel } from "drizzle-orm";

import { getDatabase } from "@/lib/db/client";
import { aggregateRecord, approval, auditEvent, workflowEvent, workspaceProject, workspaceProjectItem } from "@/lib/db/schema";
import { assertTransition } from "@/lib/workflow/transitions";
import { assertAndLinkProjectEvidence } from "@/lib/workspace/access";

import { kitContentValues, productCatalogFormSchema, type ProductCatalogForm } from "./catalog-form-schema";
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

function splitKitContents(value: string) {
  const contents = value
    .split(/[\s,;，；]+/)
    .map((item) => item.trim())
    .filter((item): item is typeof kitContentValues[number] =>
      kitContentValues.includes(item as typeof kitContentValues[number]),
    );
  return contents.length > 0 ? [...new Set(contents)] : undefined;
}

function optionalBoolean(value: ProductCatalogForm["sampleAvailable"]) {
  return value === "" ? undefined : value === "yes";
}

function kitContentCount(draft: ProductDraft) {
  const value = draft.specifications?.kit_contents;
  return Array.isArray(value) ? value.length : 0;
}

function fieldEvidence(input: EvidenceBoundProductCatalogInput): Record<string, string> {
  const entries: Array<{ path: string; value: unknown; evidenceRef: string }> = [
    { path: "product.product_name", value: input.productName, evidenceRef: input.productNameEvidenceRef },
    { path: "product.product_type", value: input.productType, evidenceRef: input.productTypeEvidenceRef },
    { path: "product.internal_sku", value: input.internalSku, evidenceRef: input.internalSkuEvidenceRef },
    { path: "product.oe_numbers", value: splitOeNumbers(input.oeNumbers), evidenceRef: input.oeNumbersEvidenceRef },
    { path: "product.application", value: optionalText(input.application), evidenceRef: input.applicationEvidenceRef },
    { path: "product.vehicle_brand", value: optionalText(input.vehicleBrand), evidenceRef: input.vehicleBrandEvidenceRef },
    { path: "product.vehicle_model", value: optionalText(input.vehicleModel), evidenceRef: input.vehicleModelEvidenceRef },
    { path: "specifications.clutch_diameter_mm", value: optionalNumber(input.clutchDiameterMm), evidenceRef: input.clutchDiameterMmEvidenceRef },
    { path: "specifications.spline_count", value: optionalNumber(input.splineCount), evidenceRef: input.splineCountEvidenceRef },
    { path: "specifications.spline_size", value: optionalText(input.splineSize), evidenceRef: input.splineSizeEvidenceRef },
    { path: "specifications.friction_material", value: optionalText(input.frictionMaterial), evidenceRef: input.frictionMaterialEvidenceRef },
    { path: "specifications.kit_contents", value: splitKitContents(input.kitContents), evidenceRef: input.kitContentsEvidenceRef },
    { path: "specifications.gross_weight_kg", value: optionalNumber(input.grossWeightKg), evidenceRef: input.grossWeightKgEvidenceRef },
    { path: "specifications.net_weight_kg", value: optionalNumber(input.netWeightKg), evidenceRef: input.netWeightKgEvidenceRef },
    { path: "specifications.package_size", value: optionalText(input.packageSize), evidenceRef: input.packageSizeEvidenceRef },
    { path: "commercial.moq", value: optionalNumber(input.moq), evidenceRef: input.moqEvidenceRef },
    { path: "commercial.estimated_lead_time_days", value: optionalNumber(input.estimatedLeadTimeDays), evidenceRef: input.estimatedLeadTimeDaysEvidenceRef },
    { path: "commercial.packaging", value: optionalText(input.packaging), evidenceRef: input.packagingEvidenceRef },
    { path: "commercial.supported_customization", value: optionalText(input.supportedCustomization), evidenceRef: input.supportedCustomizationEvidenceRef },
    { path: "commercial.sample_available", value: optionalBoolean(input.sampleAvailable), evidenceRef: input.sampleAvailableEvidenceRef },
  ];
  return Object.fromEntries(entries
    .filter(({ value }) => value !== undefined && value !== null && value !== "")
    .map(({ path, evidenceRef }) => [path, evidenceRef]));
}

/** Builds a review-only manual draft without copying one evidence ref to every fact. */
export function buildEvidenceBoundProductCatalogDraft(
  inputValue: unknown,
  recordId: string = randomUUID(),
): ProductDraft {
  const input = productCatalogFormSchema.parse(inputValue);
  const oeNumbers = splitOeNumbers(input.oeNumbers);
  const application = optionalText(input.application);
  const vehicleBrand = optionalText(input.vehicleBrand);
  const vehicleModel = optionalText(input.vehicleModel);
  const clutchDiameterMm = optionalNumber(input.clutchDiameterMm);
  const splineCount = optionalNumber(input.splineCount);
  const splineSize = optionalText(input.splineSize);
  const frictionMaterial = optionalText(input.frictionMaterial);
  const kitContents = splitKitContents(input.kitContents);
  const grossWeightKg = optionalNumber(input.grossWeightKg);
  const netWeightKg = optionalNumber(input.netWeightKg);
  const packageSize = optionalText(input.packageSize);
  const moq = optionalNumber(input.moq);
  const estimatedLeadTimeDays = optionalNumber(input.estimatedLeadTimeDays);
  const packaging = optionalText(input.packaging);
  const supportedCustomization = optionalText(input.supportedCustomization);
  const sampleAvailable = optionalBoolean(input.sampleAvailable);

  const product = {
    product_name: input.productName,
    product_type: input.productType,
    internal_sku: input.internalSku,
    ...(oeNumbers ? { oe_numbers: oeNumbers } : {}),
    ...(application ? { application } : {}),
    ...(vehicleBrand ? { vehicle_brand: vehicleBrand } : {}),
    ...(vehicleModel ? { vehicle_model: vehicleModel } : {}),
  };
  const specifications = {
    ...(clutchDiameterMm ? { clutch_diameter_mm: clutchDiameterMm } : {}),
    ...(splineCount ? { spline_count: splineCount } : {}),
    ...(splineSize ? { spline_size: splineSize } : {}),
    ...(frictionMaterial ? { friction_material: frictionMaterial } : {}),
    ...(kitContents ? { kit_contents: kitContents } : {}),
    ...(grossWeightKg ? { gross_weight_kg: grossWeightKg } : {}),
    ...(netWeightKg ? { net_weight_kg: netWeightKg } : {}),
    ...(packageSize ? { package_size: packageSize } : {}),
  };
  const commercial = {
    ...(moq ? { moq } : {}),
    ...(estimatedLeadTimeDays !== undefined ? { estimated_lead_time_days: estimatedLeadTimeDays } : {}),
    ...(packaging ? { packaging } : {}),
    ...(supportedCustomization ? { supported_customization: supportedCustomization } : {}),
    ...(sampleAvailable !== undefined ? { sample_available: sampleAvailable } : {}),
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
    ...(Object.keys(commercial).length > 0 ? { commercial } : {}),
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
      product_type_specific_fields: kitContentCount(draft),
      commercial_field_count: Object.keys(draft.commercial ?? {}).length,
    },
    occurredAt: now,
  };

  await getDatabase().transaction(async (tx) => {
    if (projectId) {
      await assertAndLinkProjectEvidence(projectId, draft.evidence_refs, actorId, tx);
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
  projectId: string,
) {
  const input = productCatalogFormSchema.parse(inputValue);
  const now = new Date();
  const eventId = randomUUID();
  const approvalId = randomUUID();
  return getDatabase().transaction(async (tx) => {
    const draft = buildEvidenceBoundProductCatalogDraft(input, productId);
    await assertAndLinkProjectEvidence(projectId, draft.evidence_refs, actorId, tx);
    const [aggregate] = await tx.select({
      id: aggregateRecord.id,
      state: aggregateRecord.state,
      version: aggregateRecord.version,
    }).from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, productId), eq(aggregateRecord.type, "product")))
      .for("update");
    if (!aggregate) throw new Error("产品草稿不存在。");
    if (aggregate.state !== "PRODUCT_REVISION_REQUIRED") throw new Error("该产品当前不处于待修订状态。");

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
        product_type_specific_fields: kitContentCount(draft),
        commercial_field_count: Object.keys(draft.commercial ?? {}).length,
      },
      occurredAt: now,
    });
    return { approvalId, draft };
  });
}
