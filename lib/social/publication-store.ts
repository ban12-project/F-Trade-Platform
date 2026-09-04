import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { publishContent } from "@/lib/content/gate";
import { getDatabase, type Database } from "@/lib/db/client";
import { aggregateRecord, approval, auditEvent, socialChannelControl, socialPublication, workspaceProject, workspaceProjectItem } from "@/lib/db/schema";
import { publicationConfirmationFormSchema } from "@/lib/form-schemas";
import { assertWorkspaceProjectAccess } from "@/lib/workspace/access";

export type PublicationCandidate = { id: string; format: "text" | "video"; title: string; preview: string };
export type PublicationChannel = { channelRef: string; accountRef: string };
export type PublicationEntry = { id: string; contentRef: string; format: string; channelRef: string; accountRef: string; externalPublicationRef: string | null; status: string; createdAt: Date };

export async function listProjectPublicationData(projectId: string, database: Database = getDatabase()) {
  const [projectRecords, channels] = await Promise.all([
    database.select({ record: aggregateRecord }).from(workspaceProjectItem).innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId)).where(and(eq(workspaceProjectItem.projectId, projectId), inArray(workspaceProjectItem.role, ["marketing_content", "marketing_video"]))),
    database.select({ channelRef: socialChannelControl.channelRef, accountRef: socialChannelControl.accountRef }).from(socialChannelControl).where(and(eq(socialChannelControl.enabled, true), eq(socialChannelControl.circuitStatus, "active"))).orderBy(desc(socialChannelControl.changedAt)),
  ]);
  const projectRecordIds = projectRecords.map(({ record }) => record.id);
  const publications = projectRecordIds.length
    ? await database.select().from(socialPublication).where(inArray(socialPublication.contentRef, projectRecordIds)).orderBy(desc(socialPublication.createdAt)).limit(50)
    : [];
  const publishedRefs = new Set(publications.map((item) => item.contentRef));
  const records = projectRecords.filter(({ record }) => ["CONTENT_APPROVED", "VIDEO_APPROVED"].includes(record.state) && !publishedRefs.has(record.id));
  const ids = records.map(({ record }) => record.id);
  const approvals = ids.length ? await database.select({ aggregateId: approval.aggregateId }).from(approval).where(and(inArray(approval.aggregateId, ids), eq(approval.gate, "gate_01_truth"), eq(approval.status, "approved"))) : [];
  const approved = new Set(approvals.map((item) => item.aggregateId));
  const candidates: PublicationCandidate[] = records.flatMap(({ record }): PublicationCandidate[] => {
    if (!approved.has(record.id)) return [];
    const payload = record.payload as Record<string, any>;
    if (record.type === "content" && payload.status === "approved") return [{ id: record.id, format: "text", title: typeof payload.hook === "string" ? payload.hook : "已批准营销内容", preview: typeof payload.body === "string" ? payload.body : "" }];
    if (record.type === "video" && record.state === "VIDEO_APPROVED") return [{ id: record.id, format: "video", title: typeof payload.objective === "string" ? payload.objective : "已批准营销视频", preview: "已批准的私有视频成片；发布前请再次核对平台预览。" }];
    return [];
  });
  return { candidates, channels, publications: publications as PublicationEntry[] };
}

export async function confirmExternalPublication(input: unknown, actorId: string, database: Database = getDatabase()) {
  const value = publicationConfirmationFormSchema.parse(input); const now = new Date();
  return database.transaction(async (tx) => {
    await assertWorkspaceProjectAccess(value.projectId, actorId, "write", tx);
    const [project] = await tx.select({ kind: workspaceProject.kind }).from(workspaceProject).where(eq(workspaceProject.id, value.projectId)).for("update");
    if (!project || project.kind !== "marketing") throw new Error("发布只能从产品营销项目发起。");
    const [control] = await tx.select().from(socialChannelControl).where(and(eq(socialChannelControl.channelRef, value.channelRef), eq(socialChannelControl.accountRef, value.accountRef))).for("update");
    if (!control?.enabled || control.circuitStatus !== "active") throw new Error("渠道未启用或已暂停，不能登记发布。");
    const [record] = await tx.select({ type: aggregateRecord.type, state: aggregateRecord.state, payload: aggregateRecord.payload }).from(workspaceProjectItem).innerJoin(aggregateRecord, eq(aggregateRecord.id, workspaceProjectItem.aggregateId)).where(and(eq(workspaceProjectItem.projectId, value.projectId), eq(workspaceProjectItem.aggregateId, value.contentRef), inArray(workspaceProjectItem.role, ["marketing_content", "marketing_video"]))).for("update");
    if (!record || !["CONTENT_APPROVED", "VIDEO_APPROVED"].includes(record.state)) throw new Error("只有 Gate 01 已批准内容或视频可以发布。");
    if ((record.type === "video") !== (value.format === "video")) throw new Error("发布格式与已批准记录类型不一致。");
    const [gate] = await tx.select({ id: approval.id }).from(approval).where(and(eq(approval.aggregateId, value.contentRef), eq(approval.gate, "gate_01_truth"), eq(approval.status, "approved"))).orderBy(desc(approval.requestedAt)).limit(1);
    if (!gate) throw new Error("缺少 Gate 01 批准记录。");
    const existing = await tx.query.socialPublication.findFirst({ where: and(eq(socialPublication.channelRef, value.channelRef), eq(socialPublication.accountRef, value.accountRef), eq(socialPublication.externalPublicationRef, value.externalPublicationRef)) });
    if (existing) {
      if (existing.contentRef !== value.contentRef) throw new Error("该平台发布凭证已被其他内容使用。");
      return existing;
    }
    const id = randomUUID();
    const [saved] = await tx.insert(socialPublication).values({ id, channelRef: value.channelRef, accountRef: value.accountRef, contentRef: value.contentRef, format: value.format, confirmationRef: value.confirmationRef, externalPublicationRef: value.externalPublicationRef, status: "published", publishedAt: now }).returning();
    if (record.type === "content") await tx.update(aggregateRecord).set({ state: "CONTENT_PUBLISHED", payload: publishContent(record.payload, "human", value.externalPublicationRef), version: sql`${aggregateRecord.version} + 1` }).where(eq(aggregateRecord.id, value.contentRef));
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "social_publication.human_confirmed", actorType: "human", actorId, aggregateId: value.contentRef, subjectType: "social_publication", subjectId: id, metadata: { project_id: value.projectId, channel_ref: value.channelRef, account_ref: value.accountRef, confirmation_ref: value.confirmationRef, external_publication_ref: value.externalPublicationRef, gate_01_approval_id: gate.id }, occurredAt: now });
    return saved;
  });
}
