import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { publishContent } from "@/lib/content/gate";
import { type Database, type DatabaseTransaction, getDatabase } from "@/lib/db/client";
import { productMediaAsset } from "@/lib/db/product-media-schema";
import {
  aggregateRecord,
  approval,
  auditEvent,
  socialBrowserJob,
  socialChannelControl,
  socialPublication,
  workspaceProject,
  workspaceProjectItem,
} from "@/lib/db/schema";
import { publicationConfirmationFormSchema, publicationResultSchema } from "@/lib/form-schemas";
import { assertVideoPublicationEligible, videoProjectSchema } from "@/lib/video/contracts";
import {
  assertCurrentProductMediaUsage,
  productMediaIdsForVideoProject,
  productMediaRuntimeRecordFromRow,
} from "@/lib/video/product-media-runtime-policy";
import { assertWorkspaceProjectAccess } from "@/lib/workspace/access";

import { createControlledPublicationCommand } from "./publication-command";

export type PublicationCandidate = {
  id: string;
  format: "text" | "video";
  title: string;
  preview: string;
};
export type PublicationChannel = { channelRef: string; accountRef: string };
export type PublicationEntry = {
  id: string;
  projectId: string;
  contentRef: string;
  format: string;
  channelRef: string;
  accountRef: string;
  externalPublicationRef: string | null;
  status: string;
  createdAt: Date;
};

export async function assertPublicationEligible(
  value: {
    projectId: string;
    contentRef: string;
    format: "text" | "image" | "video";
    channelRef: string;
    accountRef: string;
  },
  tx: DatabaseTransaction,
  now: Date,
) {
  const [project] = await tx
    .select({ kind: workspaceProject.kind })
    .from(workspaceProject)
    .where(eq(workspaceProject.id, value.projectId))
    .for("update");
  if (!project || project.kind !== "marketing") throw new Error("发布只能从产品营销项目发起。");
  const [control] = await tx
    .select()
    .from(socialChannelControl)
    .where(
      and(
        eq(socialChannelControl.channelRef, value.channelRef),
        eq(socialChannelControl.accountRef, value.accountRef),
      ),
    )
    .for("update");
  if (!control?.enabled || control.circuitStatus !== "active")
    throw new Error("渠道未启用或已暂停，不能提交发布。");
  const [record] = await tx
    .select({
      type: aggregateRecord.type,
      state: aggregateRecord.state,
      payload: aggregateRecord.payload,
    })
    .from(workspaceProjectItem)
    .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
    .where(
      and(
        eq(workspaceProjectItem.projectId, value.projectId),
        eq(workspaceProjectItem.aggregateId, value.contentRef),
        inArray(workspaceProjectItem.role, ["marketing_content", "marketing_video"]),
      ),
    )
    .for("update");
  if (!record || !["CONTENT_APPROVED", "VIDEO_APPROVED"].includes(record.state))
    throw new Error("只有 Gate 01 已批准内容或视频可以发布。");
  if ((record.type === "video") !== (value.format === "video"))
    throw new Error("发布格式与已批准记录类型不一致。");
  const [gate] = await tx
    .select({ id: approval.id })
    .from(approval)
    .where(
      and(
        eq(approval.aggregateId, value.contentRef),
        eq(approval.gate, "gate_01_truth"),
        eq(approval.status, "approved"),
      ),
    )
    .orderBy(desc(approval.requestedAt))
    .limit(1);
  if (!gate) throw new Error("缺少 Gate 01 批准记录。");
  if (record.type === "video") {
    const video = videoProjectSchema.parse(record.payload);
    assertVideoPublicationEligible(video);
    const mediaIds = productMediaIdsForVideoProject(video);
    const [product] = await tx
      .select({ id: aggregateRecord.id, state: aggregateRecord.state })
      .from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, video.productId), eq(aggregateRecord.type, "product")))
      .for("update");
    if (!product || product.state !== "PRODUCT_READY")
      throw new Error("视频引用的产品已不再处于 ProductReady，不能发布。");
    const mediaRows = mediaIds.length
      ? await tx
          .select()
          .from(productMediaAsset)
          .where(inArray(productMediaAsset.id, mediaIds))
          .for("update")
      : [];
    assertCurrentProductMediaUsage(
      video,
      mediaRows.map(productMediaRuntimeRecordFromRow),
      "organic",
      now,
    );
  }
  return { control, record, gate };
}

export async function listProjectPublicationData(
  projectId: string,
  database: Database = getDatabase(),
) {
  const [projectRecords, channels] = await Promise.all([
    database
      .select({ record: aggregateRecord })
      .from(workspaceProjectItem)
      .innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId))
      .where(
        and(
          eq(workspaceProjectItem.projectId, projectId),
          inArray(workspaceProjectItem.role, ["marketing_content", "marketing_video"]),
        ),
      ),
    database
      .select({
        channelRef: socialChannelControl.channelRef,
        accountRef: socialChannelControl.accountRef,
      })
      .from(socialChannelControl)
      .where(
        and(
          eq(socialChannelControl.enabled, true),
          eq(socialChannelControl.circuitStatus, "active"),
        ),
      )
      .orderBy(desc(socialChannelControl.changedAt)),
  ]);
  const projectRecordIds = projectRecords.map(({ record }) => record.id);
  const publications = projectRecordIds.length
    ? await database
        .select()
        .from(socialPublication)
        .where(inArray(socialPublication.contentRef, projectRecordIds))
        .orderBy(desc(socialPublication.createdAt))
        .limit(50)
    : [];
  const publishedRefs = new Set(publications.map((item) => item.contentRef));
  const records = projectRecords.filter(
    ({ record }) =>
      ["CONTENT_APPROVED", "VIDEO_APPROVED"].includes(record.state) &&
      !publishedRefs.has(record.id),
  );
  const ids = records.map(({ record }) => record.id);
  const approvals = ids.length
    ? await database
        .select({ aggregateId: approval.aggregateId })
        .from(approval)
        .where(
          and(
            inArray(approval.aggregateId, ids),
            eq(approval.gate, "gate_01_truth"),
            eq(approval.status, "approved"),
          ),
        )
    : [];
  const approved = new Set(approvals.map((item) => item.aggregateId));
  const candidates: PublicationCandidate[] = records.flatMap(
    ({ record }): PublicationCandidate[] => {
      if (!approved.has(record.id)) return [];
      const payload = record.payload as Record<string, any>;
      if (record.type === "content" && payload.status === "approved")
        return [
          {
            id: record.id,
            format: "text",
            title: typeof payload.hook === "string" ? payload.hook : "已批准营销内容",
            preview: typeof payload.body === "string" ? payload.body : "",
          },
        ];
      if (record.type === "video" && record.state === "VIDEO_APPROVED")
        return [
          {
            id: record.id,
            format: "video",
            title: typeof payload.objective === "string" ? payload.objective : "已批准营销视频",
            preview: "已批准的私有视频成片；发布前请再次核对平台预览。",
          },
        ];
      return [];
    },
  );
  return { candidates, channels, publications: publications as PublicationEntry[] };
}

export async function submitControlledPublication(
  input: unknown,
  actorId: string,
  database: Database = getDatabase(),
) {
  const value = publicationConfirmationFormSchema.parse(input);
  const now = new Date();
  return database.transaction(async (tx) => {
    await assertWorkspaceProjectAccess(value.projectId, actorId, "write", tx);
    const { control, record, gate } = await assertPublicationEligible(value, tx, now);
    const idempotencyKey = `publish:${value.projectId}:${value.contentRef}:${value.channelRef}:${value.accountRef}:${value.confirmationRef}`;
    const existingJob = await tx.query.socialBrowserJob.findFirst({
      where: eq(socialBrowserJob.idempotencyKey, idempotencyKey),
    });
    if (existingJob) {
      const existing = await tx.query.socialPublication.findFirst({
        where: eq(socialPublication.browserJobId, existingJob.id),
      });
      if (!existing) throw new Error("发布任务存在但发布记录缺失，请暂停渠道并人工核对。");
      return existing;
    }
    const id = randomUUID();
    const jobId = randomUUID();
    createControlledPublicationCommand(
      { ...(record.payload as Record<string, unknown>), status: "approved", approval_ref: gate.id },
      {
        channelRef: value.channelRef,
        accountRef: value.accountRef,
        transport: "camofox_controlled_mvp1",
        publishingEnabled: control.enabled,
      },
      {
        channelRef: value.channelRef,
        accountRef: value.accountRef,
        status: "active",
        stopReason: null,
        pausedAt: null,
      },
      {
        publicationId: id,
        contentRef: value.contentRef,
        format: value.format,
        humanConfirmationRef: value.confirmationRef,
        confirmedBy: "human",
      },
    );
    await tx.insert(socialBrowserJob).values({
      id: jobId,
      channelRef: value.channelRef,
      accountRef: value.accountRef,
      kind: "publish",
      idempotencyKey,
      payloadRef: id,
      status: "queued",
    });
    const [saved] = await tx
      .insert(socialPublication)
      .values({
        id,
        projectId: value.projectId,
        channelRef: value.channelRef,
        accountRef: value.accountRef,
        contentRef: value.contentRef,
        format: value.format,
        confirmationRef: value.confirmationRef,
        browserJobId: jobId,
        status: "submitted",
      })
      .returning();
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "social_publication.submitted",
      actorType: "human",
      actorId,
      aggregateId: value.contentRef,
      subjectType: "social_publication",
      subjectId: id,
      metadata: {
        project_id: value.projectId,
        channel_ref: value.channelRef,
        account_ref: value.accountRef,
        confirmation_ref: value.confirmationRef,
        browser_job_id: jobId,
        gate_01_approval_id: gate.id,
      },
      occurredAt: now,
    });
    return saved;
  });
}

/** Applies one terminal worker result. Unknown and failed effects pause the channel and are never requeued. */
export async function recordControlledPublicationResult(
  input: unknown,
  database: Database = getDatabase(),
) {
  const value = publicationResultSchema.parse(input);
  const now = new Date();
  return database.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(socialBrowserJob)
      .where(eq(socialBrowserJob.id, value.jobId))
      .for("update");
    if (!job || job.kind !== "publish") throw new Error("发布任务不存在。");
    const [publication] = await tx
      .select()
      .from(socialPublication)
      .where(eq(socialPublication.browserJobId, job.id))
      .for("update");
    if (!publication) throw new Error("发布任务缺少关联发布记录。");
    if (["succeeded", "failed", "paused"].includes(job.status)) {
      if (
        value.outcome === "published" &&
        job.status === "succeeded" &&
        publication.externalPublicationRef === value.externalPublicationRef
      )
        return publication;
      if (
        value.outcome !== "published" &&
        ["failed", "paused"].includes(job.status) &&
        publication.status === value.outcome &&
        job.failureCode === value.failureCode
      )
        return publication;
      throw new Error("发布任务已经终结，不能用不同结果覆盖。");
    }
    if (value.outcome === "published") {
      const { record } = await assertPublicationEligible(
        {
          projectId: publication.projectId,
          contentRef: publication.contentRef,
          format: publication.format as "text" | "image" | "video",
          channelRef: publication.channelRef,
          accountRef: publication.accountRef,
        },
        tx,
        now,
      );
      const [duplicate] = await tx
        .select({ id: socialPublication.id })
        .from(socialPublication)
        .where(
          and(
            eq(socialPublication.channelRef, publication.channelRef),
            eq(socialPublication.accountRef, publication.accountRef),
            eq(socialPublication.externalPublicationRef, value.externalPublicationRef!),
          ),
        )
        .limit(1);
      if (duplicate && duplicate.id !== publication.id)
        throw new Error("平台发布凭证已被其他发布记录使用。");
      await tx
        .update(socialBrowserJob)
        .set({
          status: "succeeded",
          resultRef: value.externalPublicationRef,
          failureCode: null,
          updatedAt: now,
        })
        .where(eq(socialBrowserJob.id, job.id));
      const [saved] = await tx
        .update(socialPublication)
        .set({
          status: "published",
          externalPublicationRef: value.externalPublicationRef,
          publishedAt: now,
          updatedAt: now,
        })
        .where(eq(socialPublication.id, publication.id))
        .returning();
      if (record.type === "content")
        await tx
          .update(aggregateRecord)
          .set({
            state: "CONTENT_PUBLISHED",
            payload: publishContent(record.payload, "human", value.externalPublicationRef!),
            version: sql`${aggregateRecord.version} + 1`,
          })
          .where(eq(aggregateRecord.id, publication.contentRef));
      await tx.insert(auditEvent).values({
        id: randomUUID(),
        action: "social_publication.published",
        actorType: "system",
        actorId: "social-worker",
        aggregateId: publication.contentRef,
        subjectType: "social_publication",
        subjectId: publication.id,
        metadata: {
          project_id: publication.projectId,
          browser_job_id: job.id,
          external_publication_ref: value.externalPublicationRef,
        },
        occurredAt: now,
      });
      return saved;
    }
    const status = value.outcome === "unknown" ? "unknown" : "failed";
    await tx
      .update(socialBrowserJob)
      .set({ status: "paused", failureCode: value.failureCode, resultRef: null, updatedAt: now })
      .where(eq(socialBrowserJob.id, job.id));
    const [saved] = await tx
      .update(socialPublication)
      .set({ status, updatedAt: now })
      .where(eq(socialPublication.id, publication.id))
      .returning();
    await tx
      .update(socialChannelControl)
      .set({
        circuitStatus: "paused",
        pauseReason: value.outcome === "unknown" ? "external_result_unknown" : value.failureCode,
        pauseEvidenceRef: publication.confirmationRef,
        changedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(socialChannelControl.channelRef, publication.channelRef),
          eq(socialChannelControl.accountRef, publication.accountRef),
        ),
      );
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: `social_publication.${status}`,
      actorType: "system",
      actorId: "social-worker",
      aggregateId: publication.contentRef,
      subjectType: "social_publication",
      subjectId: publication.id,
      metadata: {
        project_id: publication.projectId,
        browser_job_id: job.id,
        failure_code: value.failureCode,
        retry_allowed: false,
      },
      occurredAt: now,
    });
    return saved;
  });
}
