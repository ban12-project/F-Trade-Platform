import { randomUUID } from "node:crypto";

import { desc, eq, type InferInsertModel } from "drizzle-orm";

import type { ProductDraft } from "@/lib/product/verification";
import { reviewProductDraft } from "@/lib/product/verification";
import { getDatabase } from "@/lib/db/client";
import { aggregateRecord, auditEvent, workflowEvent } from "@/lib/db/schema";
import type { productCatalogFormSchema } from "@/lib/form-schemas";
import { assertTransition } from "@/lib/workflow/transitions";
import type { z } from "zod";

export type ProductCatalogInput = z.infer<typeof productCatalogFormSchema>;

export type ProductCatalogEntry = {
  id: string;
  state: string;
  createdAt: Date;
  productName: string;
  internalSku: string;
  productType: string;
  verificationStatus: string;
  blockingFields: string[];
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

function evidenceForPresentFields(draft: Omit<ProductDraft, "field_evidence">, evidenceRef: string) {
  return Object.fromEntries(
    (["product", "specifications", "commercial"] as const).flatMap((section) =>
      Object.entries(draft[section] ?? {})
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([field]) => [`${section}.${field}`, evidenceRef]),
    ),
  );
}

/** Builds a review-only draft. It intentionally cannot produce ProductReady. */
export function buildProductCatalogDraft(input: ProductCatalogInput, recordId: string = randomUUID()): ProductDraft {
  const product = {
    product_name: input.productName.trim(),
    product_type: input.productType,
    internal_sku: input.internalSku.trim(),
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

export async function createProductCatalogDraft(input: ProductCatalogInput, actorId: string) {
  const id = randomUUID();
  const draft = buildProductCatalogDraft(input, id);
  const now = new Date();
  const workflowEventId = randomUUID();
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
    await tx.insert(aggregateRecord).values(aggregateValues);
    await tx.insert(workflowEvent).values(workflowValues);
    await tx.insert(auditEvent).values(auditValues);
  });

  return { id, draft };
}

function catalogEntry(row: typeof aggregateRecord.$inferSelect): ProductCatalogEntry | null {
  const payload = row.payload as Partial<ProductDraft>;
  const product = payload.product;
  if (!product || typeof product.product_name !== "string" || typeof product.internal_sku !== "string") {
    return null;
  }
  return {
    id: row.id,
    state: row.state,
    createdAt: row.createdAt,
    productName: product.product_name,
    internalSku: product.internal_sku,
    productType: typeof product.product_type === "string" ? product.product_type : "unknown",
    verificationStatus: typeof payload.verification_status === "string" ? payload.verification_status : "review_required",
    blockingFields: Array.isArray(payload.blocking_missing_fields)
      ? payload.blocking_missing_fields.filter((value): value is string => typeof value === "string")
      : [],
  };
}

export async function listProductCatalogEntries(limit = 50) {
  const rows = await getDatabase()
    .select()
    .from(aggregateRecord)
    .where(eq(aggregateRecord.type, "product"))
    .orderBy(desc(aggregateRecord.createdAt))
    .limit(limit);
  return rows.flatMap((row) => {
    const entry = catalogEntry(row);
    return entry ? [entry] : [];
  });
}
