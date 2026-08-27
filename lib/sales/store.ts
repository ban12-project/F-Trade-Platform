import { randomUUID } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";
import type { z } from "zod";

import { getDatabase } from "@/lib/db/client";
import { aggregateRecord, auditEvent, workflowEvent } from "@/lib/db/schema";
import type { rfqFormSchema } from "@/lib/form-schemas";
import { assessRfq, promoteRfqReady, updateRfqDraft } from "@/lib/rfq/completeness";
import { assertTransition } from "@/lib/workflow/transitions";

export type RfqFormInput = z.infer<typeof rfqFormSchema>;
export type RfqEntry = { id: string; state: string; createdAt: Date; productType: string; quantity: number | null; destination: string | null; missingFields: string[]; completenessScore: number };

function rfqFromInput(input: RfqFormInput, id: string) {
  const product = { product_type: input.productType, ...(input.oeNumber ? { oe_number: input.oeNumber } : {}), ...(input.vehicleBrand ? { vehicle_brand: input.vehicleBrand } : {}), ...(input.vehicleModel ? { vehicle_model: input.vehicleModel } : {}) };
  const commercial = { ...(input.quantity ? { quantity: Number(input.quantity) } : {}), ...(input.destination ? { destination: input.destination } : {}) };
  return updateRfqDraft({ rfq_id: id, customer: { ...(input.customerName ? { name: input.customerName } : {}), ...(input.customerCompany ? { company: input.customerCompany } : {}), ...(input.customerCountry ? { country: input.customerCountry } : {}) }, product, commercial, status: "collecting" }, {});
}

/** Creates a private RFQ aggregate. No price, lead time, or quotation field is accepted here. */
export async function createRfq(input: RfqFormInput, actorId: string) {
  const id = randomUUID();
  const now = new Date();
  const draft = rfqFromInput(input, id);
  await getDatabase().transaction(async (tx) => {
    await tx.insert(aggregateRecord).values({ id, type: "rfq", state: "RFQ_COLLECTING", payload: draft, createdByType: "human", createdById: actorId });
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "rfq_collecting_created", actorType: "human", actorId, aggregateId: id, subjectType: "rfq", subjectId: id, metadata: { completeness_score: draft.completeness_score, missing_fields: draft.missing_fields, evidence_ref: input.evidenceRef }, occurredAt: now });
  });
  return { id, draft };
}

export async function listRfqEntries(limit = 50): Promise<RfqEntry[]> {
  const rows = await getDatabase().select().from(aggregateRecord).where(eq(aggregateRecord.type, "rfq")).orderBy(desc(aggregateRecord.createdAt)).limit(limit);
  return rows.flatMap((row) => {
    const payload = row.payload as Record<string, any>;
    const product = payload.product as Record<string, unknown> | undefined;
    const commercial = payload.commercial as Record<string, unknown> | undefined;
    if (typeof product?.product_type !== "string") return [];
    return [{ id: row.id, state: row.state, createdAt: row.createdAt, productType: product.product_type, quantity: typeof commercial?.quantity === "number" ? commercial.quantity : null, destination: typeof commercial?.destination === "string" ? commercial.destination : null, missingFields: Array.isArray(payload.missing_fields) ? payload.missing_fields.filter((field): field is string => typeof field === "string") : [], completenessScore: typeof payload.completeness_score === "number" ? payload.completeness_score : 0 }];
  });
}

/** Reassesses and atomically promotes only a complete RFQ. */
export async function submitRfqReady(rfqId: string, evidenceRef: string, actorId: string) {
  const now = new Date();
  const eventId = randomUUID();
  return getDatabase().transaction(async (tx) => {
    const [record] = await tx.select({ id: aggregateRecord.id, state: aggregateRecord.state, version: aggregateRecord.version, payload: aggregateRecord.payload }).from(aggregateRecord).where(and(eq(aggregateRecord.id, rfqId), eq(aggregateRecord.type, "rfq"))).for("update");
    if (!record || record.state !== "RFQ_COLLECTING") throw new Error("该 RFQ 当前不处于信息收集状态。");
    const assessment = assessRfq(record.payload);
    if (!assessment.ready) return { state: "RFQ_COLLECTING" as const, missingFields: assessment.missing_fields };
    const ready = promoteRfqReady(record.payload);
    assertTransition({ eventId, entityType: "rfq", entityId: rfqId, fromState: "RFQ_COLLECTING", toState: "RFQ_READY", actorType: "human", actorId, occurredAt: now.toISOString(), evidenceRefs: [evidenceRef] });
    const [updated] = await tx.update(aggregateRecord).set({ state: "RFQ_READY", payload: ready, version: sql`${aggregateRecord.version} + 1` }).where(and(eq(aggregateRecord.id, rfqId), eq(aggregateRecord.version, record.version))).returning({ id: aggregateRecord.id });
    if (!updated) throw new Error("RFQ 已被其他操作更新，请刷新后重试。");
    await tx.insert(workflowEvent).values({ id: eventId, aggregateId: rfqId, fromState: "RFQ_COLLECTING", toState: "RFQ_READY", actorType: "human", actorId, evidenceRefs: [evidenceRef], occurredAt: now });
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "rfq_ready", actorType: "human", actorId, aggregateId: rfqId, subjectType: "rfq", subjectId: rfqId, metadata: { completeness_score: 100 }, occurredAt: now });
    return { state: "RFQ_READY" as const, missingFields: [] };
  });
}
