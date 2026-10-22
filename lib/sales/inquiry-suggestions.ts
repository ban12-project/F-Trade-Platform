import "server-only";

import { and, desc, eq, gt, isNull, lte } from "drizzle-orm";
import type { z } from "zod";
import { type Database, getDatabase } from "@/lib/db/client";
import {
  aggregateRecord,
  socialConversation,
  socialMessage,
  workspaceProject,
  workspaceProjectItem,
} from "@/lib/db/schema";
import { inquirySuggestionFieldsSchema, inquirySuggestionRequestSchema } from "@/lib/form-schemas";
import { decryptSocialMessageBody } from "@/lib/social/message-crypto";
import { assertWorkspaceProjectAccess } from "@/lib/workspace/access";
import { INQUIRY_HISTORY_LIMIT, summarizeInquiryMessages } from "./inquiry-history";

export type InquirySuggestion = {
  source: {
    projectId: string;
    leadId: string;
    conversationId: string;
    messageId: string;
    receivedAt: string;
  };
  fields: z.infer<typeof inquirySuggestionFieldsSchema>;
  fieldSources: ReturnType<typeof summarizeInquiryMessages>["fieldSources"];
  conflicts: ReturnType<typeof summarizeInquiryMessages>["conflicts"];
  messages: { id: string; receivedAt: string }[];
  truncated: boolean;
};
export class InquiryUnavailableError extends Error {}

/** Customer requirements only. No RFQ write, engineering verification, gate, price or outbound effect. */
export async function suggestFromInquiryHistory(
  input: unknown,
  actorId: string,
  database: Database = getDatabase(),
): Promise<InquirySuggestion> {
  const value = inquirySuggestionRequestSchema.parse(input);
  return database.transaction(async (tx) => {
    await assertWorkspaceProjectAccess(value.projectId, actorId, "write", tx);
    const [project] = await tx
      .select({ kind: workspaceProject.kind })
      .from(workspaceProject)
      .where(eq(workspaceProject.id, value.projectId));
    if (project?.kind !== "sales")
      throw new InquiryUnavailableError("只能在销售机会项目中整理客户需求。");
    const [lead] = await tx
      .select({ payload: aggregateRecord.payload })
      .from(aggregateRecord)
      .innerJoin(workspaceProjectItem, eq(workspaceProjectItem.aggregateId, aggregateRecord.id))
      .where(
        and(
          eq(aggregateRecord.id, value.leadId),
          eq(aggregateRecord.type, "lead"),
          eq(workspaceProjectItem.projectId, value.projectId),
          eq(workspaceProjectItem.role, "sales_lead"),
          eq(workspaceProjectItem.relation, "owned"),
        ),
      );
    const conversationId = lead?.payload.conversation_ref;
    if (typeof conversationId !== "string")
      throw new InquiryUnavailableError("该线索没有可整理的客户会话。");
    const now = new Date();
    const rows = await tx
      .select({
        id: socialMessage.id,
        bodyCiphertext: socialMessage.bodyCiphertext,
        receivedAt: socialMessage.receivedAt,
      })
      .from(socialMessage)
      .innerJoin(socialConversation, eq(socialConversation.id, socialMessage.conversationId))
      .where(
        and(
          eq(socialConversation.id, conversationId),
          eq(socialConversation.leadId, value.leadId),
          eq(socialMessage.direction, "inbound"),
          isNull(socialMessage.deletedAt),
          gt(socialMessage.expiresAt, now),
          lte(socialMessage.receivedAt, now),
        ),
      )
      .orderBy(desc(socialMessage.receivedAt), desc(socialMessage.id))
      .limit(INQUIRY_HISTORY_LIMIT + 1);
    const messages = rows.slice(0, INQUIRY_HISTORY_LIMIT).reverse();
    const message = messages.at(-1);
    if (!message)
      throw new InquiryUnavailableError("没有仍在保留期内的客户入站消息，请手动录入需求。");
    const summary = summarizeInquiryMessages(
      messages.map((entry) => ({
        id: entry.id,
        receivedAt: entry.receivedAt.toISOString(),
        body: decryptSocialMessageBody(entry.bodyCiphertext),
      })),
    );
    const fields = inquirySuggestionFieldsSchema.parse(summary.fields);
    return {
      source: {
        ...value,
        conversationId,
        messageId: message.id,
        receivedAt: message.receivedAt.toISOString(),
      },
      fields,
      fieldSources: summary.fieldSources,
      conflicts: summary.conflicts,
      messages: messages.map((entry) => ({
        id: entry.id,
        receivedAt: entry.receivedAt.toISOString(),
      })),
      truncated: rows.length > INQUIRY_HISTORY_LIMIT,
    };
  });
}
