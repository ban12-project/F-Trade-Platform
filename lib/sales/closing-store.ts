import { randomUUID } from "node:crypto";

import { and, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";

import leadSchema from "@/contracts/sales/lead.schema.json";
import { compileContract } from "@/lib/contracts/validator";
import { type Database, getDatabase } from "@/lib/db/client";
import {
  aggregateRecord,
  approval,
  auditEvent,
  socialBrowserJob,
  socialChannelControl,
  socialConversation,
  socialMessage,
  workflowEvent,
  workspaceProject,
  workspaceProjectItem,
} from "@/lib/db/schema";
import {
  decideDeliveryConfirmation,
  requestDeliveryConfirmation,
  validateDeliveryConfirmation,
} from "@/lib/delivery/confirmation";
import { nextFollowUp } from "@/lib/follow-up/cadence";
import { buildControlledReply } from "@/lib/follow-up/controlled-reply";
import { scoreLead } from "@/lib/follow-up/lead-scoring";
import {
  deliveryDecisionFormSchema,
  deliveryRequestFormSchema,
  followUpFormSchema,
  opportunityDecisionFormSchema,
  quotationDecisionFormSchema,
  quotationDraftFormSchema,
  quotationSendFormSchema,
} from "@/lib/form-schemas";
import {
  applyHumanQuoteDecision,
  createManualQuotation,
  type QuotationHandoff,
  sendManualQuotation,
} from "@/lib/quotation/handoff";
import { assessReplyWindow } from "@/lib/social/inbound-policy";
import { decryptSocialMessageBody } from "@/lib/social/message-crypto";
import { createStoredSocialMessageRecord } from "@/lib/social/message-record";
import { replyResultSchema } from "@/lib/social/reply-result-protocol";
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

export type QuotationEntry = {
  id: string;
  state: string;
  createdAt: Date;
  quotation: QuotationHandoff;
  productId: string;
  approvalId: string | null;
  approvalStatus: "pending" | "approved" | "rejected" | null;
};
export type LeadTimelineMessage = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  receivedAt: Date;
  deliveryStatus: "received" | "queued" | "claimed" | "sent" | "failed" | "paused";
};
export type ConfirmedDelivery = { id: string; leadTimeDays: number; validUntil: string };
export type LeadEntry = {
  id: string;
  state: string;
  createdAt: Date;
  lead: LeadRecord;
  timeline: LeadTimelineMessage[];
  replyAvailable: boolean;
  confirmedDelivery: ConfirmedDelivery | null;
};
export type DeliveryConfirmationEntry = {
  id: string;
  state: string;
  createdAt: Date;
  confirmation: Record<string, any>;
  approvalId: string | null;
  approvalStatus: "pending" | "approved" | "rejected" | null;
};

function quoteFromValues(value: QuotationDraftValues) {
  return {
    unit_price: Number(value.unitPrice),
    currency: value.currency,
    moq: Number(value.moq),
    lead_time_days: Number(value.leadTimeDays),
    payment_terms: value.paymentTerms,
    validity_days: Number(value.validityDays),
  };
}

async function assertSalesProject(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  projectId: string,
  actorId: string,
) {
  await assertWorkspaceProjectAccess(projectId, actorId, "write", tx);
  const [project] = await tx
    .select({ kind: workspaceProject.kind })
    .from(workspaceProject)
    .where(eq(workspaceProject.id, projectId))
    .for("update");
  if (!project || project.kind !== "sales") throw new Error("该操作只能在销售机会项目中执行。");
}

const DELIVERY_CONFIRMATION_VALIDITY_MS = 7 * 24 * 60 * 60 * 1_000;
async function prepareControlledFollowUp(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  projectId: string,
  lead: LeadRecord,
  context: z.infer<typeof followUpFormSchema>["context"],
  draft: string,
  now: Date,
) {
  if (context !== "asks_lead_time" && context !== "asks_sample")
    return buildControlledReply({ draft, context, rfqRef: lead.rfq_ref, delivery: null, now });
  if (!lead.delivery_confirmation_ref)
    return buildControlledReply({ draft, context, rfqRef: lead.rfq_ref, delivery: null, now });
  const [row] = await tx
    .select({ state: aggregateRecord.state, payload: aggregateRecord.payload })
    .from(aggregateRecord)
    .innerJoin(workspaceProjectItem, eq(workspaceProjectItem.aggregateId, aggregateRecord.id))
    .where(
      and(
        eq(aggregateRecord.id, lead.delivery_confirmation_ref),
        eq(aggregateRecord.type, "delivery_confirmation"),
        eq(workspaceProjectItem.projectId, projectId),
        eq(workspaceProjectItem.role, "delivery_confirmation"),
      ),
    )
    .for("update");
  const confirmation =
    row && row.state === "DELIVERY_CONFIRMATION_CONFIRMED"
      ? validateDeliveryConfirmation(row.payload)
      : null;
  return buildControlledReply({
    draft,
    context,
    rfqRef: lead.rfq_ref,
    delivery: confirmation,
    now,
  });
}

export async function createOrReviseQuotation(
  input: unknown,
  actorId: string,
  database: Database = getDatabase(),
) {
  const value = quotationDraftFormSchema.parse(input);
  const now = new Date();
  return database.transaction(async (tx) => {
    await assertSalesProject(tx, value.projectId, actorId);
    const [rfq] = await tx
      .select({ state: aggregateRecord.state })
      .from(workspaceProjectItem)
      .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
      .where(
        and(
          eq(workspaceProjectItem.projectId, value.projectId),
          eq(workspaceProjectItem.aggregateId, value.rfqId),
          eq(workspaceProjectItem.role, "sales_rfq"),
          eq(aggregateRecord.type, "rfq"),
        ),
      )
      .for("update");
    if (!rfq || rfq.state !== "RFQ_READY")
      throw new Error("正式报价必须引用当前项目的 RFQ Ready。");
    const [product] = await tx
      .select({ state: aggregateRecord.state })
      .from(workspaceProjectItem)
      .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
      .where(
        and(
          eq(workspaceProjectItem.projectId, value.projectId),
          eq(workspaceProjectItem.aggregateId, value.productId),
          eq(workspaceProjectItem.role, "product_reference"),
          eq(aggregateRecord.type, "product"),
        ),
      )
      .for("update");
    if (!product || product.state !== "PRODUCT_READY")
      throw new Error("正式报价必须引用当前项目的 Product Ready。");
    const id = value.quotationId || randomUUID();
    const approvalId = randomUUID();
    if (value.quotationId) {
      const [current] = await tx
        .select({
          state: aggregateRecord.state,
          payload: aggregateRecord.payload,
          version: aggregateRecord.version,
        })
        .from(aggregateRecord)
        .where(and(eq(aggregateRecord.id, id), eq(aggregateRecord.type, "quotation")))
        .for("update");
      if (!current || current.state !== "QUOTE_REVISION_REQUIRED")
        throw new Error("只有被退回的报价可以修订。");
      const existing = current.payload as unknown as QuotationHandoff;
      const next: QuotationHandoff = {
        ...existing,
        rfq_id: value.rfqId,
        status: "review_required",
        quote: quoteFromValues(value),
      };
      delete next.approval_ref;
      delete next.sent_at;
      delete next.sent_channel;
      delete next.sent_ref;
      await tx
        .update(aggregateRecord)
        .set({
          state: "QUOTE_REVIEW_REQUIRED",
          payload: { ...next, product_id: value.productId },
          version: sql`${aggregateRecord.version} + 1`,
        })
        .where(eq(aggregateRecord.id, id));
      await tx
        .insert(workflowEvent)
        .values({
          id: randomUUID(),
          aggregateId: id,
          fromState: "QUOTE_REVISION_REQUIRED",
          toState: "QUOTE_REVIEW_REQUIRED",
          actorType: "human",
          actorId,
          evidenceRefs: [],
          occurredAt: now,
        });
    } else {
      const quotation = createManualQuotation({
        handoffId: id,
        rfqId: value.rfqId,
        actorType: "human",
        actorId,
        quote: quoteFromValues(value),
      });
      await tx
        .insert(aggregateRecord)
        .values({
          id,
          type: "quotation",
          state: "QUOTE_REVIEW_REQUIRED",
          payload: { ...quotation, product_id: value.productId },
          createdByType: "human",
          createdById: actorId,
        });
      await tx
        .insert(workspaceProjectItem)
        .values({
          id: randomUUID(),
          projectId: value.projectId,
          aggregateId: id,
          role: "sales_quotation",
          relation: "owned",
        });
      const eventId = randomUUID();
      assertTransition({
        eventId,
        entityType: "quotation",
        entityId: id,
        fromState: "QUOTE_DRAFT",
        toState: "QUOTE_REVIEW_REQUIRED",
        actorType: "human",
        actorId,
        occurredAt: now.toISOString(),
        evidenceRefs: [],
      });
      await tx
        .insert(workflowEvent)
        .values({
          id: eventId,
          aggregateId: id,
          fromState: "QUOTE_DRAFT",
          toState: "QUOTE_REVIEW_REQUIRED",
          actorType: "human",
          actorId,
          evidenceRefs: [],
          occurredAt: now,
        });
    }
    await tx
      .insert(approval)
      .values({
        id: approvalId,
        aggregateId: id,
        gate: "gate_02_quote",
        status: "pending",
        requestedByType: "human",
        requestedById: actorId,
        requestedAt: now,
      });
    await tx
      .update(workspaceProject)
      .set({ updatedAt: now })
      .where(eq(workspaceProject.id, value.projectId));
    await tx
      .insert(auditEvent)
      .values({
        id: randomUUID(),
        action: value.quotationId ? "quotation.revised" : "quotation.created",
        actorType: "human",
        actorId,
        aggregateId: id,
        subjectType: "quotation",
        subjectId: id,
        metadata: { project_id: value.projectId, rfq_id: value.rfqId, product_id: value.productId },
        occurredAt: now,
      });
    return { id };
  });
}

export async function decideQuotation(
  input: unknown,
  actorId: string,
  database: Database = getDatabase(),
) {
  const value = quotationDecisionFormSchema.parse(input);
  const now = new Date();
  return database.transaction(async (tx) => {
    await assertSalesProject(tx, value.projectId, actorId);
    const [record] = await tx
      .select({
        state: aggregateRecord.state,
        payload: aggregateRecord.payload,
        version: aggregateRecord.version,
      })
      .from(aggregateRecord)
      .innerJoin(workspaceProjectItem, eq(workspaceProjectItem.aggregateId, aggregateRecord.id))
      .where(
        and(
          eq(aggregateRecord.id, value.quotationId),
          eq(aggregateRecord.type, "quotation"),
          eq(workspaceProjectItem.projectId, value.projectId),
          eq(workspaceProjectItem.role, "sales_quotation"),
        ),
      )
      .for("update");
    if (!record || record.state !== "QUOTE_REVIEW_REQUIRED")
      throw new Error("该报价当前不处于 Gate 02 待审核状态。");
    const [pending] = await tx
      .select()
      .from(approval)
      .where(
        and(
          eq(approval.aggregateId, value.quotationId),
          eq(approval.gate, "gate_02_quote"),
          eq(approval.status, "pending"),
        ),
      )
      .for("update");
    if (!pending) throw new Error("未找到 Gate 02 待审核请求。");
    const next = applyHumanQuoteDecision(record.payload as unknown as QuotationHandoff, {
      actorType: "human",
      actorId,
      status: value.decision,
      approvalRef: pending.id,
      evidenceRef: value.evidenceRef,
      decidedAt: now.toISOString(),
    });
    const nextState = value.decision === "approved" ? "QUOTE_APPROVED" : "QUOTE_REVISION_REQUIRED";
    const eventId = randomUUID();
    assertTransition(
      {
        eventId,
        entityType: "quotation",
        entityId: value.quotationId,
        fromState: "QUOTE_REVIEW_REQUIRED",
        toState: nextState,
        actorType: "human",
        actorId,
        occurredAt: now.toISOString(),
        gate: "gate_02_quote",
        approvalRef: pending.id,
        evidenceRefs: [value.evidenceRef],
      },
      {
        id: pending.id,
        aggregateId: value.quotationId,
        gate: "gate_02_quote",
        status: value.decision,
        decidedByType: "human",
        decidedById: actorId,
        evidenceRef: value.evidenceRef,
      },
    );
    await tx
      .update(approval)
      .set({
        status: value.decision,
        decidedByType: "human",
        decidedById: actorId,
        decidedAt: now,
        evidenceRef: value.evidenceRef,
        notes: value.notes || null,
      })
      .where(eq(approval.id, pending.id));
    await tx
      .update(aggregateRecord)
      .set({ state: nextState, payload: next, version: sql`${aggregateRecord.version} + 1` })
      .where(eq(aggregateRecord.id, value.quotationId));
    await tx
      .insert(workflowEvent)
      .values({
        id: eventId,
        aggregateId: value.quotationId,
        fromState: "QUOTE_REVIEW_REQUIRED",
        toState: nextState,
        actorType: "human",
        actorId,
        gate: "gate_02_quote",
        approvalId: pending.id,
        evidenceRefs: [value.evidenceRef],
        occurredAt: now,
      });
    await tx
      .insert(auditEvent)
      .values({
        id: randomUUID(),
        action: "quotation.gate_02_decided",
        actorType: "human",
        actorId,
        aggregateId: value.quotationId,
        subjectType: "quotation",
        subjectId: value.quotationId,
        metadata: { decision: value.decision },
        occurredAt: now,
      });
    return { id: value.quotationId, state: nextState };
  });
}

export async function sendQuotation(
  input: unknown,
  actorId: string,
  database: Database = getDatabase(),
) {
  const value = quotationSendFormSchema.parse(input);
  const now = new Date();
  return database.transaction(async (tx) => {
    await assertSalesProject(tx, value.projectId, actorId);
    const [record] = await tx
      .select({ payload: aggregateRecord.payload, state: aggregateRecord.state })
      .from(aggregateRecord)
      .innerJoin(workspaceProjectItem, eq(workspaceProjectItem.aggregateId, aggregateRecord.id))
      .where(
        and(
          eq(aggregateRecord.id, value.quotationId),
          eq(aggregateRecord.type, "quotation"),
          eq(workspaceProjectItem.projectId, value.projectId),
          eq(workspaceProjectItem.role, "sales_quotation"),
        ),
      )
      .for("update");
    if (!record) throw new Error("报价不存在或不属于当前项目。");
    const sent = sendManualQuotation(
      record.payload as unknown as QuotationHandoff,
      "human",
      actorId,
      now.toISOString(),
      value.channelRef,
      value.externalRef,
    );
    await tx
      .update(aggregateRecord)
      .set({ state: "QUOTE_SENT", payload: sent, version: sql`${aggregateRecord.version} + 1` })
      .where(eq(aggregateRecord.id, value.quotationId));
    await tx
      .insert(workflowEvent)
      .values({
        id: randomUUID(),
        aggregateId: value.quotationId,
        fromState: "QUOTE_APPROVED",
        toState: "QUOTE_SENT",
        actorType: "human",
        actorId,
        evidenceRefs: [value.externalRef],
        occurredAt: now,
      });
    const [rfqRecord] = await tx
      .select({ payload: aggregateRecord.payload })
      .from(workspaceProjectItem)
      .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
      .where(
        and(
          eq(workspaceProjectItem.projectId, value.projectId),
          eq(workspaceProjectItem.aggregateId, sent.rfq_id),
          eq(workspaceProjectItem.role, "sales_rfq"),
          eq(aggregateRecord.type, "rfq"),
        ),
      )
      .for("update");
    const leadRef =
      typeof (rfqRecord?.payload as Record<string, unknown> | undefined)?.lead_ref === "string"
        ? ((rfqRecord!.payload as Record<string, unknown>).lead_ref as string)
        : undefined;
    const [receivedLead] = leadRef
      ? await tx
          .select({ id: aggregateRecord.id, payload: aggregateRecord.payload })
          .from(workspaceProjectItem)
          .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
          .where(
            and(
              eq(workspaceProjectItem.projectId, value.projectId),
              eq(workspaceProjectItem.aggregateId, leadRef),
              eq(workspaceProjectItem.role, "sales_lead"),
              eq(aggregateRecord.type, "lead"),
              eq(aggregateRecord.state, "LEAD_RECEIVED"),
            ),
          )
          .for("update")
      : [];
    const leadId = receivedLead?.id ?? randomUUID();
    const scoring = scoreLead(["active_inquiry"]);
    const existingLead = receivedLead?.payload as Partial<LeadRecord> | undefined;
    const lead = validateLead({
      ...existingLead,
      lead_id: leadId,
      channel_ref: existingLead?.channel_ref ?? value.channelRef,
      conversation_ref: existingLead?.conversation_ref ?? value.externalRef,
      rfq_ref: sent.rfq_id,
      quotation_ref: value.quotationId,
      status: "follow_up",
      score: scoring.score,
      score_band: scoring.status,
      score_reasons: scoring.evidence,
      next_action: "wait_then_reference_quote_validity",
    });
    if (receivedLead)
      await tx
        .update(aggregateRecord)
        .set({ state: "FOLLOW_UP", payload: lead, version: sql`${aggregateRecord.version} + 1` })
        .where(eq(aggregateRecord.id, leadId));
    else {
      await tx
        .insert(aggregateRecord)
        .values({
          id: leadId,
          type: "lead",
          state: "FOLLOW_UP",
          payload: lead,
          createdByType: "human",
          createdById: actorId,
        });
      await tx
        .insert(workspaceProjectItem)
        .values({
          id: randomUUID(),
          projectId: value.projectId,
          aggregateId: leadId,
          role: "sales_lead",
          relation: "owned",
        });
    }
    await tx
      .insert(workflowEvent)
      .values({
        id: randomUUID(),
        aggregateId: leadId,
        fromState: "LEAD_RECEIVED",
        toState: "FOLLOW_UP",
        actorType: "human",
        actorId,
        evidenceRefs: [value.externalRef],
        occurredAt: now,
      });
    await tx
      .insert(auditEvent)
      .values({
        id: randomUUID(),
        action: receivedLead
          ? "quotation.sent_and_inbound_follow_up_started"
          : "quotation.sent_and_follow_up_created",
        actorType: "human",
        actorId,
        aggregateId: value.quotationId,
        subjectType: "quotation",
        subjectId: value.quotationId,
        metadata: {
          lead_id: leadId,
          channel_ref: value.channelRef,
          external_ref: value.externalRef,
        },
        occurredAt: now,
      });
    return { id: value.quotationId, leadId };
  });
}

export async function recordFollowUp(
  input: unknown,
  actorId: string,
  database: Database = getDatabase(),
) {
  const value = followUpFormSchema.parse(input);
  const now = new Date();
  return database.transaction(async (tx) => {
    await assertSalesProject(tx, value.projectId, actorId);
    const [record] = await tx
      .select({ payload: aggregateRecord.payload, state: aggregateRecord.state })
      .from(aggregateRecord)
      .innerJoin(workspaceProjectItem, eq(workspaceProjectItem.aggregateId, aggregateRecord.id))
      .where(
        and(
          eq(aggregateRecord.id, value.leadId),
          eq(aggregateRecord.type, "lead"),
          eq(workspaceProjectItem.projectId, value.projectId),
          eq(workspaceProjectItem.role, "sales_lead"),
        ),
      )
      .for("update");
    if (!record || record.state !== "FOLLOW_UP") throw new Error("只有跟进中的线索可以发送回复。");
    const lead = validateLead(record.payload);
    if (!lead.conversation_ref) throw new Error("该线索没有可发送的渠道会话，请先关联入站消息。");
    const [conversation] = await tx
      .select()
      .from(socialConversation)
      .where(
        and(
          eq(socialConversation.id, lead.conversation_ref),
          eq(socialConversation.leadId, value.leadId),
        ),
      )
      .for("update");
    if (!conversation) throw new Error("该线索未关联授权可见的渠道会话。");
    const [control] = await tx
      .select()
      .from(socialChannelControl)
      .where(
        and(
          eq(socialChannelControl.channelRef, conversation.channelRef),
          eq(socialChannelControl.accountRef, conversation.accountRef),
        ),
      )
      .for("update");
    if (!control?.enabled || control.circuitStatus !== "active")
      throw new Error("渠道未启用或已暂停，不能发送回复。");
    const [latestInbound] = await tx
      .select({
        id: socialMessage.id,
        externalMessageRef: socialMessage.externalMessageRef,
        receivedAt: socialMessage.receivedAt,
      })
      .from(socialMessage)
      .where(
        and(
          eq(socialMessage.conversationId, conversation.id),
          eq(socialMessage.direction, "inbound"),
          isNull(socialMessage.deletedAt),
          gt(socialMessage.expiresAt, now),
        ),
      )
      .orderBy(desc(socialMessage.receivedAt))
      .limit(1)
      .for("update");
    if (!latestInbound) throw new Error("没有仍在保留期内的入站消息，不能发送回复。");
    const window = assessReplyWindow(
      {
        channelRef: conversation.channelRef,
        accountRef: conversation.accountRef,
        transport: "camofox_controlled_mvp1",
        inboundOnly: true,
        replyWindowMinutes: 60,
        outsideWindowAction: "block",
      },
      {
        messageId: latestInbound.externalMessageRef,
        direction: "inbound",
        receivedAt: latestInbound.receivedAt.toISOString(),
      },
      now.toISOString(),
    );
    if (window.status !== "within_window")
      throw new Error("已超过渠道回复窗口；当前 MVP 禁止发送，需人工升级处理。");
    const controlledDraft = await prepareControlledFollowUp(
      tx,
      value.projectId,
      lead,
      value.context,
      value.draft,
      now,
    );
    const idempotencyKey = `reply:${value.projectId}:${value.leadId}:${value.confirmationRef}`;
    const existingJob = await tx.query.socialBrowserJob.findFirst({
      where: eq(socialBrowserJob.idempotencyKey, idempotencyKey),
    });
    if (existingJob) return lead;
    const jobId = randomUUID();
    const messageId = randomUUID();
    const storedMessage = createStoredSocialMessageRecord({
      id: messageId,
      conversationId: conversation.id,
      externalMessageRef: `pending-${jobId}`,
      direction: "outbound",
      identityQuality: "manual",
      body: controlledDraft,
      receivedAt: now,
    });
    await tx
      .insert(socialBrowserJob)
      .values({
        id: jobId,
        channelRef: conversation.channelRef,
        accountRef: conversation.accountRef,
        kind: "reply",
        idempotencyKey,
        payloadRef: messageId,
        status: "queued",
      });
    await tx.insert(socialMessage).values(storedMessage);
    const recommendation = nextFollowUp(value.context);
    const scoring = scoreLead(value.triggeredRules);
    const next = validateLead({
      ...lead,
      status: "follow_up",
      follow_up_context: value.context,
      score: scoring.score,
      score_band: scoring.status,
      score_reasons: scoring.evidence,
      next_action: recommendation.action,
      last_outbound_ref: jobId,
      ...(value.nextFollowUpAt
        ? { next_follow_up_at: new Date(value.nextFollowUpAt).toISOString() }
        : {}),
    });
    await tx
      .update(aggregateRecord)
      .set({ payload: next, version: sql`${aggregateRecord.version} + 1` })
      .where(eq(aggregateRecord.id, value.leadId));
    await tx
      .insert(auditEvent)
      .values({
        id: randomUUID(),
        action: "lead.follow_up_submitted",
        actorType: "human",
        actorId,
        aggregateId: value.leadId,
        subjectType: "lead",
        subjectId: value.leadId,
        metadata: {
          context: value.context,
          score: scoring.score,
          browser_job_id: jobId,
          confirmation_ref: value.confirmationRef,
          reply_window: window.status,
          draft_length: controlledDraft.length,
          delivery_confirmation_ref: lead.delivery_confirmation_ref ?? null,
        },
        occurredAt: now,
      });
    return next;
  });
}

/** Applies one signed Worker result. Any uncertain reply pauses the channel and cannot be retried automatically. */
export async function recordControlledReplyResult(
  input: unknown,
  database: Database = getDatabase(),
) {
  const value = replyResultSchema.parse(input);
  const now = new Date();
  return database.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(socialBrowserJob)
      .where(eq(socialBrowserJob.id, value.jobId))
      .for("update");
    if (!job || job.kind !== "reply") throw new Error("回复任务不存在。");
    const [message] = await tx
      .select()
      .from(socialMessage)
      .where(eq(socialMessage.id, job.payloadRef))
      .for("update");
    if (!message || message.direction !== "outbound") throw new Error("回复任务缺少待发送消息。");
    const [conversation] = await tx
      .select()
      .from(socialConversation)
      .where(eq(socialConversation.id, message.conversationId))
      .for("update");
    if (!conversation?.leadId) throw new Error("回复任务未关联有效线索。");
    if (["succeeded", "failed", "paused"].includes(job.status)) {
      if (
        value.outcome === "sent" &&
        job.status === "succeeded" &&
        job.resultRef === value.externalMessageRef
      )
        return job;
      if (
        value.outcome !== "sent" &&
        job.status === "paused" &&
        job.failureCode === value.failureCode
      )
        return job;
      throw new Error("回复任务已经终结，不能用不同结果覆盖。");
    }
    const [control] = await tx
      .select()
      .from(socialChannelControl)
      .where(
        and(
          eq(socialChannelControl.channelRef, job.channelRef),
          eq(socialChannelControl.accountRef, job.accountRef),
        ),
      )
      .for("update");
    if (value.outcome === "sent") {
      if (!control?.enabled || control.circuitStatus !== "active")
        throw new Error("渠道已暂停，不能接受成功发送结果。");
      const [duplicate] = await tx
        .select({ id: socialMessage.id })
        .from(socialMessage)
        .where(
          and(
            eq(socialMessage.conversationId, message.conversationId),
            eq(socialMessage.externalMessageRef, value.externalMessageRef!),
            ne(socialMessage.id, message.id),
          ),
        )
        .limit(1);
      if (duplicate) throw new Error("平台消息凭证已被其他消息使用。");
      const [saved] = await tx
        .update(socialBrowserJob)
        .set({
          status: "succeeded",
          resultRef: value.externalMessageRef,
          failureCode: null,
          updatedAt: now,
        })
        .where(eq(socialBrowserJob.id, job.id))
        .returning();
      await tx
        .update(socialMessage)
        .set({ externalMessageRef: value.externalMessageRef!, receivedAt: now })
        .where(eq(socialMessage.id, message.id));
      await tx
        .update(socialConversation)
        .set({ lastMessageAt: now, updatedAt: now })
        .where(eq(socialConversation.id, conversation.id));
      await tx
        .insert(auditEvent)
        .values({
          id: randomUUID(),
          action: "lead.follow_up_sent",
          actorType: "system",
          actorId: "social-worker",
          aggregateId: conversation.leadId,
          subjectType: "social_message",
          subjectId: message.id,
          metadata: { browser_job_id: job.id, external_message_ref: value.externalMessageRef },
          occurredAt: now,
        });
      return saved;
    }
    const [saved] = await tx
      .update(socialBrowserJob)
      .set({ status: "paused", resultRef: null, failureCode: value.failureCode, updatedAt: now })
      .where(eq(socialBrowserJob.id, job.id))
      .returning();
    if (control)
      await tx
        .update(socialChannelControl)
        .set({
          circuitStatus: "paused",
          pauseReason: value.outcome === "unknown" ? "external_result_unknown" : value.failureCode,
          pauseEvidenceRef: job.id,
          changedAt: now,
          updatedAt: now,
        })
        .where(eq(socialChannelControl.id, control.id));
    await tx
      .insert(auditEvent)
      .values({
        id: randomUUID(),
        action: `lead.follow_up_${value.outcome}`,
        actorType: "system",
        actorId: "social-worker",
        aggregateId: conversation.leadId,
        subjectType: "social_message",
        subjectId: message.id,
        metadata: { browser_job_id: job.id, failure_code: value.failureCode, retry_allowed: false },
        occurredAt: now,
      });
    return saved;
  });
}

export async function confirmOpportunity(
  input: unknown,
  actorId: string,
  database: Database = getDatabase(),
) {
  const value = opportunityDecisionFormSchema.parse(input);
  const now = new Date();
  return database.transaction(async (tx) => {
    await assertSalesProject(tx, value.projectId, actorId);
    const [record] = await tx
      .select({ payload: aggregateRecord.payload, state: aggregateRecord.state })
      .from(aggregateRecord)
      .innerJoin(workspaceProjectItem, eq(workspaceProjectItem.aggregateId, aggregateRecord.id))
      .where(
        and(
          eq(aggregateRecord.id, value.leadId),
          eq(aggregateRecord.type, "lead"),
          eq(workspaceProjectItem.projectId, value.projectId),
          eq(workspaceProjectItem.role, "sales_lead"),
        ),
      )
      .for("update");
    const lead = record?.payload as LeadRecord | undefined;
    if (!record || record.state !== "FOLLOW_UP" || lead?.score_band !== "HOT")
      throw new Error("只有达到 HOT 的跟进线索才能由人工确认有效商机。");
    const next = validateLead({
      ...lead,
      status: "opportunity",
      next_action: "human_manage_opportunity",
    });
    await tx
      .update(aggregateRecord)
      .set({ state: "OPPORTUNITY", payload: next, version: sql`${aggregateRecord.version} + 1` })
      .where(eq(aggregateRecord.id, value.leadId));
    await tx
      .insert(workflowEvent)
      .values({
        id: randomUUID(),
        aggregateId: value.leadId,
        fromState: "FOLLOW_UP",
        toState: "OPPORTUNITY",
        actorType: "human",
        actorId,
        evidenceRefs: [value.evidenceRef],
        occurredAt: now,
      });
    await tx
      .insert(auditEvent)
      .values({
        id: randomUUID(),
        action: "lead.opportunity_confirmed",
        actorType: "human",
        actorId,
        aggregateId: value.leadId,
        subjectType: "lead",
        subjectId: value.leadId,
        metadata: { evidence_ref: value.evidenceRef },
        occurredAt: now,
      });
    return next;
  });
}

export async function createDeliveryRequest(
  input: unknown,
  actorId: string,
  database: Database = getDatabase(),
) {
  const value = deliveryRequestFormSchema.parse(input);
  const now = new Date();
  return database.transaction(async (tx) => {
    await assertSalesProject(tx, value.projectId, actorId);
    const [lead] = await tx
      .select({ state: aggregateRecord.state, payload: aggregateRecord.payload })
      .from(aggregateRecord)
      .innerJoin(workspaceProjectItem, eq(workspaceProjectItem.aggregateId, aggregateRecord.id))
      .where(
        and(
          eq(aggregateRecord.id, value.leadId),
          eq(aggregateRecord.type, "lead"),
          eq(workspaceProjectItem.projectId, value.projectId),
          eq(workspaceProjectItem.role, "sales_lead"),
        ),
      )
      .for("update");
    if (!lead || lead.state !== "FOLLOW_UP") throw new Error("只有跟进中的线索可以申请交期确认。");
    const leadPayload = validateLead(lead.payload);
    if (!leadPayload.rfq_ref) throw new Error("交期确认必须引用当前线索的 RFQ。");
    if (leadPayload.delivery_confirmation_ref) {
      const [existing] = await tx
        .select({ state: aggregateRecord.state })
        .from(aggregateRecord)
        .where(
          and(
            eq(aggregateRecord.id, leadPayload.delivery_confirmation_ref),
            eq(aggregateRecord.type, "delivery_confirmation"),
          ),
        )
        .for("update");
      if (
        existing &&
        ["DELIVERY_CONFIRMATION_PENDING", "DELIVERY_CONFIRMATION_CONFIRMED"].includes(
          existing.state,
        )
      )
        return { id: leadPayload.delivery_confirmation_ref };
    }
    const id = randomUUID();
    const approvalId = randomUUID();
    const confirmation = requestDeliveryConfirmation({
      confirmationId: id,
      relatedEntityType: "rfq",
      relatedEntityId: leadPayload.rfq_ref,
      requestedByType: "human",
      requestedById: actorId,
      requestedAt: now.toISOString(),
    });
    await tx
      .insert(aggregateRecord)
      .values({
        id,
        type: "delivery_confirmation",
        state: "DELIVERY_CONFIRMATION_PENDING",
        payload: confirmation,
        createdByType: "human",
        createdById: actorId,
      });
    await tx
      .insert(workspaceProjectItem)
      .values({
        id: randomUUID(),
        projectId: value.projectId,
        aggregateId: id,
        role: "delivery_confirmation",
        relation: "owned",
      });
    await tx
      .insert(approval)
      .values({
        id: approvalId,
        aggregateId: id,
        gate: "gate_03_delivery",
        status: "pending",
        requestedByType: "human",
        requestedById: actorId,
        requestedAt: now,
      });
    await tx
      .update(aggregateRecord)
      .set({
        payload: validateLead({ ...leadPayload, delivery_confirmation_ref: id }),
        version: sql`${aggregateRecord.version} + 1`,
      })
      .where(eq(aggregateRecord.id, value.leadId));
    await tx
      .insert(auditEvent)
      .values({
        id: randomUUID(),
        action: "delivery_confirmation.requested",
        actorType: "human",
        actorId,
        aggregateId: id,
        subjectType: "delivery_confirmation",
        subjectId: id,
        metadata: { lead_id: value.leadId, evidence_ref: value.evidenceRef },
        occurredAt: now,
      });
    return { id };
  });
}

export async function decideDelivery(
  input: unknown,
  actorId: string,
  database: Database = getDatabase(),
) {
  const value = deliveryDecisionFormSchema.parse(input);
  const now = new Date();
  return database.transaction(async (tx) => {
    await assertSalesProject(tx, value.projectId, actorId);
    const [record] = await tx
      .select({ payload: aggregateRecord.payload, state: aggregateRecord.state })
      .from(aggregateRecord)
      .innerJoin(workspaceProjectItem, eq(workspaceProjectItem.aggregateId, aggregateRecord.id))
      .where(
        and(
          eq(aggregateRecord.id, value.confirmationId),
          eq(aggregateRecord.type, "delivery_confirmation"),
          eq(workspaceProjectItem.projectId, value.projectId),
          eq(workspaceProjectItem.role, "delivery_confirmation"),
        ),
      )
      .for("update");
    if (!record || record.state !== "DELIVERY_CONFIRMATION_PENDING")
      throw new Error("该交期确认当前不可审核。");
    const [pending] = await tx
      .select()
      .from(approval)
      .where(
        and(
          eq(approval.aggregateId, value.confirmationId),
          eq(approval.gate, "gate_03_delivery"),
          eq(approval.status, "pending"),
        ),
      )
      .for("update");
    if (!pending) throw new Error("未找到 Gate 03 待审核请求。");
    const next = decideDeliveryConfirmation(validateDeliveryConfirmation(record.payload), {
      actorType: "human",
      actorId,
      status: value.decision,
      approvalRef: pending.id,
      evidenceRef: value.evidenceRef,
      decidedAt: now.toISOString(),
      ...(value.decision === "confirmed"
        ? {
            leadTimeDays: Number(value.leadTimeDays),
            validUntil: new Date(now.getTime() + DELIVERY_CONFIRMATION_VALIDITY_MS).toISOString(),
          }
        : {}),
    });
    const nextState =
      value.decision === "confirmed"
        ? "DELIVERY_CONFIRMATION_CONFIRMED"
        : "DELIVERY_CONFIRMATION_REJECTED";
    await tx
      .update(approval)
      .set({
        status: value.decision === "confirmed" ? "approved" : "rejected",
        decidedByType: "human",
        decidedById: actorId,
        decidedAt: now,
        evidenceRef: value.evidenceRef,
        notes: value.notes || null,
      })
      .where(eq(approval.id, pending.id));
    await tx
      .update(aggregateRecord)
      .set({ state: nextState, payload: next, version: sql`${aggregateRecord.version} + 1` })
      .where(eq(aggregateRecord.id, value.confirmationId));
    await tx
      .insert(workflowEvent)
      .values({
        id: randomUUID(),
        aggregateId: value.confirmationId,
        fromState: "DELIVERY_CONFIRMATION_PENDING",
        toState: nextState,
        actorType: "human",
        actorId,
        gate: "gate_03_delivery",
        approvalId: pending.id,
        evidenceRefs: [value.evidenceRef],
        occurredAt: now,
      });
    await tx
      .insert(auditEvent)
      .values({
        id: randomUUID(),
        action: "delivery_confirmation.gate_03_decided",
        actorType: "human",
        actorId,
        aggregateId: value.confirmationId,
        subjectType: "delivery_confirmation",
        subjectId: value.confirmationId,
        metadata: { decision: value.decision },
        occurredAt: now,
      });
    return { id: value.confirmationId, state: nextState };
  });
}

async function latestApprovals(
  ids: string[],
  gate: "gate_02_quote" | "gate_03_delivery",
  database: Database,
) {
  if (!ids.length)
    return new Map<string, { id: string; status: "pending" | "approved" | "rejected" }>();
  const rows = await database
    .select({ id: approval.id, aggregateId: approval.aggregateId, status: approval.status })
    .from(approval)
    .where(and(inArray(approval.aggregateId, ids), eq(approval.gate, gate)))
    .orderBy(desc(approval.requestedAt));
  const result = new Map<string, { id: string; status: "pending" | "approved" | "rejected" }>();
  for (const row of rows)
    if (!result.has(row.aggregateId))
      result.set(row.aggregateId, { id: row.id, status: row.status });
  return result;
}

export async function listProjectQuotations(
  projectId: string,
  database: Database = getDatabase(),
): Promise<QuotationEntry[]> {
  const rows = await database
    .select({ record: aggregateRecord })
    .from(workspaceProjectItem)
    .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
    .where(
      and(
        eq(workspaceProjectItem.projectId, projectId),
        eq(workspaceProjectItem.role, "sales_quotation"),
        eq(aggregateRecord.type, "quotation"),
      ),
    )
    .orderBy(desc(workspaceProjectItem.createdAt));
  const approvals = await latestApprovals(
    rows.map(({ record }) => record.id),
    "gate_02_quote",
    database,
  );
  return rows.map(({ record }) => {
    const item = approvals.get(record.id);
    const payload = record.payload as unknown as QuotationHandoff & { product_id?: string };
    return {
      id: record.id,
      state: record.state,
      createdAt: record.createdAt,
      quotation: payload,
      productId: payload.product_id ?? "",
      approvalId: item?.id ?? null,
      approvalStatus: item?.status ?? null,
    };
  });
}

export async function listProjectLeads(
  projectId: string,
  actorId: string,
  database: Database = getDatabase(),
): Promise<LeadEntry[]> {
  await assertWorkspaceProjectAccess(projectId, actorId, "view", database);
  const rows = await database
    .select({ record: aggregateRecord })
    .from(workspaceProjectItem)
    .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
    .where(
      and(
        eq(workspaceProjectItem.projectId, projectId),
        eq(workspaceProjectItem.role, "sales_lead"),
        eq(aggregateRecord.type, "lead"),
      ),
    )
    .orderBy(desc(workspaceProjectItem.createdAt));
  const parsedRows = rows.flatMap(({ record }) => {
    const parsed = (() => {
      try {
        return validateLead(record.payload);
      } catch {
        return null;
      }
    })();
    return parsed ? [{ record, lead: parsed }] : [];
  });
  const conversationIds = parsedRows.flatMap(({ lead }) =>
    lead.conversation_ref ? [lead.conversation_ref] : [],
  );
  const conversations = conversationIds.length
    ? await database
        .select({ id: socialConversation.id, leadId: socialConversation.leadId })
        .from(socialConversation)
        .where(inArray(socialConversation.id, conversationIds))
    : [];
  const linkedConversations = new Set(
    conversations.map((conversation) => `${conversation.id}:${conversation.leadId}`),
  );
  const messages = conversationIds.length
    ? await database
        .select({
          id: socialMessage.id,
          conversationId: socialMessage.conversationId,
          direction: socialMessage.direction,
          bodyCiphertext: socialMessage.bodyCiphertext,
          receivedAt: socialMessage.receivedAt,
        })
        .from(socialMessage)
        .where(
          and(
            inArray(socialMessage.conversationId, conversationIds),
            isNull(socialMessage.deletedAt),
            gt(socialMessage.expiresAt, new Date()),
          ),
        )
        .orderBy(socialMessage.receivedAt)
        .limit(200)
    : [];
  const messageIds = messages.map((message) => message.id);
  const jobs = messageIds.length
    ? await database
        .select({ payloadRef: socialBrowserJob.payloadRef, status: socialBrowserJob.status })
        .from(socialBrowserJob)
        .where(
          and(eq(socialBrowserJob.kind, "reply"), inArray(socialBrowserJob.payloadRef, messageIds)),
        )
    : [];
  const jobByMessage = new Map(jobs.map((job) => [job.payloadRef, job.status]));
  const deliveryIds = parsedRows.flatMap(({ lead }) =>
    lead.delivery_confirmation_ref ? [lead.delivery_confirmation_ref] : [],
  );
  const deliveryRows = deliveryIds.length
    ? await database
        .select({
          id: aggregateRecord.id,
          state: aggregateRecord.state,
          payload: aggregateRecord.payload,
        })
        .from(aggregateRecord)
        .where(
          and(
            inArray(aggregateRecord.id, deliveryIds),
            eq(aggregateRecord.type, "delivery_confirmation"),
          ),
        )
    : [];
  const deliveries = new Map(
    deliveryRows.flatMap((row) => {
      try {
        const confirmation = validateDeliveryConfirmation(row.payload);
        const validUntil = confirmation.result?.valid_until;
        const days = confirmation.result?.confirmed_lead_time_days;
        return row.state === "DELIVERY_CONFIRMATION_CONFIRMED" &&
          validUntil &&
          Date.parse(validUntil) > Date.now() &&
          Number.isInteger(days)
          ? [[row.id, { id: row.id, leadTimeDays: days!, validUntil }] as const]
          : [];
      } catch {
        return [];
      }
    }),
  );
  return parsedRows.map(
    ({ record, lead }): LeadEntry => ({
      id: record.id,
      state: record.state,
      createdAt: record.createdAt,
      lead,
      replyAvailable: Boolean(
        lead.conversation_ref && linkedConversations.has(`${lead.conversation_ref}:${record.id}`),
      ),
      confirmedDelivery: lead.delivery_confirmation_ref
        ? (deliveries.get(lead.delivery_confirmation_ref) ?? null)
        : null,
      timeline: messages
        .filter((message) => message.conversationId === lead.conversation_ref)
        .map((message) => ({
          id: message.id,
          direction: message.direction === "outbound" ? "outbound" : "inbound",
          body: decryptSocialMessageBody(message.bodyCiphertext),
          receivedAt: message.receivedAt,
          deliveryStatus:
            message.direction === "inbound"
              ? "received"
              : ((
                  {
                    queued: "queued",
                    claimed: "claimed",
                    succeeded: "sent",
                    failed: "failed",
                    paused: "paused",
                  } as const
                )[
                  jobByMessage.get(message.id) as
                    | "queued"
                    | "claimed"
                    | "succeeded"
                    | "failed"
                    | "paused"
                ] ?? "sent"),
        })),
    }),
  );
}

export async function listProjectDeliveryConfirmations(
  projectId: string,
  database: Database = getDatabase(),
): Promise<DeliveryConfirmationEntry[]> {
  const rows = await database
    .select({ record: aggregateRecord })
    .from(workspaceProjectItem)
    .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
    .where(
      and(
        eq(workspaceProjectItem.projectId, projectId),
        eq(workspaceProjectItem.role, "delivery_confirmation"),
        eq(aggregateRecord.type, "delivery_confirmation"),
      ),
    )
    .orderBy(desc(workspaceProjectItem.createdAt));
  const approvals = await latestApprovals(
    rows.map(({ record }) => record.id),
    "gate_03_delivery",
    database,
  );
  return rows.map(({ record }) => {
    const item = approvals.get(record.id);
    return {
      id: record.id,
      state: record.state,
      createdAt: record.createdAt,
      confirmation: record.payload,
      approvalId: item?.id ?? null,
      approvalStatus: item?.status ?? null,
    };
  });
}
