import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import leadSchema from "@/contracts/sales/lead.schema.json";
import { compileContract } from "@/lib/contracts/validator";
import { type Database, getDatabase } from "@/lib/db/client";
import {
  aggregateRecord,
  auditEvent,
  socialConversation,
  workspaceProject,
  workspaceProjectItem,
  workspaceProjectMember,
} from "@/lib/db/schema";
import { inboundRoutingFormSchema } from "@/lib/form-schemas";
import { assertWorkspaceProjectAccess } from "@/lib/workspace/access";
import {
  assertSocialAuthorizationAlive,
  authorizeSocialActor,
  parseSocialActorIdentity,
  type SocialActorIdentity,
  SocialHumanAccessError,
} from "./human-write-access";
import {
  assertInboundMessagesRetained,
  inboundContextDigest,
  lockInboundConversationAccount,
  readRetainedInboundMessages,
} from "./inbound-context-store";

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

export async function listUnassignedInboundConversations(
  database: Database = getDatabase(),
): Promise<InboundRoutingSummary[]> {
  const rows = await database
    .select({
      id: socialConversation.id,
      channelRef: socialConversation.channelRef,
      lastMessageAt: socialConversation.lastMessageAt,
    })
    .from(socialConversation)
    .where(isNull(socialConversation.leadId))
    .orderBy(desc(socialConversation.lastMessageAt));
  return rows.map((row) => ({
    id: row.id,
    channelLabel: row.channelRef,
    shortReference: shortReference(row.id),
    lastMessageAt: row.lastMessageAt,
  }));
}

export async function routeInboundConversation(
  input: unknown,
  identityInput: SocialActorIdentity,
  database: Database = getDatabase(),
) {
  const value = inboundRoutingFormSchema.parse(input);
  const identity = parseSocialActorIdentity(identityInput);
  const actorId = identity.actorId;
  return database.transaction(async (tx) => {
    const scope = await lockInboundConversationAccount(tx, value.conversationId, actorId);
    const [conversation] = await tx
      .select({
        id: socialConversation.id,
        channelRef: socialConversation.channelRef,
        accountRef: socialConversation.accountRef,
        lastMessageAt: socialConversation.lastMessageAt,
        leadId: socialConversation.leadId,
      })
      .from(socialConversation)
      .where(eq(socialConversation.id, value.conversationId))
      .for("update");
    if (!conversation) throw new Error("入站消息不存在或已过期。");
    if (conversation.leadId) throw new Error("该入站消息已完成分流，请刷新工作台。");

    if (
      conversation.channelRef !== scope.channelRef ||
      conversation.accountRef !== scope.accountRef
    )
      throw new SocialHumanAccessError();
    if (conversation.lastMessageAt.toISOString() !== value.reviewedMessageAt)
      throw new Error("入站消息已有更新，请重新查看上下文并确认分流。");

    let projectId = value.projectId || "";
    if (value.mode === "link") {
      await assertWorkspaceProjectAccess(projectId, actorId, "write", tx);
      const [project] = await tx
        .select({ kind: workspaceProject.kind, status: workspaceProject.status })
        .from(workspaceProject)
        .where(eq(workspaceProject.id, projectId))
        .for("share");
      const [member] = await tx
        .select({ id: workspaceProjectMember.id })
        .from(workspaceProjectMember)
        .where(
          and(
            eq(workspaceProjectMember.projectId, projectId),
            eq(workspaceProjectMember.userId, actorId),
            inArray(workspaceProjectMember.role, ["owner", "editor"]),
          ),
        )
        .for("share");
      if (project?.kind !== "sales" || project.status !== "active" || !member)
        throw new SocialHumanAccessError();
    }
    // Revalidate after conversation/account/project lock waits, then reserve the actor
    // through ciphertext access and commit. Earlier locks must not hide revocation.
    const expiresAt = await authorizeSocialActor(tx, identity, ["sales:write"]);
    const reviewedMessages = await readRetainedInboundMessages(tx, conversation.id);
    if (!reviewedMessages.length) throw new Error("没有仍在保留期内的入站消息，请刷新后核对。");
    if (
      inboundContextDigest(reviewedMessages, conversation.lastMessageAt) !==
      value.reviewedContextDigest
    )
      throw new Error("入站消息已有更新，请重新查看上下文并确认分流。");

    if (value.mode === "create") {
      projectId = randomUUID();
      const now = new Date();
      await tx.insert(workspaceProject).values({
        id: projectId,
        title: `入站线索 ${shortReference(conversation.id)}`,
        kind: "sales",
        createdById: actorId,
      });
      await tx.insert(workspaceProjectMember).values({
        id: randomUUID(),
        projectId,
        userId: actorId,
        role: "owner",
        createdById: actorId,
      });
      await tx.insert(auditEvent).values({
        id: randomUUID(),
        action: "workspace_project.created_from_inbound",
        actorType: "human",
        actorId,
        subjectType: "workspace_project",
        subjectId: projectId,
        metadata: { source: "inbound_routing" },
        occurredAt: now,
      });
    }

    const leadId = randomUUID();
    const lead = validateLead({
      lead_id: leadId,
      channel_ref: conversation.channelRef,
      conversation_ref: conversation.id,
      status: "received",
      score: 0,
      score_reasons: [],
      next_action: "collect_rfq",
    });
    await tx.insert(aggregateRecord).values({
      id: leadId,
      type: "lead",
      state: "LEAD_RECEIVED",
      payload: lead,
      createdByType: "human",
      createdById: actorId,
    });
    await tx.insert(workspaceProjectItem).values({
      id: randomUUID(),
      projectId,
      aggregateId: leadId,
      role: "sales_lead",
      relation: "owned",
    });
    await tx
      .update(socialConversation)
      .set({ leadId, updatedAt: new Date() })
      .where(and(eq(socialConversation.id, conversation.id), isNull(socialConversation.leadId)));
    await tx
      .update(workspaceProject)
      .set({ updatedAt: new Date() })
      .where(eq(workspaceProject.id, projectId));
    await tx.insert(auditEvent).values({
      id: randomUUID(),
      action: "social_inbound.routed",
      actorType: "human",
      actorId,
      aggregateId: leadId,
      subjectType: "social_conversation",
      subjectId: conversation.id,
      metadata: { project_id: projectId, mode: value.mode, channel_ref: conversation.channelRef },
      occurredAt: new Date(),
    });
    assertSocialAuthorizationAlive(expiresAt);
    assertInboundMessagesRetained(reviewedMessages);
    return { projectId, leadId };
  });
}
