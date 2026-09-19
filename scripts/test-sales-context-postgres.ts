import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import deliveryFixture from "../data/fixtures/delivery-confirmation.synthetic.json";
import rfqFixture from "../data/fixtures/rfq-ready.synthetic.json";
import { closeDatabase, getDatabase } from "../lib/db/client";
import * as schema from "../lib/db/schema";
import { listProjectLeads } from "../lib/sales/closing-store";
import { listProjectRfqEntries } from "../lib/sales/store";
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
    const metadata = await listProjectLeads(project, actor, db);
    assert(
      metadata.every((entry) => entry.timeline.length === 0),
      "Lists must not expose message bodies",
    );
    const entries = await listProjectLeads(project, actor, db, { timelineLeadId: leadB });
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
  for (const timelineLeadId of [leadA, leadC, foreignLead, randomUUID()]) {
    const entries = await listProjectLeads(project, owner, db, { timelineLeadId });
    assert(entries.every((entry) => entry.timeline.length === 0));
  }
  // Recent messages from another valid conversation must not displace the selected customer's history.
  const conversationA = randomUUID();
  const [originalA] = await db
    .select()
    .from(schema.aggregateRecord)
    .where(eq(schema.aggregateRecord.id, leadA));
  await db.insert(schema.socialConversation).values({
    id: conversationA,
    channelRef: `synthetic-${conversationA}`,
    accountRef: `synthetic-${conversationA}`,
    externalConversationRef: `synthetic-${conversationA}`,
    leadId: leadA,
    lastMessageAt: new Date(),
  });
  await db
    .update(schema.aggregateRecord)
    .set({ payload: { ...originalA.payload, conversation_ref: conversationA } })
    .where(eq(schema.aggregateRecord.id, leadA));
  const baseTime = Date.now();
  await db.insert(schema.socialMessage).values(
    [conversationB, conversationA].flatMap((conversationId, c) =>
      Array.from({ length: 205 }, (_, i) =>
        createStoredSocialMessageRecord({
          id: randomUUID(),
          conversationId,
          externalMessageRef: `synthetic-${randomUUID()}`,
          direction: "inbound",
          identityQuality: "manual",
          body: `MOCK ${c}:${i}`,
          receivedAt: new Date(baseTime + c * 100_000 + i * 100),
        }),
      ),
    ),
  );
  const recent = (await listProjectLeads(project, owner, db, { timelineLeadId: leadB })).find(
    (entry) => entry.id === leadB,
  )!;
  assert.equal(recent.timeline.length, 200);
  assert.equal(recent.timelineTruncated, true);
  assert.equal(recent.timeline[0].body, "MOCK 0:5");
  assert.equal(recent.timeline[199].body, "MOCK 0:204");

  // An older RFQ remains addressable after the former 50-record list limit.
  const rfqIds = Array.from({ length: 51 }, () => randomUUID());
  await db.insert(schema.aggregateRecord).values(
    rfqIds.map((id) => ({
      id,
      type: "rfq" as const,
      state: "RFQ_READY",
      payload: { ...rfqFixture, rfq_id: id },
      createdByType: "human" as const,
      createdById: owner,
    })),
  );
  await db.insert(schema.workspaceProjectItem).values(
    rfqIds.map((aggregateId, i) => ({
      id: randomUUID(),
      projectId: project,
      aggregateId,
      role: "sales_rfq" as const,
      relation: "owned" as const,
      createdAt: new Date(baseTime + i * 100),
    })),
  );
  const rfqs = await listProjectRfqEntries(project);
  assert.equal(rfqs.length, 51);
  assert(rfqs.some((rfq) => rfq.id === rfqIds[0]));

  const deliveryId = randomUUID();
  const [originalB] = await db
    .select()
    .from(schema.aggregateRecord)
    .where(eq(schema.aggregateRecord.id, leadB));
  const leadPayload = {
    ...originalB.payload,
    rfq_ref: rfqIds[0],
    delivery_confirmation_ref: deliveryId,
  };
  await db
    .update(schema.aggregateRecord)
    .set({ payload: leadPayload })
    .where(eq(schema.aggregateRecord.id, leadB));
  const confirmation = {
    ...deliveryFixture,
    confirmation_id: deliveryId,
    related_entity_type: "rfq",
    related_entity_id: rfqIds[0],
    result: {
      ...deliveryFixture.result,
      valid_until: new Date(Date.now() + 86_400_000).toISOString(),
    },
  };
  await db.insert(schema.aggregateRecord).values({
    id: deliveryId,
    type: "delivery_confirmation",
    state: "DELIVERY_CONFIRMATION_CONFIRMED",
    payload: confirmation,
    createdByType: "human",
    createdById: owner,
  });
  const readDelivery = async () =>
    (await listProjectLeads(project, owner, db)).find((entry) => entry.id === leadB)!
      .confirmedDelivery;
  assert.equal(await readDelivery(), null, "Unowned delivery must not authorize a promise");
  await db.insert(schema.workspaceProjectItem).values({
    id: randomUUID(),
    projectId: project,
    aggregateId: deliveryId,
    role: "delivery_confirmation",
    relation: "owned",
  });
  assert.equal((await readDelivery())?.leadTimeDays, 30);
  for (const payload of [
    { ...confirmation, related_entity_id: rfqIds[1] },
    { ...confirmation, related_entity_type: "opportunity" },
    {
      ...confirmation,
      result: { ...confirmation.result, valid_until: new Date(Date.now() - 1000).toISOString() },
    },
  ]) {
    await db
      .update(schema.aggregateRecord)
      .set({ payload })
      .where(eq(schema.aggregateRecord.id, deliveryId));
    assert.equal(
      await readDelivery(),
      null,
      "Wrong RFQ/type or expired delivery must not authorize a promise",
    );
  }
  const unownedRfq = randomUUID();
  await db
    .update(schema.aggregateRecord)
    .set({ payload: { ...confirmation, related_entity_id: unownedRfq } })
    .where(eq(schema.aggregateRecord.id, deliveryId));
  await db
    .update(schema.aggregateRecord)
    .set({ payload: { ...leadPayload, rfq_ref: unownedRfq } })
    .where(eq(schema.aggregateRecord.id, leadB));
  assert.equal(
    await readDelivery(),
    null,
    "Matching payload references do not authorize an unowned RFQ",
  );
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
  console.log(
    "Synthetic sales context: conversation ownership, latest history, RFQ addressability and delivery boundaries passed.",
  );
})()
  .finally(closeDatabase)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
