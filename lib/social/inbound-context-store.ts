import "server-only";

import { createHash } from "node:crypto";
import { and, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { type Database, type DatabaseTransaction, getDatabase } from "@/lib/db/client";
import { socialConversation, socialMessage } from "@/lib/db/schema";
import { inboundContextRequestSchema } from "@/lib/form-schemas";
import {
  assertSocialAuthorizationAlive,
  authorizeSocialActor,
  parseSocialActorIdentity,
  type SocialActorIdentity,
  SocialHumanAccessError,
} from "./human-write-access";
import { decryptSocialMessageBody } from "./message-crypto";

export type InboundContextPreview = {
  reviewedMessageAt: string;
  reviewedContextDigest: string;
  messages: { id: string; receivedAt: string; excerpt: string; truncated: boolean }[];
};

/** Unassigned conversations have no project ACL: only the bound account owner may read or route. */
export async function assertInboundAccountOwner(
  tx: DatabaseTransaction,
  scope: { channelRef: string; accountRef: string },
  actorId: string,
) {
  const bindings = await tx.execute(sql`SELECT n.owner_id FROM browser_fleet_binding b
    JOIN browser_fleet_node n ON n.id = b.node_id
    WHERE b.channel_ref = ${scope.channelRef} AND b.account_ref = ${scope.accountRef}
    FOR SHARE OF n, b`);
  if (bindings.rows.length) {
    if (bindings.rows.length !== 1 || bindings.rows[0].owner_id !== actorId)
      throw new SocialHumanAccessError();
    return;
  }
  // A missing binding is not a grant. Legacy access requires the exact configured owner and scope.
  if (
    actorId !== process.env.SOCIAL_FACEBOOK_OWNER_USER_ID ||
    scope.channelRef !== process.env.SOCIAL_WORKER_CHANNEL_REF ||
    scope.accountRef !== process.env.SOCIAL_WORKER_ACCOUNT_REF
  )
    throw new SocialHumanAccessError();
}

/** Match inbox/executor order: account node/binding before locking a conversation.
 * The caller must lock and recheck the returned scope before reading any ciphertext. */
export async function lockInboundConversationAccount(
  tx: DatabaseTransaction,
  conversationId: string,
  actorId: string,
) {
  const [scope] = await tx
    .select({
      channelRef: socialConversation.channelRef,
      accountRef: socialConversation.accountRef,
    })
    .from(socialConversation)
    .where(eq(socialConversation.id, conversationId));
  if (!scope) throw new SocialHumanAccessError();
  await assertInboundAccountOwner(tx, scope, actorId);
  return scope;
}

export async function readInboundContext(
  input: unknown,
  identityInput: SocialActorIdentity,
  database: Database = getDatabase(),
): Promise<InboundContextPreview> {
  const value = inboundContextRequestSchema.parse(input);
  const identity = parseSocialActorIdentity(identityInput);
  return database.transaction(async (tx) => {
    const scope = await lockInboundConversationAccount(tx, value.conversationId, identity.actorId);
    const [conversation] = await tx
      .select({
        channelRef: socialConversation.channelRef,
        accountRef: socialConversation.accountRef,
        lastMessageAt: socialConversation.lastMessageAt,
      })
      .from(socialConversation)
      .where(
        and(eq(socialConversation.id, value.conversationId), isNull(socialConversation.leadId)),
      )
      .for("share");
    if (
      !conversation ||
      conversation.channelRef !== scope.channelRef ||
      conversation.accountRef !== scope.accountRef
    )
      throw new SocialHumanAccessError();
    const expiresAt = await authorizeSocialActor(tx, identity, ["sales:write"]);
    const rows = await readRetainedInboundMessages(tx, value.conversationId);
    const reviewedContextDigest = inboundContextDigest(rows, conversation.lastMessageAt);
    const messages = rows.reverse().map((row) => {
      const body = decryptSocialMessageBody(row.bodyCiphertext);
      return {
        id: row.id,
        receivedAt: row.receivedAt.toISOString(),
        excerpt: body.slice(0, 600),
        truncated: body.length > 600,
      };
    });
    assertSocialAuthorizationAlive(expiresAt);
    return {
      reviewedMessageAt: conversation.lastMessageAt.toISOString(),
      reviewedContextDigest,
      messages,
    };
  });
}

export async function readRetainedInboundMessages(tx: DatabaseTransaction, conversationId: string) {
  const now = new Date();
  return tx
    .select({
      id: socialMessage.id,
      bodyCiphertext: socialMessage.bodyCiphertext,
      receivedAt: socialMessage.receivedAt,
      expiresAt: socialMessage.expiresAt,
    })
    .from(socialMessage)
    .where(
      and(
        eq(socialMessage.conversationId, conversationId),
        eq(socialMessage.direction, "inbound"),
        isNull(socialMessage.deletedAt),
        gt(socialMessage.expiresAt, now),
        lte(socialMessage.receivedAt, now),
      ),
    )
    .orderBy(desc(socialMessage.receivedAt), desc(socialMessage.id))
    .limit(3)
    .for("share");
}

export function inboundContextDigest(
  rows: Awaited<ReturnType<typeof readRetainedInboundMessages>>,
  lastMessageAt: Date,
) {
  return createHash("sha256").update(JSON.stringify({ lastMessageAt, rows })).digest("hex");
}
