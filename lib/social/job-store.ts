import { assertAggregateWorkspaceWrite } from "@/lib/workspace/access";
import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
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
  socialPublication,
  workflowEvent,
  workspaceProjectItem,
} from "@/lib/db/schema";
import {
  expireDeliveryConfirmation,
  validateDeliveryConfirmation,
} from "@/lib/delivery/confirmation";
import { deliverySuffix, hasDeliveryClaim, replyBasis } from "@/lib/follow-up/controlled-reply";
import { assessReplyWindow } from "@/lib/social/inbound-policy";
import { decryptSocialMessageBody } from "@/lib/social/message-crypto";
import { digestSocialWorkerPayload, signSocialWorkerCommand } from "@/lib/social/worker-protocol";
import { type FollowUpContext, needsDeliveryConfirmation } from "../follow-up/cadence";
import { buildFacebookPublicationPayload } from "./facebook-media-store";
import {
  configuredFacebookWorkerScope,
  type FacebookWorkerScope,
} from "./facebook-worker-protocol";

export type ClaimedSocialJob = {
  command: ReturnType<typeof signSocialWorkerCommand>;
  payload: Record<string, unknown>;
};

type WorkerLead = {
  follow_up_context?: FollowUpContext;
  delivery_confirmation_ref?: string;
  rfq_ref?: string;
};
const validateWorkerLead = compileContract<WorkerLead>(leadSchema);

class PreflightRejection extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const CLAIM_RESULT_TIMEOUT_MS = 10 * 60_000;

async function pauseExpiredClaims(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  scope: FacebookWorkerScope,
  now: Date,
) {
  const cutoff = new Date(now.getTime() - CLAIM_RESULT_TIMEOUT_MS);
  const staleJobs = await tx
    .select()
    .from(socialBrowserJob)
    .where(
      and(
        eq(socialBrowserJob.status, "claimed"),
        lt(socialBrowserJob.updatedAt, cutoff),
        eq(socialBrowserJob.channelRef, scope.channelRef),
        eq(socialBrowserJob.accountRef, scope.accountRef),
        sql`NOT EXISTS (SELECT 1 FROM browser_fleet_binding b WHERE b.channel_ref = ${socialBrowserJob.channelRef} AND b.account_ref = ${socialBrowserJob.accountRef})`,
        sql`NOT EXISTS (SELECT 1 FROM browser_fleet_publication p WHERE p.job_id = ${socialBrowserJob.id})`,
      ),
    )
    .for("update", { skipLocked: true });
  for (const stale of staleJobs) {
    await tx
      .update(socialBrowserJob)
      .set({ status: "paused", failureCode: "worker_result_timeout", updatedAt: now })
      .where(and(eq(socialBrowserJob.id, stale.id), eq(socialBrowserJob.status, "claimed")));
    if (stale.kind === "publish")
      await tx
        .update(socialPublication)
        .set({ status: "unknown", updatedAt: now })
        .where(eq(socialPublication.id, stale.payloadRef));
    await tx
      .update(socialChannelControl)
      .set({
        circuitStatus: "paused",
        pauseReason: "external_result_unknown",
        pauseEvidenceRef: stale.id,
        changedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(socialChannelControl.channelRef, stale.channelRef),
          eq(socialChannelControl.accountRef, stale.accountRef),
        ),
      );
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "social_browser_job.result_timeout",
      actorType: "system",
      actorId: scope.workerId,
      subjectType: "social_browser_job",
      subjectId: stale.id,
      metadata: { job_kind: stale.kind, retry_allowed: false },
      occurredAt: now,
    });
  }
}

async function verifyQueuedReplyApproval(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  job: typeof socialBrowserJob.$inferSelect,
  message: typeof socialMessage.$inferSelect,
  leadId: string,
  text: string,
  workerId: string,
  now: Date,
) {
  const submissions = await tx
    .select({ metadata: auditEvent.metadata, at: auditEvent.occurredAt })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.action, "lead.follow_up_submitted"),
        eq(auditEvent.actorType, "human"),
        eq(auditEvent.subjectType, "lead"),
        eq(auditEvent.subjectId, leadId),
        eq(auditEvent.aggregateId, leadId),
        sql`${auditEvent.metadata}->>'browser_job_id' = ${job.id}`,
      ),
    )
    .limit(2);
  const submission = submissions[0];
  const meta = submission?.metadata;
  const unverified = () =>
    new PreflightRejection("reply_approval_unverified", "无法核实原回复的审批依据，请人工复核。");
  const owners = await tx
    .select({ projectId: workspaceProjectItem.projectId })
    .from(workspaceProjectItem)
    .where(
      and(
        eq(workspaceProjectItem.aggregateId, leadId),
        eq(workspaceProjectItem.role, "sales_lead"),
        eq(workspaceProjectItem.relation, "owned"),
      ),
    )
    .for("share");
  const projectId = owners.find((owner) =>
    job.idempotencyKey.startsWith(`reply:${owner.projectId}:${leadId}:`),
  )?.projectId;
  const pinned = meta && Object.hasOwn(meta, "reply_basis");
  const ordinary =
    !hasDeliveryClaim(text) &&
    !submissions.some((event) =>
      needsDeliveryConfirmation(event.metadata.context as FollowUpContext),
    );
  if (pinned && submissions.length !== 1) throw unverified();
  if (ordinary) {
    if (
      pinned &&
      (!projectId ||
        !isDeepStrictEqual(
          meta.reply_basis,
          replyBasis(projectId, message.id, message.bodyCiphertext, null),
        ))
    )
      throw unverified();
  } else {
    if (
      !projectId ||
      submissions.length !== 1 ||
      !needsDeliveryConfirmation(meta?.context as FollowUpContext) ||
      typeof meta?.delivery_confirmation_ref !== "string" ||
      message.externalMessageRef !== `pending-${job.id}` ||
      job.idempotencyKey !== `reply:${projectId}:${leadId}:${meta.confirmation_ref}`
    )
      throw unverified();
    const [deliveryRow] = await tx
      .select({ state: aggregateRecord.state, payload: aggregateRecord.payload })
      .from(aggregateRecord)
      .where(
        and(
          eq(aggregateRecord.id, meta.delivery_confirmation_ref),
          eq(aggregateRecord.type, "delivery_confirmation"),
        ),
      )
      .for("update");
    if (deliveryRow?.state !== "DELIVERY_CONFIRMATION_CONFIRMED")
      throw new PreflightRejection("gate_03_not_confirmed", "Gate 03 未确认，不能发送回复。");
    const delivery = validateDeliveryConfirmation(deliveryRow.payload);
    const validUntil = delivery.result?.valid_until;
    const result = delivery.result;
    if (
      delivery.status !== "confirmed" ||
      delivery.confirmation_id !== meta.delivery_confirmation_ref ||
      delivery.related_entity_type !== "rfq" ||
      !validUntil ||
      !delivery.approval_ref ||
      !result ||
      typeof result.confirmed_lead_time_days !== "number"
    )
      throw unverified();
    const suffix = deliverySuffix(result.confirmed_lead_time_days, validUntil);
    if (
      !text.endsWith(suffix) ||
      hasDeliveryClaim(text.slice(0, -suffix.length)) ||
      (pinned &&
        !isDeepStrictEqual(
          meta.reply_basis,
          replyBasis(projectId, message.id, message.bodyCiphertext, delivery),
        ))
    )
      throw unverified();
    const [decision] = await tx
      .select()
      .from(approval)
      .where(
        and(
          eq(approval.id, delivery.approval_ref),
          eq(approval.aggregateId, delivery.confirmation_id),
          eq(approval.gate, "gate_03_delivery"),
          eq(approval.status, "approved"),
          eq(approval.decidedByType, "human"),
          eq(approval.decidedById, result.decided_by),
          eq(approval.evidenceRef, result.evidence_ref),
        ),
      )
      .for("share");
    if (
      !decision?.decidedAt ||
      decision.decidedAt > submission.at ||
      Date.parse(result.decided_at) !== decision.decidedAt.getTime()
    )
      throw unverified();
    for (const [id, role] of [
      [delivery.confirmation_id, "delivery_confirmation"],
      [delivery.related_entity_id, "sales_rfq"],
    ] as const) {
      const [link] = await tx
        .select({ id: workspaceProjectItem.id })
        .from(workspaceProjectItem)
        .where(
          and(
            eq(workspaceProjectItem.projectId, projectId),
            eq(workspaceProjectItem.aggregateId, id),
            eq(workspaceProjectItem.role, role),
          ),
        )
        .for("share");
      if (!link) throw unverified();
    }
    if (Date.parse(validUntil) <= Math.max(now.getTime(), Date.now())) {
      await tx
        .update(aggregateRecord)
        .set({
          state: "DELIVERY_CONFIRMATION_EXPIRED",
          payload: expireDeliveryConfirmation(delivery, "system"),
          version: sql`${aggregateRecord.version} + 1`,
        })
        .where(eq(aggregateRecord.id, delivery.confirmation_id));
      await tx.insert(workflowEvent).values({
        id: randomUUID(),
        aggregateId: delivery.confirmation_id,
        fromState: "DELIVERY_CONFIRMATION_CONFIRMED",
        toState: "DELIVERY_CONFIRMATION_EXPIRED",
        actorType: "system",
        actorId: workerId,
        evidenceRefs: [],
        occurredAt: now,
      });
      await tx.insert(auditEvent).values({
        id: randomUUID(),
        action: "delivery_confirmation.expired_before_reply",
        actorType: "system",
        actorId: workerId,
        aggregateId: delivery.confirmation_id,
        subjectType: "delivery_confirmation",
        subjectId: delivery.confirmation_id,
        metadata: { browser_job_id: job.id },
        occurredAt: now,
      });
      throw new PreflightRejection("gate_03_expired", "Gate 03 已过期，不能发送回复。");
    }
  }
}

/** Claims at most one job for the single approved worker and revalidates every external-effect boundary. */
export async function claimNextSocialWorkerJob(
  workerId: string,
  now = new Date(),
  database: Database = getDatabase(),
): Promise<ClaimedSocialJob | null> {
  const scope = configuredFacebookWorkerScope();
  if (workerId !== scope.workerId) throw new Error("worker_scope_invalid");
  return database.transaction(async (tx) => {
    await pauseExpiredClaims(tx, scope, now);
    const [job] = await tx
      .select()
      .from(socialBrowserJob)
      .where(
        and(
          eq(socialBrowserJob.status, "queued"),
          sql`NOT EXISTS (SELECT 1 FROM social_publication p JOIN workspace_project w ON w.id = p.project_id WHERE p.browser_job_id = ${socialBrowserJob.id} AND w.status = 'archived')`,
          sql`NOT EXISTS (SELECT 1 FROM social_message m JOIN social_conversation c ON c.id = m.conversation_id JOIN workspace_project_item i ON i.aggregate_id = c.lead_id AND i.relation = 'owned' JOIN workspace_project w ON w.id = i.project_id WHERE m.id = ${socialBrowserJob.payloadRef} AND ${socialBrowserJob.kind} = 'reply' AND w.status = 'archived')`,
          eq(socialBrowserJob.channelRef, scope.channelRef),
          eq(socialBrowserJob.accountRef, scope.accountRef),
          sql`NOT EXISTS (SELECT 1 FROM browser_fleet_binding b WHERE b.channel_ref = ${socialBrowserJob.channelRef} AND b.account_ref = ${socialBrowserJob.accountRef})`,
          sql`NOT EXISTS (SELECT 1 FROM browser_fleet_publication p WHERE p.job_id = ${socialBrowserJob.id})`,
        ),
      )
      .orderBy(socialBrowserJob.createdAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!job) return null;
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
    if (!control?.enabled || control.circuitStatus !== "active") {
      await tx
        .update(socialBrowserJob)
        .set({ status: "paused", failureCode: "channel_not_active", updatedAt: now })
        .where(eq(socialBrowserJob.id, job.id));
      if (job.kind === "publish")
        await tx
          .update(socialPublication)
          .set({ status: "paused", updatedAt: now })
          .where(eq(socialPublication.id, job.payloadRef));
      await tx.insert(auditEvent).values({
        id: randomUUID(),
        action: "social_browser_job.preflight_paused",
        actorType: "system",
        actorId: workerId,
        subjectType: "social_browser_job",
        subjectId: job.id,
        metadata: {
          job_kind: job.kind,
          failure_code: "channel_not_active",
          retry_allowed: false,
        },
        occurredAt: now,
      });
      return null;
    }

    let payload: Record<string, unknown>;
    try {
      if (job.kind === "publish") {
        const [publication] = await tx
          .select()
          .from(socialPublication)
          .where(
            and(
              eq(socialPublication.id, job.payloadRef),
              eq(socialPublication.browserJobId, job.id),
            ),
          )
          .for("update");
        if (
          publication?.status !== "submitted" ||
          publication.channelRef !== job.channelRef ||
          publication.accountRef !== job.accountRef
        )
          throw new Error("发布任务与发布记录状态不一致。");
        payload = await buildFacebookPublicationPayload(tx, publication, now);
      } else if (job.kind === "reply") {
        const [message] = await tx
          .select()
          .from(socialMessage)
          .where(and(eq(socialMessage.id, job.payloadRef), eq(socialMessage.direction, "outbound")))
          .for("update");
        if (!message) throw new Error("回复任务缺少待发送消息。");
        const [conversation] = await tx
          .select()
          .from(socialConversation)
          .where(eq(socialConversation.id, message.conversationId))
          .for("update");
        if (
          !conversation?.leadId ||
          conversation.channelRef !== job.channelRef ||
          conversation.accountRef !== job.accountRef
        )
          throw new Error("回复任务与授权会话不一致。");
        await assertAggregateWorkspaceWrite(conversation.leadId, tx);
        const [leadRow] = await tx
          .select({ state: aggregateRecord.state, payload: aggregateRecord.payload })
          .from(aggregateRecord)
          .where(and(eq(aggregateRecord.id, conversation.leadId), eq(aggregateRecord.type, "lead")))
          .for("update");
        if (leadRow?.state !== "FOLLOW_UP")
          throw new PreflightRejection(
            "lead_not_in_follow_up",
            "线索已不处于跟进状态，不能发送回复。",
          );
        validateWorkerLead(leadRow.payload);
        const text = decryptSocialMessageBody(message.bodyCiphertext);
        const [latestInbound] = await tx
          .select({
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
        await verifyQueuedReplyApproval(tx, job, message, conversation.leadId, text, workerId, now);
        const window = assessReplyWindow(
          {
            channelRef: job.channelRef,
            accountRef: job.accountRef,
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
          new Date(Math.max(now.getTime(), Date.now())).toISOString(),
        );
        if (window.status !== "within_window") {
          throw new PreflightRejection("reply_window_expired", "渠道回复窗口已过期。");
        }
        payload = {
          conversationRef: conversation.externalConversationRef,
          text,
        };
      } else {
        throw new Error("队列包含不支持的社交任务类型。");
      }
    } catch (error) {
      const failureCode = error instanceof PreflightRejection ? error.code : "preflight_rejected";
      await tx
        .update(socialBrowserJob)
        .set({ status: "paused", failureCode, updatedAt: now })
        .where(eq(socialBrowserJob.id, job.id));
      if (job.kind === "publish")
        await tx
          .update(socialPublication)
          .set({ status: "paused", updatedAt: now })
          .where(eq(socialPublication.id, job.payloadRef));
      await tx.insert(auditEvent).values({
        id: randomUUID(),
        action: "social_browser_job.preflight_paused",
        actorType: "system",
        actorId: workerId,
        subjectType: "social_browser_job",
        subjectId: job.id,
        metadata: { job_kind: job.kind, failure_code: failureCode, retry_allowed: false },
        occurredAt: now,
      });
      return null;
    }

    await tx
      .update(socialBrowserJob)
      .set({ status: "claimed", updatedAt: now })
      .where(and(eq(socialBrowserJob.id, job.id), eq(socialBrowserJob.status, "queued")));
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "social_browser_job.claimed",
      actorType: "system",
      actorId: workerId,
      subjectType: "social_browser_job",
      subjectId: job.id,
      metadata: { job_kind: job.kind },
      occurredAt: now,
    });
    const command = signSocialWorkerCommand({
      commandId: randomUUID(),
      workerId,
      jobId: job.id,
      kind: job.kind as "publish" | "reply",
      payloadRef: job.payloadRef,
      payloadDigest: digestSocialWorkerPayload(payload),
      nonce: randomBytes(24).toString("base64url"),
      issuedAt: now,
      expiresAt: new Date(now.getTime() + 5 * 60_000),
    });
    return { command, payload };
  });
}
