import { randomUUID } from "node:crypto";
import type { Database } from "../../lib/db/client";
import * as s from "../../lib/db/schema";

/** Synthetic metadata only: no customer messages, identities or external delivery. */
export async function seedInboundRoutingFixture(db: Database, role = "user") {
  const actorId = randomUUID(),
    sessionId = randomUUID(),
    token = randomUUID(),
    projectId = randomUUID(),
    conversationId = randomUUID(),
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
    accountRef: randomUUID(),
    externalConversationRef: randomUUID(),
    lastMessageAt: new Date(),
  });
  return { actorId, sessionId, token, projectId, conversationId, channelRef };
}
