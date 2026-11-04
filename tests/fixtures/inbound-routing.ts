import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { initialState } from "../../lib/browser-fleet/policy";
import type { Database } from "../../lib/db/client";
import * as s from "../../lib/db/schema";
import { createStoredSocialMessageRecord } from "../../lib/social/message-record";

/** Synthetic metadata only: no customer messages, identities or external delivery. */
export async function seedInboundRoutingFixture(db: Database, role = "user") {
  const actorId = randomUUID(),
    sessionId = randomUUID(),
    token = randomUUID(),
    projectId = randomUUID(),
    conversationId = randomUUID(),
    accountRef = randomUUID(),
    lastMessageAt = new Date(),
    channelRef = `synthetic-routing-${randomUUID()}`;
  await db.insert(s.user).values({
    id: actorId,
    name: "SYNTHETIC inbound routing writer",
    email: `${actorId}@example.invalid`,
    emailVerified: true,
    role,
  });
  await db.insert(s.session).values({
    id: sessionId,
    userId: actorId,
    token,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await db.insert(s.workspaceProject).values({
    id: projectId,
    title: `SYNTHETIC routing ${projectId}`,
    kind: "sales",
    createdById: actorId,
  });
  await db.insert(s.workspaceProjectMember).values({
    id: randomUUID(),
    projectId,
    userId: actorId,
    role: "owner",
    createdById: actorId,
  });
  await db.insert(s.socialConversation).values({
    id: conversationId,
    channelRef,
    accountRef,
    externalConversationRef: randomUUID(),
    lastMessageAt,
  });
  return {
    actorId,
    sessionId,
    token,
    projectId,
    conversationId,
    channelRef,
    accountRef,
    lastMessageAt,
  };
}

export const SYNTHETIC_INBOUND_ROUTING_BODY = "SYNTHETIC routing inquiry: clutch kit, quantity 25";

/** Opt-in fixture so unrelated follow-up cases keep their original message counts. */
export async function seedInboundRoutingContextFixture(db: Database, role = "user") {
  const f = await seedInboundRoutingFixture(db, role);
  const nodeId = randomUUID(),
    bindingId = randomUUID(),
    messageId = randomUUID();
  const state = initialState({ maxBrowsers: 1, memoryBudgetMb: 512, browserMemoryMb: 512 });
  state.accounts.push({
    id: bindingId,
    channelRef: f.channelRef,
    accountRef: f.accountRef,
    enabled: false,
    authState: "needs_login",
    credentialVersion: 0,
    loginCiphertext: null,
    proxyCiphertext: null,
    pollSeconds: 900,
    nextPollAt: 0,
    lastCheckedAt: null,
  });
  await db.execute(sql`INSERT INTO browser_fleet_node (id, owner_id, name, gateway_origin, key_hash, document)
    VALUES (${nodeId}, ${f.actorId}, 'SYNTHETIC context owner', NULL, ${`synthetic-disabled-${randomUUID()}`}, ${JSON.stringify(state)}::jsonb)`);
  await db.execute(sql`INSERT INTO browser_fleet_binding (id, node_id, account_ref, channel_ref)
    VALUES (${bindingId}, ${nodeId}, ${f.accountRef}, ${f.channelRef})`);
  await db.insert(s.socialMessage).values(
    createStoredSocialMessageRecord({
      id: messageId,
      conversationId: f.conversationId,
      externalMessageRef: randomUUID(),
      direction: "inbound",
      identityQuality: "manual",
      body: SYNTHETIC_INBOUND_ROUTING_BODY,
      receivedAt: f.lastMessageAt,
    }),
  );
  return { ...f, nodeId, bindingId, messageId };
}
