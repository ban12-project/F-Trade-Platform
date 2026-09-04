import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";

import leadSchema from "@/contracts/sales/lead.schema.json";
import { compileContract } from "@/lib/contracts/validator";
import { getDatabase, type Database } from "@/lib/db/client";
import { aggregateRecord, approval, auditEvent, workflowEvent, workspaceProject, workspaceProjectItem } from "@/lib/db/schema";
import { decideDeliveryConfirmation, requestDeliveryConfirmation } from "@/lib/delivery/confirmation";
import { deliveryDecisionFormSchema, deliveryRequestFormSchema, followUpFormSchema, opportunityDecisionFormSchema, quotationDecisionFormSchema, quotationDraftFormSchema, quotationSendFormSchema } from "@/lib/form-schemas";
import { nextFollowUp } from "@/lib/follow-up/cadence";
import { scoreLead } from "@/lib/follow-up/lead-scoring";
import { applyHumanQuoteDecision, createManualQuotation, sendManualQuotation, type QuotationHandoff } from "@/lib/quotation/handoff";
import { assertTransition } from "@/lib/workflow/transitions";
import { assertWorkspaceProjectAccess } from "@/lib/workspace/access";

type QuotationDraftValues = z.infer<typeof quotationDraftFormSchema>;
type LeadRecord = {
  lead_id: string;
  channel_ref?: string;
  conversation_ref?: string;
  rfq_ref?: string;
  quotation_ref?: string;
  delivery_confirmation_ref?: string;
  status: "received" | "follow_up" | "opportunity";
  follow_up_context?: z.infer<typeof followUpFormSchema>["context"];
  score: number;
  score_band?: "COLD" | "WARM" | "HOT";
  score_reasons: Array<{ rule_id: string; points: number }>;
  next_action: string;
  next_follow_up_at?: string;
  last_outbound_ref?: string;
};
const validateLead = compileContract<LeadRecord>(leadSchema);

export type QuotationEntry = { id: string; state: string; createdAt: Date; quotation: QuotationHandoff; productId: string; approvalId: string | null; approvalStatus: "pending" | "approved" | "rejected" | null };
export type LeadEntry = { id: string; state: string; createdAt: Date; lead: LeadRecord };
export type DeliveryConfirmationEntry = { id: string; state: string; createdAt: Date; confirmation: Record<string, any>; approvalId: string | null; approvalStatus: "pending" | "approved" | "rejected" | null };

function quoteFromValues(value: QuotationDraftValues) {
  return { unit_price: Number(value.unitPrice), currency: value.currency, moq: Number(value.moq), lead_time_days: Number(value.leadTimeDays), payment_terms: value.paymentTerms, validity_days: Number(value.validityDays) };
}

async function assertSalesProject(tx: Parameters<Parameters<Database["transaction"]>[0]>[0], projectId: string, actorId: string) {
  await assertWorkspaceProjectAccess(projectId, actorId, "write", tx);
  const [project] = await tx.select({ kind: workspaceProject.kind }).from(workspaceProject).where(eq(workspaceProject.id, projectId)).for("update");
  if (!project || project.kind !== "sales") throw new Error("该操作只能在销售机会项目中执行。");
}

export async function createOrReviseQuotation(input: unknown, actorId: string, database: Database = getDatabase()) {
  const value = quotationDraftFormSchema.parse(input); const now = new Date();
  return database.transaction(async (tx) => {
    await assertSalesProject(tx, value.projectId, actorId);
    const [rfq] = await tx.select({ state: aggregateRecord.state }).from(workspaceProjectItem).innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId)).where(and(eq(workspaceProjectItem.projectId, value.projectId), eq(workspaceProjectItem.aggregateId, value.rfqId), eq(workspaceProjectItem.role, "sales_rfq"), eq(aggregateRecord.type, "rfq"))).for("update");
    if (!rfq || rfq.state !== "RFQ_READY") throw new Error("正式报价必须引用当前项目的 RFQ Ready。");
    const [product] = await tx.select({ state: aggregateRecord.state }).from(workspaceProjectItem).innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId)).where(and(eq(workspaceProjectItem.projectId, value.projectId), eq(workspaceProjectItem.aggregateId, value.productId), eq(workspaceProjectItem.role, "product_reference"), eq(aggregateRecord.type, "product"))).for("update");
    if (!product || product.state !== "PRODUCT_READY") throw new Error("正式报价必须引用当前项目的 Product Ready。");
    const id = value.quotationId || randomUUID(); const approvalId = randomUUID();
    if (value.quotationId) {
      const [current] = await tx.select({ state: aggregateRecord.state, payload: aggregateRecord.payload, version: aggregateRecord.version }).from(aggregateRecord).where(and(eq(aggregateRecord.id, id), eq(aggregateRecord.type, "quotation"))).for("update");
      if (!current || current.state !== "QUOTE_REVISION_REQUIRED") throw new Error("只有被退回的报价可以修订。");
      const existing = current.payload as unknown as QuotationHandoff;
      const next: QuotationHandoff = { ...existing, rfq_id: value.rfqId, status: "review_required", quote: quoteFromValues(value) };
      delete next.approval_ref; delete next.sent_at; delete next.sent_channel; delete next.sent_ref;
      await tx.update(aggregateRecord).set({ state: "QUOTE_REVIEW_REQUIRED", payload: { ...next, product_id: value.productId }, version: sql`${aggregateRecord.version} + 1` }).where(eq(aggregateRecord.id, id));
      await tx.insert(workflowEvent).values({ id: randomUUID(), aggregateId: id, fromState: "QUOTE_REVISION_REQUIRED", toState: "QUOTE_REVIEW_REQUIRED", actorType: "human", actorId, evidenceRefs: [], occurredAt: now });
    } else {
      const quotation = createManualQuotation({ handoffId: id, rfqId: value.rfqId, actorType: "human", actorId, quote: quoteFromValues(value) });
      await tx.insert(aggregateRecord).values({ id, type: "quotation", state: "QUOTE_REVIEW_REQUIRED", payload: { ...quotation, product_id: value.productId }, createdByType: "human", createdById: actorId });
      await tx.insert(workspaceProjectItem).values({ id: randomUUID(), projectId: value.projectId, aggregateId: id, role: "sales_quotation", relation: "owned" });
      const eventId = randomUUID();
      assertTransition({ eventId, entityType: "quotation", entityId: id, fromState: "QUOTE_DRAFT", toState: "QUOTE_REVIEW_REQUIRED", actorType: "human", actorId, occurredAt: now.toISOString(), evidenceRefs: [] });
      await tx.insert(workflowEvent).values({ id: eventId, aggregateId: id, fromState: "QUOTE_DRAFT", toState: "QUOTE_REVIEW_REQUIRED", actorType: "human", actorId, evidenceRefs: [], occurredAt: now });
    }
    await tx.insert(approval).values({ id: approvalId, aggregateId: id, gate: "gate_02_quote", status: "pending", requestedByType: "human", requestedById: actorId, requestedAt: now });
    await tx.update(workspaceProject).set({ updatedAt: now }).where(eq(workspaceProject.id, value.projectId));
    await tx.insert(auditEvent).values({ id: randomUUID(), action: value.quotationId ? "quotation.revised" : "quotation.created", actorType: "human", actorId, aggregateId: id, subjectType: "quotation", subjectId: id, metadata: { project_id: value.projectId, rfq_id: value.rfqId, product_id: value.productId }, occurredAt: now });
    return { id };
  });
}

export async function decideQuotation(input: unknown, actorId: string, database: Database = getDatabase()) {
  const value = quotationDecisionFormSchema.parse(input); const now = new Date();
  return database.transaction(async (tx) => {
    await assertSalesProject(tx, value.projectId, actorId);
    const [record] = await tx.select({ state: aggregateRecord.state, payload: aggregateRecord.payload, version: aggregateRecord.version }).from(aggregateRecord).innerJoin(workspaceProjectItem, eq(workspaceProjectItem.aggregateId, aggregateRecord.id)).where(and(eq(aggregateRecord.id, value.quotationId), eq(aggregateRecord.type, "quotation"), eq(workspaceProjectItem.projectId, value.projectId), eq(workspaceProjectItem.role, "sales_quotation"))).for("update");
    if (!record || record.state !== "QUOTE_REVIEW_REQUIRED") throw new Error("该报价当前不处于 Gate 02 待审核状态。");
    const [pending] = await tx.select().from(approval).where(and(eq(approval.aggregateId, value.quotationId), eq(approval.gate, "gate_02_quote"), eq(approval.status, "pending"))).for("update");
    if (!pending) throw new Error("未找到 Gate 02 待审核请求。");
    const next = applyHumanQuoteDecision(record.payload as unknown as QuotationHandoff, { actorType: "human", actorId, status: value.decision, approvalRef: pending.id, evidenceRef: value.evidenceRef, decidedAt: now.toISOString() });
    const nextState = value.decision === "approved" ? "QUOTE_APPROVED" : "QUOTE_REVISION_REQUIRED";
    const eventId = randomUUID();
    assertTransition({ eventId, entityType: "quotation", entityId: value.quotationId, fromState: "QUOTE_REVIEW_REQUIRED", toState: nextState, actorType: "human", actorId, occurredAt: now.toISOString(), gate: "gate_02_quote", approvalRef: pending.id, evidenceRefs: [value.evidenceRef] }, { id: pending.id, aggregateId: value.quotationId, gate: "gate_02_quote", status: value.decision, decidedByType: "human", decidedById: actorId, evidenceRef: value.evidenceRef });
    await tx.update(approval).set({ status: value.decision, decidedByType: "human", decidedById: actorId, decidedAt: now, evidenceRef: value.evidenceRef, notes: value.notes || null }).where(eq(approval.id, pending.id));
    await tx.update(aggregateRecord).set({ state: nextState, payload: next, version: sql`${aggregateRecord.version} + 1` }).where(eq(aggregateRecord.id, value.quotationId));
    await tx.insert(workflowEvent).values({ id: eventId, aggregateId: value.quotationId, fromState: "QUOTE_REVIEW_REQUIRED", toState: nextState, actorType: "human", actorId, gate: "gate_02_quote", approvalId: pending.id, evidenceRefs: [value.evidenceRef], occurredAt: now });
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "quotation.gate_02_decided", actorType: "human", actorId, aggregateId: value.quotationId, subjectType: "quotation", subjectId: value.quotationId, metadata: { decision: value.decision }, occurredAt: now });
    return { id: value.quotationId, state: nextState };
  });
}

export async function sendQuotation(input: unknown, actorId: string, database: Database = getDatabase()) {
  const value = quotationSendFormSchema.parse(input); const now = new Date();
  return database.transaction(async (tx) => {
    await assertSalesProject(tx, value.projectId, actorId);
    const [record] = await tx.select({ payload: aggregateRecord.payload, state: aggregateRecord.state }).from(aggregateRecord).innerJoin(workspaceProjectItem, eq(workspaceProjectItem.aggregateId, aggregateRecord.id)).where(and(eq(aggregateRecord.id, value.quotationId), eq(aggregateRecord.type, "quotation"), eq(workspaceProjectItem.projectId, value.projectId), eq(workspaceProjectItem.role, "sales_quotation"))).for("update");
    if (!record) throw new Error("报价不存在或不属于当前项目。");
    const sent = sendManualQuotation(record.payload as unknown as QuotationHandoff, "human", actorId, now.toISOString(), value.channelRef, value.externalRef);
    await tx.update(aggregateRecord).set({ state: "QUOTE_SENT", payload: sent, version: sql`${aggregateRecord.version} + 1` }).where(eq(aggregateRecord.id, value.quotationId));
    await tx.insert(workflowEvent).values({ id: randomUUID(), aggregateId: value.quotationId, fromState: "QUOTE_APPROVED", toState: "QUOTE_SENT", actorType: "human", actorId, evidenceRefs: [value.externalRef], occurredAt: now });
    const [rfqRecord] = await tx.select({ payload: aggregateRecord.payload }).from(workspaceProjectItem).innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId)).where(and(eq(workspaceProjectItem.projectId, value.projectId), eq(workspaceProjectItem.aggregateId, sent.rfq_id), eq(workspaceProjectItem.role, "sales_rfq"), eq(aggregateRecord.type, "rfq"))).for("update");
    const leadRef = typeof (rfqRecord?.payload as Record<string, unknown> | undefined)?.lead_ref === "string" ? (rfqRecord!.payload as Record<string, unknown>).lead_ref as string : undefined;
    const [receivedLead] = leadRef ? await tx.select({ id: aggregateRecord.id, payload: aggregateRecord.payload }).from(workspaceProjectItem)
      .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
      .where(and(eq(workspaceProjectItem.projectId, value.projectId), eq(workspaceProjectItem.aggregateId, leadRef), eq(workspaceProjectItem.role, "sales_lead"), eq(aggregateRecord.type, "lead"), eq(aggregateRecord.state, "LEAD_RECEIVED")))
      .for("update") : [];
    const leadId = receivedLead?.id ?? randomUUID(); const scoring = scoreLead(["active_inquiry"]);
    const existingLead = receivedLead?.payload as Partial<LeadRecord> | undefined;
    const lead = validateLead({ ...existingLead, lead_id: leadId, channel_ref: existingLead?.channel_ref ?? value.channelRef, conversation_ref: existingLead?.conversation_ref ?? value.externalRef, rfq_ref: sent.rfq_id, quotation_ref: value.quotationId, status: "follow_up", score: scoring.score, score_band: scoring.status, score_reasons: scoring.evidence, next_action: "wait_then_reference_quote_validity" });
    if (receivedLead) await tx.update(aggregateRecord).set({ state: "FOLLOW_UP", payload: lead, version: sql`${aggregateRecord.version} + 1` }).where(eq(aggregateRecord.id, leadId));
    else {
      await tx.insert(aggregateRecord).values({ id: leadId, type: "lead", state: "FOLLOW_UP", payload: lead, createdByType: "human", createdById: actorId });
      await tx.insert(workspaceProjectItem).values({ id: randomUUID(), projectId: value.projectId, aggregateId: leadId, role: "sales_lead", relation: "owned" });
    }
    await tx.insert(workflowEvent).values({ id: randomUUID(), aggregateId: leadId, fromState: "LEAD_RECEIVED", toState: "FOLLOW_UP", actorType: "human", actorId, evidenceRefs: [value.externalRef], occurredAt: now });
    await tx.insert(auditEvent).values({ id: randomUUID(), action: receivedLead ? "quotation.sent_and_inbound_follow_up_started" : "quotation.sent_and_follow_up_created", actorType: "human", actorId, aggregateId: value.quotationId, subjectType: "quotation", subjectId: value.quotationId, metadata: { lead_id: leadId, channel_ref: value.channelRef, external_ref: value.externalRef }, occurredAt: now });
    return { id: value.quotationId, leadId };
  });
}

export async function recordFollowUp(input: unknown, actorId: string, database: Database = getDatabase()) {
  const value = followUpFormSchema.parse(input); const now = new Date();
  return database.transaction(async (tx) => {
    await assertSalesProject(tx, value.projectId, actorId);
    const [record] = await tx.select({ payload: aggregateRecord.payload, state: aggregateRecord.state }).from(aggregateRecord).innerJoin(workspaceProjectItem, eq(workspaceProjectItem.aggregateId, aggregateRecord.id)).where(and(eq(aggregateRecord.id, value.leadId), eq(aggregateRecord.type, "lead"), eq(workspaceProjectItem.projectId, value.projectId), eq(workspaceProjectItem.role, "sales_lead"))).for("update");
    if (!record || record.state !== "FOLLOW_UP") throw new Error("只有跟进中的线索可以记录回复。");
    const recommendation = nextFollowUp(value.context); const scoring = scoreLead(value.triggeredRules);
    const next = validateLead({ ...(record.payload as LeadRecord), status: "follow_up", follow_up_context: value.context, score: scoring.score, score_band: scoring.status, score_reasons: scoring.evidence, next_action: recommendation.action, last_outbound_ref: value.outboundRef, ...(value.nextFollowUpAt ? { next_follow_up_at: new Date(value.nextFollowUpAt).toISOString() } : {}) });
    await tx.update(aggregateRecord).set({ payload: next, version: sql`${aggregateRecord.version} + 1` }).where(eq(aggregateRecord.id, value.leadId));
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "lead.follow_up_recorded", actorType: "human", actorId, aggregateId: value.leadId, subjectType: "lead", subjectId: value.leadId, metadata: { context: value.context, score: scoring.score, outbound_ref: value.outboundRef, draft_length: value.draft.length }, occurredAt: now });
    return next;
  });
}

export async function confirmOpportunity(input: unknown, actorId: string, database: Database = getDatabase()) {
  const value = opportunityDecisionFormSchema.parse(input); const now = new Date();
  return database.transaction(async (tx) => {
    await assertSalesProject(tx, value.projectId, actorId);
    const [record] = await tx.select({ payload: aggregateRecord.payload, state: aggregateRecord.state }).from(aggregateRecord).innerJoin(workspaceProjectItem, eq(workspaceProjectItem.aggregateId, aggregateRecord.id)).where(and(eq(aggregateRecord.id, value.leadId), eq(aggregateRecord.type, "lead"), eq(workspaceProjectItem.projectId, value.projectId), eq(workspaceProjectItem.role, "sales_lead"))).for("update");
    const lead = record?.payload as LeadRecord | undefined;
    if (!record || record.state !== "FOLLOW_UP" || lead?.score_band !== "HOT") throw new Error("只有达到 HOT 的跟进线索才能由人工确认有效商机。");
    const next = validateLead({ ...lead, status: "opportunity", next_action: "human_manage_opportunity" });
    await tx.update(aggregateRecord).set({ state: "OPPORTUNITY", payload: next, version: sql`${aggregateRecord.version} + 1` }).where(eq(aggregateRecord.id, value.leadId));
    await tx.insert(workflowEvent).values({ id: randomUUID(), aggregateId: value.leadId, fromState: "FOLLOW_UP", toState: "OPPORTUNITY", actorType: "human", actorId, evidenceRefs: [value.evidenceRef], occurredAt: now });
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "lead.opportunity_confirmed", actorType: "human", actorId, aggregateId: value.leadId, subjectType: "lead", subjectId: value.leadId, metadata: { evidence_ref: value.evidenceRef }, occurredAt: now });
    return next;
  });
}

export async function createDeliveryRequest(input: unknown, actorId: string, database: Database = getDatabase()) {
  const value = deliveryRequestFormSchema.parse(input); const now = new Date();
  return database.transaction(async (tx) => {
    await assertSalesProject(tx, value.projectId, actorId);
    const [lead] = await tx.select({ state: aggregateRecord.state, payload: aggregateRecord.payload }).from(aggregateRecord).innerJoin(workspaceProjectItem, eq(workspaceProjectItem.aggregateId, aggregateRecord.id)).where(and(eq(aggregateRecord.id, value.leadId), eq(aggregateRecord.type, "lead"), eq(workspaceProjectItem.projectId, value.projectId), eq(workspaceProjectItem.role, "sales_lead"))).for("update");
    if (!lead || lead.state !== "FOLLOW_UP") throw new Error("只有跟进中的线索可以申请交期确认。");
    const leadPayload = validateLead(lead.payload);
    if (!leadPayload.rfq_ref) throw new Error("交期确认必须引用当前线索的 RFQ。");
    const id = randomUUID(); const approvalId = randomUUID();
    const confirmation = requestDeliveryConfirmation({ confirmationId: id, relatedEntityType: "rfq", relatedEntityId: leadPayload.rfq_ref, requestedByType: "human", requestedById: actorId, requestedAt: now.toISOString() });
    await tx.insert(aggregateRecord).values({ id, type: "delivery_confirmation", state: "DELIVERY_CONFIRMATION_PENDING", payload: confirmation, createdByType: "human", createdById: actorId });
    await tx.insert(workspaceProjectItem).values({ id: randomUUID(), projectId: value.projectId, aggregateId: id, role: "delivery_confirmation", relation: "owned" });
    await tx.insert(approval).values({ id: approvalId, aggregateId: id, gate: "gate_03_delivery", status: "pending", requestedByType: "human", requestedById: actorId, requestedAt: now });
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "delivery_confirmation.requested", actorType: "human", actorId, aggregateId: id, subjectType: "delivery_confirmation", subjectId: id, metadata: { lead_id: value.leadId, evidence_ref: value.evidenceRef }, occurredAt: now });
    return { id };
  });
}

export async function decideDelivery(input: unknown, actorId: string, database: Database = getDatabase()) {
  const value = deliveryDecisionFormSchema.parse(input); const now = new Date();
  return database.transaction(async (tx) => {
    await assertSalesProject(tx, value.projectId, actorId);
    const [record] = await tx.select({ payload: aggregateRecord.payload, state: aggregateRecord.state }).from(aggregateRecord).innerJoin(workspaceProjectItem, eq(workspaceProjectItem.aggregateId, aggregateRecord.id)).where(and(eq(aggregateRecord.id, value.confirmationId), eq(aggregateRecord.type, "delivery_confirmation"), eq(workspaceProjectItem.projectId, value.projectId), eq(workspaceProjectItem.role, "delivery_confirmation"))).for("update");
    if (!record || record.state !== "DELIVERY_CONFIRMATION_PENDING") throw new Error("该交期确认当前不可审核。");
    const [pending] = await tx.select().from(approval).where(and(eq(approval.aggregateId, value.confirmationId), eq(approval.gate, "gate_03_delivery"), eq(approval.status, "pending"))).for("update");
    if (!pending) throw new Error("未找到 Gate 03 待审核请求。");
    const next = decideDeliveryConfirmation(record.payload as Record<string, unknown>, { actorType: "human", actorId, status: value.decision, approvalRef: pending.id, evidenceRef: value.evidenceRef, decidedAt: now.toISOString(), ...(value.decision === "confirmed" ? { leadTimeDays: Number(value.leadTimeDays) } : {}) });
    const nextState = value.decision === "confirmed" ? "DELIVERY_CONFIRMATION_CONFIRMED" : "DELIVERY_CONFIRMATION_REJECTED";
    await tx.update(approval).set({ status: value.decision === "confirmed" ? "approved" : "rejected", decidedByType: "human", decidedById: actorId, decidedAt: now, evidenceRef: value.evidenceRef, notes: value.notes || null }).where(eq(approval.id, pending.id));
    await tx.update(aggregateRecord).set({ state: nextState, payload: next, version: sql`${aggregateRecord.version} + 1` }).where(eq(aggregateRecord.id, value.confirmationId));
    await tx.insert(workflowEvent).values({ id: randomUUID(), aggregateId: value.confirmationId, fromState: "DELIVERY_CONFIRMATION_PENDING", toState: nextState, actorType: "human", actorId, gate: "gate_03_delivery", approvalId: pending.id, evidenceRefs: [value.evidenceRef], occurredAt: now });
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "delivery_confirmation.gate_03_decided", actorType: "human", actorId, aggregateId: value.confirmationId, subjectType: "delivery_confirmation", subjectId: value.confirmationId, metadata: { decision: value.decision }, occurredAt: now });
    return { id: value.confirmationId, state: nextState };
  });
}

async function latestApprovals(ids: string[], gate: "gate_02_quote" | "gate_03_delivery", database: Database) {
  if (!ids.length) return new Map<string, { id: string; status: "pending" | "approved" | "rejected" }>();
  const rows = await database.select({ id: approval.id, aggregateId: approval.aggregateId, status: approval.status }).from(approval).where(and(inArray(approval.aggregateId, ids), eq(approval.gate, gate))).orderBy(desc(approval.requestedAt));
  const result = new Map<string, { id: string; status: "pending" | "approved" | "rejected" }>(); for (const row of rows) if (!result.has(row.aggregateId)) result.set(row.aggregateId, { id: row.id, status: row.status }); return result;
}

export async function listProjectQuotations(projectId: string, database: Database = getDatabase()): Promise<QuotationEntry[]> {
  const rows = await database.select({ record: aggregateRecord }).from(workspaceProjectItem).innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId)).where(and(eq(workspaceProjectItem.projectId, projectId), eq(workspaceProjectItem.role, "sales_quotation"), eq(aggregateRecord.type, "quotation"))).orderBy(desc(workspaceProjectItem.createdAt));
  const approvals = await latestApprovals(rows.map(({ record }) => record.id), "gate_02_quote", database);
  return rows.map(({ record }) => { const item = approvals.get(record.id); const payload = record.payload as unknown as QuotationHandoff & { product_id?: string }; return { id: record.id, state: record.state, createdAt: record.createdAt, quotation: payload, productId: payload.product_id ?? "", approvalId: item?.id ?? null, approvalStatus: item?.status ?? null }; });
}

export async function listProjectLeads(projectId: string, database: Database = getDatabase()): Promise<LeadEntry[]> {
  const rows = await database.select({ record: aggregateRecord }).from(workspaceProjectItem).innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId)).where(and(eq(workspaceProjectItem.projectId, projectId), eq(workspaceProjectItem.role, "sales_lead"), eq(aggregateRecord.type, "lead"))).orderBy(desc(workspaceProjectItem.createdAt));
  return rows.flatMap(({ record }) => { const parsed = (() => { try { return validateLead(record.payload); } catch { return null; } })(); return parsed ? [{ id: record.id, state: record.state, createdAt: record.createdAt, lead: parsed }] : []; });
}

export async function listProjectDeliveryConfirmations(projectId: string, database: Database = getDatabase()): Promise<DeliveryConfirmationEntry[]> {
  const rows = await database.select({ record: aggregateRecord }).from(workspaceProjectItem).innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId)).where(and(eq(workspaceProjectItem.projectId, projectId), eq(workspaceProjectItem.role, "delivery_confirmation"), eq(aggregateRecord.type, "delivery_confirmation"))).orderBy(desc(workspaceProjectItem.createdAt));
  const approvals = await latestApprovals(rows.map(({ record }) => record.id), "gate_03_delivery", database);
  return rows.map(({ record }) => { const item = approvals.get(record.id); return { id: record.id, state: record.state, createdAt: record.createdAt, confirmation: record.payload, approvalId: item?.id ?? null, approvalStatus: item?.status ?? null }; });
}
