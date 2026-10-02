import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { hasPermission } from "../authz";
import { type FleetState, LIVE_STATUSES } from "../browser-fleet/policy";
import { publishContent } from "../content/gate";
import { type Database, getDatabase } from "../db/client";
import { facebookPublicationManifest } from "../db/facebook-runtime-schema";
import {
  aggregateRecord,
  approval,
  auditEvent,
  socialBrowserJob,
  socialPublication,
  user,
} from "../db/schema";
import { assertWorkspaceProjectAccess } from "../workspace/access";
import { parseFacebookMediaPayload } from "./facebook-media-contract";
import { buildFacebookMediaPayload } from "./facebook-media-store";
import { facebookTextPayloadSchema } from "./facebook-worker-protocol";
import {
  publicationReconciliationSchema,
  videoPublicationReconciliationSchema,
} from "./publication-reconciliation-schema";
import { digestSocialWorkerPayload } from "./worker-protocol";

/** Human attestation of a past effect, never a new posting authorization.
 * Preserve the immutable node receipt and paused channel/account. Current text
 * confirmation must still describe exactly the payload disclosed to the node.
 */
export async function reconcileUnknownTextPublication(
  input: unknown,
  actorId: string,
  db: Database = getDatabase(),
) {
  const value = publicationReconciliationSchema.parse(input);
  return db.transaction(async (tx) => {
    const [actor] = await tx.select().from(user).where(eq(user.id, actorId));
    if (
      !actor ||
      actor.banned ||
      !hasPermission(actor.role, "settings:manage") ||
      !hasPermission(actor.role, "content:review")
    )
      throw new Error("需要节点所有者的管理与审核权限。");
    await assertWorkspaceProjectAccess(value.projectId, actorId, "receipt", tx);
    const locations =
      await tx.execute(sql`SELECT p.node_id, p.job_id FROM browser_fleet_publication p
      JOIN social_publication s ON s.browser_job_id = p.job_id WHERE s.id = ${value.publicationId} AND s.project_id = ${value.projectId}`);
    const location = locations.rows[0];
    if (!location) throw new Error("未找到可核对的节点发布记录。");
    const nodes = await tx.execute(
      sql`SELECT owner_id, document FROM browser_fleet_node WHERE id = ${location.node_id} FOR UPDATE`,
    );
    if (nodes.rows[0]?.owner_id !== actorId) throw new Error("只有原节点所有者可以核对结果。");
    const state = nodes.rows[0].document as FleetState;
    if (
      state.version !== 1 ||
      state.runs.some((run) => run.jobRef === location.job_id && LIVE_STATUSES.includes(run.status))
    )
      throw new Error("请先确认原浏览器任务已停止。");
    const reservations = await tx.execute(
      sql`SELECT * FROM browser_fleet_publication WHERE job_id = ${location.job_id} FOR UPDATE`,
    );
    const reservation = reservations.rows[0];
    const [job] = await tx
      .select()
      .from(socialBrowserJob)
      .where(eq(socialBrowserJob.id, String(location.job_id)))
      .for("update");
    const [publication] = await tx
      .select()
      .from(socialPublication)
      .where(eq(socialPublication.id, value.publicationId))
      .for("update");
    if (
      !job ||
      !publication ||
      publication.projectId !== value.projectId ||
      publication.browserJobId !== job.id ||
      job.payloadRef !== publication.id ||
      job.kind !== "publish" ||
      publication.format !== "text"
    )
      throw new Error("本次核对只支持原节点的文字发布记录。");
    if (publication.status === "published") {
      const [prior] = await tx
        .select()
        .from(auditEvent)
        .where(
          and(
            eq(auditEvent.subjectId, publication.id),
            eq(auditEvent.action, "social_publication.reconciled"),
          ),
        );
      if (
        prior?.metadata.evidence_ref === value.evidenceRef &&
        publication.externalPublicationRef === value.externalPublicationRef
      )
        return { id: publication.id, replayed: true };
      throw new Error("结果已确认，不能覆盖已有凭证。");
    }
    if (
      publication.status !== "unknown" ||
      job.status !== "paused" ||
      !reservation?.authorization_id ||
      !reservation.payload ||
      job.channelRef !== publication.channelRef ||
      job.accountRef !== publication.accountRef
    )
      throw new Error("原任务不是可核对的未知结果。");
    const payload = facebookTextPayloadSchema.parse(reservation.payload);
    const confirmation = publication.textConfirmation;
    const [content] = await tx
      .select()
      .from(aggregateRecord)
      .where(eq(aggregateRecord.id, publication.contentRef))
      .for("update");
    const [gate] = confirmation
      ? await tx
          .select()
          .from(approval)
          .where(
            and(
              eq(approval.aggregateId, publication.contentRef),
              eq(approval.gate, "gate_01_truth"),
            ),
          )
          .orderBy(desc(approval.requestedAt), desc(approval.createdAt), desc(approval.id))
          .limit(1)
      : [];
    if (
      !confirmation ||
      !content ||
      content.type !== "content" ||
      content.state !== "CONTENT_APPROVED" ||
      content.version !== confirmation.contentVersion ||
      payload.publicationId !== publication.id ||
      payload.accountRef !== publication.accountRef ||
      payload.channelRef !== publication.channelRef ||
      payload.text !== content.payload.body ||
      digestSocialWorkerPayload(payload) !== confirmation.payloadDigest ||
      gate?.id !== confirmation.approvalRef ||
      gate?.aggregateId !== content.id ||
      gate.gate !== "gate_01_truth" ||
      gate.status !== "approved"
    )
      throw new Error("内容或原确认已变化，请保留未知结果并人工调查。");
    const now = new Date();
    await tx
      .update(socialBrowserJob)
      .set({
        status: "succeeded",
        resultRef: value.externalPublicationRef,
        failureCode: null,
        updatedAt: now,
      })
      .where(eq(socialBrowserJob.id, job.id));
    await tx
      .update(socialPublication)
      .set({
        status: "published",
        externalPublicationRef: value.externalPublicationRef,
        updatedAt: now,
      })
      .where(eq(socialPublication.id, publication.id));
    await tx
      .update(aggregateRecord)
      .set({
        state: "CONTENT_PUBLISHED",
        payload: publishContent(content.payload, "human", value.externalPublicationRef),
        version: content.version + 1,
      })
      .where(eq(aggregateRecord.id, content.id));
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      actorType: "human",
      actorId,
      action: "social_publication.reconciled",
      subjectType: "social_publication",
      subjectId: publication.id,
      aggregateId: content.id,
      metadata: {
        job_id: job.id,
        evidence_ref: value.evidenceRef,
        payload_digest: confirmation.payloadDigest,
        original_receipt_preserved: true,
        retry_allowed: false,
        original_publication_time_unknown: true,
      },
      occurredAt: now,
    });
    return { id: publication.id, replayed: false };
  });
}

/** Reconcile an already-posted Reel from independent human observation.
 * This never manufactures a node success receipt, a platform timestamp or a retry.
 */
export async function reconcileUnknownVideoPublication(
  input: unknown,
  actorId: string,
  db: Database = getDatabase(),
) {
  const value = videoPublicationReconciliationSchema.parse(input);
  return db.transaction(async (tx) => {
    const [actor] = await tx.select().from(user).where(eq(user.id, actorId));
    if (
      !actor ||
      actor.banned ||
      !hasPermission(actor.role, "settings:manage") ||
      !hasPermission(actor.role, "content:review")
    )
      throw new Error("需要节点所有者的管理与审核权限。");
    await assertWorkspaceProjectAccess(value.projectId, actorId, "receipt", tx);
    const locations =
      await tx.execute(sql`SELECT p.node_id, p.job_id FROM browser_fleet_publication p
      JOIN social_publication s ON s.browser_job_id = p.job_id WHERE s.id = ${value.publicationId} AND s.project_id = ${value.projectId}`);
    const location = locations.rows[0];
    if (!location) throw new Error("未找到可核对的节点发布记录。");
    const nodes = await tx.execute(
      sql`SELECT owner_id, document FROM browser_fleet_node WHERE id = ${location.node_id} FOR UPDATE`,
    );
    if (nodes.rows[0]?.owner_id !== actorId) throw new Error("只有原节点所有者可以核对结果。");
    const state = nodes.rows[0].document as FleetState;
    if (
      state.version !== 1 ||
      state.runs.some((run) => run.jobRef === location.job_id && LIVE_STATUSES.includes(run.status))
    )
      throw new Error("请先确认原浏览器任务已停止。");
    const reservations = await tx.execute(
      sql`SELECT * FROM browser_fleet_publication WHERE job_id = ${location.job_id} FOR UPDATE`,
    );
    const reservation = reservations.rows[0];
    const [job] = await tx
      .select()
      .from(socialBrowserJob)
      .where(eq(socialBrowserJob.id, String(location.job_id)))
      .for("update");
    const [publication] = await tx
      .select()
      .from(socialPublication)
      .where(eq(socialPublication.id, value.publicationId))
      .for("update");
    if (
      !job ||
      !publication ||
      publication.projectId !== value.projectId ||
      publication.browserJobId !== job.id ||
      job.payloadRef !== publication.id ||
      job.kind !== "publish" ||
      publication.format !== "video"
    )
      throw new Error("本次核对只支持原节点的视频发布记录。");
    if (publication.status === "published") {
      const [prior] = await tx
        .select()
        .from(auditEvent)
        .where(
          and(
            eq(auditEvent.subjectId, publication.id),
            eq(auditEvent.action, "social_publication.reconciled"),
          ),
        );
      if (
        prior?.metadata.evidence_ref === value.evidenceRef &&
        publication.externalPublicationRef === value.externalPublicationRef
      )
        return { id: publication.id, replayed: true };
      throw new Error("结果已确认，不能覆盖已有凭证。");
    }
    const receipt = reservation?.receipt as Record<string, unknown> | null;
    if (
      publication.status !== "unknown" ||
      job.status !== "paused" ||
      !reservation?.authorization_id ||
      !reservation.payload ||
      !receipt ||
      receipt.outcome !== "unknown" ||
      receipt.authorizationId !== reservation.authorization_id ||
      job.channelRef !== publication.channelRef ||
      job.accountRef !== publication.accountRef
    )
      throw new Error("原任务不是可核对的未知结果。");
    const payload = parseFacebookMediaPayload(reservation.payload);
    const [manifest] = await tx
      .select()
      .from(facebookPublicationManifest)
      .where(eq(facebookPublicationManifest.publicationId, publication.id));
    const [content] = await tx
      .select()
      .from(aggregateRecord)
      .where(eq(aggregateRecord.id, publication.contentRef))
      .for("update");
    const expected = await buildFacebookMediaPayload(tx, publication, new Date());
    const digest = digestSocialWorkerPayload(payload);
    if (
      !manifest ||
      !content ||
      content.type !== "video" ||
      content.state !== "VIDEO_APPROVED" ||
      content.version !== manifest.contentVersion ||
      manifest.format !== "video" ||
      payload.format !== "video" ||
      payload.publicationId !== publication.id ||
      payload.channelRef !== publication.channelRef ||
      payload.accountRef !== publication.accountRef ||
      digest !== digestSocialWorkerPayload(expected) ||
      receipt.payloadDigest !== digest
    )
      throw new Error("视频或原确认已变化，请保留未知结果并人工调查。");
    const now = new Date();
    await tx
      .update(socialBrowserJob)
      .set({
        status: "succeeded",
        resultRef: value.externalPublicationRef,
        failureCode: null,
        updatedAt: now,
      })
      .where(eq(socialBrowserJob.id, job.id));
    await tx
      .update(socialPublication)
      .set({
        status: "published",
        externalPublicationRef: value.externalPublicationRef,
        updatedAt: now,
      })
      .where(eq(socialPublication.id, publication.id));
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      actorType: "human",
      actorId,
      action: "social_publication.reconciled",
      subjectType: "social_publication",
      subjectId: publication.id,
      aggregateId: content.id,
      metadata: {
        format: "video",
        job_id: job.id,
        evidence_ref: value.evidenceRef,
        payload_digest: digest,
        human_attestation: true,
        original_receipt_preserved: true,
        retry_allowed: false,
        original_publication_time_unknown: true,
      },
      occurredAt: now,
    });
    return { id: publication.id, replayed: false };
  });
}
