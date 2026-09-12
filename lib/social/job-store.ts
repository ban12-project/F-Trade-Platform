import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";

import leadSchema from "@/contracts/sales/lead.schema.json";
import { compileContract } from "@/lib/contracts/validator";
import { type Database, getDatabase } from "@/lib/db/client";
import {
  aggregateRecord,
  auditEvent,
  socialBrowserJob,
  socialChannelControl,
  socialConversation,
  socialMessage,
  socialPublication,
  workflowEvent,
} from "@/lib/db/schema";
import {
  expireDeliveryConfirmation,
  validateDeliveryConfirmation,
} from "@/lib/delivery/confirmation";
import { assessReplyWindow } from "@/lib/social/inbound-policy";
import { decryptSocialMessageBody } from "@/lib/social/message-crypto";
import { digestSocialWorkerPayload, signSocialWorkerCommand } from "@/lib/social/worker-protocol";
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
  follow_up_context?: string;
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
        const [leadRow] = await tx
          .select({ state: aggregateRecord.state, payload: aggregateRecord.payload })
          .from(aggregateRecord)
          .where(and(eq(aggregateRecord.id, conversation.leadId), eq(aggregateRecord.type, "lead")))
          .for("update");
        if (!leadRow || leadRow.state !== "FOLLOW_UP")
          throw new PreflightRejection(
            "lead_not_in_follow_up",
            "线索已不处于跟进状态，不能发送回复。",
          );
        const lead = validateWorkerLead(leadRow.payload);
        if (
          lead.follow_up_context === "asks_lead_time" ||
          lead.follow_up_context === "asks_sample"
        ) {
          if (!lead.delivery_confirmation_ref)
            throw new PreflightRejection("gate_03_missing", "回复缺少 Gate 03 交期确认。");
          const [deliveryRow] = await tx
            .select({ state: aggregateRecord.state, payload: aggregateRecord.payload })
            .from(aggregateRecord)
            .where(
              and(
                eq(aggregateRecord.id, lead.delivery_confirmation_ref),
                eq(aggregateRecord.type, "delivery_confirmation"),
              ),
            )
            .for("update");
          if (!deliveryRow || deliveryRow.state !== "DELIVERY_CONFIRMATION_CONFIRMED")
            throw new PreflightRejection("gate_03_not_confirmed", "Gate 03 未确认，不能发送回复。");
          const delivery = validateDeliveryConfirmation(deliveryRow.payload);
          const validUntil = delivery.result?.valid_until;
          if (delivery.related_entity_id !== lead.rfq_ref || !validUntil)
            throw new PreflightRejection("gate_03_mismatch", "Gate 03 与当前 RFQ 不匹配。");
          if (Date.parse(validUntil) <= now.getTime()) {
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
          now.toISOString(),
        );
        if (window.status !== "within_window") {
          throw new PreflightRejection("reply_window_expired", "渠道回复窗口已过期。");
        }
        payload = {
          conversationRef: conversation.externalConversationRef,
          text: decryptSocialMessageBody(message.bodyCiphertext),
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
