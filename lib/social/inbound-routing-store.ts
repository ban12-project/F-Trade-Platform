import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, isNull } from "drizzle-orm";

import leadSchema from "@/contracts/sales/lead.schema.json";
import { compileContract } from "@/lib/contracts/validator";
import { getDatabase, type Database } from "@/lib/db/client";
import { aggregateRecord, auditEvent, socialConversation, workspaceCanvasDocument, workspaceProject, workspaceProjectItem, workspaceProjectMember } from "@/lib/db/schema";
import { inboundRoutingFormSchema } from "@/lib/form-schemas";
import { assertWorkspaceProjectAccess } from "@/lib/workspace/access";
import { createWorkspaceTemplate } from "@/lib/workspace/contracts";

type InitialLead = {
  lead_id: string;
  channel_ref: string;
  conversation_ref: string;
  status: "received";
  score: number;
  score_reasons: Array<{ rule_id: string; points: number }>;
  next_action: string;
};

const validateLead = compileContract<InitialLead>(leadSchema);

export type InboundRoutingSummary = {
  id: string;
  channelLabel: string;
  shortReference: string;
  lastMessageAt: Date;
};

function shortReference(id: string) {
  return createHash("sha256").update(id).digest("hex").slice(0, 8).toUpperCase();
}

export async function listUnassignedInboundConversations(database: Database = getDatabase()): Promise<InboundRoutingSummary[]> {
  const rows = await database.select({ id: socialConversation.id, channelRef: socialConversation.channelRef, lastMessageAt: socialConversation.lastMessageAt })
    .from(socialConversation)
    .where(isNull(socialConversation.leadId))
    .orderBy(desc(socialConversation.lastMessageAt));
  return rows.map((row) => ({ id: row.id, channelLabel: row.channelRef, shortReference: shortReference(row.id), lastMessageAt: row.lastMessageAt }));
}

export async function routeInboundConversation(input: unknown, actorId: string, database: Database = getDatabase()) {
  const value = inboundRoutingFormSchema.parse(input);
  return database.transaction(async (tx) => {
    const [conversation] = await tx.select({ id: socialConversation.id, channelRef: socialConversation.channelRef, leadId: socialConversation.leadId })
      .from(socialConversation)
      .where(eq(socialConversation.id, value.conversationId))
      .for("update");
    if (!conversation) throw new Error("入站消息不存在或已过期。");
    if (conversation.leadId) throw new Error("该入站消息已完成分流，请刷新工作台。");

    let projectId = value.projectId || "";
    if (value.mode === "create") {
      projectId = randomUUID();
      const now = new Date();
      await tx.insert(workspaceProject).values({ id: projectId, title: `入站线索 ${shortReference(conversation.id)}`, kind: "sales", createdById: actorId });
      await tx.insert(workspaceProjectMember).values({ id: randomUUID(), projectId, userId: actorId, role: "owner", createdById: actorId });
      await tx.insert(workspaceCanvasDocument).values({ id: randomUUID(), projectId, document: createWorkspaceTemplate("sales"), revision: 1 });
      await tx.insert(auditEvent).values({ id: randomUUID(), action: "workspace_project.created_from_inbound", actorType: "human", actorId, subjectType: "workspace_project", subjectId: projectId, metadata: { source: "inbound_routing" }, occurredAt: now });
    } else {
      await assertWorkspaceProjectAccess(projectId, actorId, "write", tx);
      const [project] = await tx.select({ kind: workspaceProject.kind }).from(workspaceProject).where(and(eq(workspaceProject.id, projectId), eq(workspaceProject.kind, "sales"))).for("update");
      if (!project) throw new Error("只能关联你可编辑的销售项目。");
    }

    const leadId = randomUUID();
    const lead = validateLead({ lead_id: leadId, channel_ref: conversation.channelRef, conversation_ref: conversation.id, status: "received", score: 0, score_reasons: [], next_action: "collect_rfq" });
    await tx.insert(aggregateRecord).values({ id: leadId, type: "lead", state: "LEAD_RECEIVED", payload: lead, createdByType: "human", createdById: actorId });
    await tx.insert(workspaceProjectItem).values({ id: randomUUID(), projectId, aggregateId: leadId, role: "sales_lead", relation: "owned" });
    await tx.update(socialConversation).set({ leadId, updatedAt: new Date() }).where(and(eq(socialConversation.id, conversation.id), isNull(socialConversation.leadId)));
    await tx.update(workspaceProject).set({ updatedAt: new Date() }).where(eq(workspaceProject.id, projectId));
    await tx.insert(auditEvent).values({ id: randomUUID(), action: "social_inbound.routed", actorType: "human", actorId, aggregateId: leadId, subjectType: "social_conversation", subjectId: conversation.id, metadata: { project_id: projectId, mode: value.mode, channel_ref: conversation.channelRef }, occurredAt: new Date() });
    return { projectId, leadId };
  });
}
