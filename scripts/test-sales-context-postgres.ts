import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDatabase, getDatabase } from "../lib/db/client";
import * as schema from "../lib/db/schema";
import { listProjectLeads } from "../lib/sales/closing-store";
import { createStoredSocialMessageRecord } from "../lib/social/message-record";

const connection = process.env.SALES_CONTEXT_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/f_trade_stream_test"
)
  throw new Error("Dedicated synthetic local database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";
process.env.SOCIAL_MESSAGE_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64");

void (async () => {
  const db = getDatabase();
  await migrate(db, { migrationsFolder: "./drizzle" });
  const [owner, viewer, outsider, project] = Array.from({ length: 4 }, () => randomUUID());
  const [leadA, leadB, leadC, foreignLead] = Array.from({ length: 4 }, () => randomUUID());
  const [conversationB, foreignConversation] = [randomUUID(), randomUUID()];
  const body = "MOCK customer B message; synthetic relationship isolation only.";
  await db.transaction(async (tx) => {
    await tx.insert(schema.user).values(
      [owner, viewer, outsider].map((id) => ({
        id,
        name: "MOCK sales context test",
        email: `${id}@example.invalid`,
        emailVerified: true,
        role: "user",
      })),
    );
    await tx.insert(schema.workspaceProject).values({
      id: project,
      title: "MOCK customer relationship isolation",
      kind: "sales",
      createdById: owner,
    });
    await tx.insert(schema.workspaceProjectMember).values(
      ([owner, viewer] as const).map((id) => ({
        id: randomUUID(),
        projectId: project,
        userId: id,
        role: id === owner ? ("owner" as const) : ("viewer" as const),
        createdById: owner,
      })),
    );
    await tx.insert(schema.aggregateRecord).values(
      [leadA, leadB, leadC, foreignLead].map((id) => ({
        id,
        type: "lead" as const,
        state: "LEAD_RECEIVED",
        payload: {
          lead_id: id,
          status: "received",
          score: 0,
          score_reasons: [],
          next_action: "collect_rfq_facts",
          conversation_ref: id === leadA || id === leadB ? conversationB : foreignConversation,
        },
        createdByType: "human" as const,
        createdById: owner,
      })),
    );
    await tx.insert(schema.workspaceProjectItem).values(
      [leadA, leadB, leadC].map((aggregateId) => ({
        id: randomUUID(),
        projectId: project,
        aggregateId,
        role: "sales_lead" as const,
        relation: "owned" as const,
      })),
    );
    await tx.insert(schema.socialConversation).values(
      [conversationB, foreignConversation].map((id) => ({
        id,
        channelRef: `synthetic-${id}`,
        accountRef: `synthetic-${id}`,
        externalConversationRef: `synthetic-${id}`,
        leadId: id === conversationB ? leadB : foreignLead,
        lastMessageAt: new Date(),
      })),
    );
    const message = (conversationId: string) =>
      createStoredSocialMessageRecord({
        id: randomUUID(),
        conversationId,
        externalMessageRef: `synthetic-${randomUUID()}`,
        direction: "inbound",
        identityQuality: "manual",
        body,
        receivedAt: new Date(),
      });
    await tx.insert(schema.socialMessage).values([
      message(conversationB),
      // Any attempt to decrypt this unbound conversation would fail the test.
      { ...message(foreignConversation), bodyCiphertext: "synthetic-forbidden-to-decrypt" },
      {
        ...message(conversationB),
        receivedAt: new Date(Date.now() - 2_000),
        expiresAt: new Date(Date.now() - 1_000),
      },
      { ...message(conversationB), deletedAt: new Date() },
    ]);
  });
  for (const actor of [owner, viewer]) {
    const entries = await listProjectLeads(project, actor, db);
    assert.equal(entries.length, 3);
    for (const id of [leadA, leadC]) {
      const entry = entries.find((item) => item.id === id)!;
      assert.equal(entry.replyAvailable, false);
      assert.deepEqual(entry.timeline, []);
    }
    const own = entries.find((entry) => entry.id === leadB)!;
    assert.equal(own.replyAvailable, true);
    assert.equal(own.timeline.length, 1);
    assert.equal(own.timeline[0].body, body);
  }
  await assert.rejects(listProjectLeads(project, outsider, db), /不是该项目成员/);
  await db
    .delete(schema.workspaceProjectMember)
    .where(
      and(
        eq(schema.workspaceProjectMember.projectId, project),
        eq(schema.workspaceProjectMember.userId, viewer),
      ),
    );
  await assert.rejects(listProjectLeads(project, viewer, db), /不是该项目成员/);
  console.log("Synthetic sales context: reciprocal conversation ownership and retention passed.");
})()
  .finally(closeDatabase)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
