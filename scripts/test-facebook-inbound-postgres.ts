/** Called by the migrated publication regression using only synthetic fixtures. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../lib/db/client";
import {
  aggregateRecord,
  socialChannelControl,
  socialConversation,
  socialMessage,
  workspaceProject,
} from "../lib/db/schema";
import { ingestFacebookInboundBatch } from "../lib/social/facebook-inbound-store";
import {
  listUnassignedInboundConversations,
  routeInboundConversation,
} from "../lib/social/inbound-routing-store";
import { decryptSocialMessageBody } from "../lib/social/message-crypto";

export async function testFacebookInbound(database: Database, actorId: string) {
  process.env.SOCIAL_MESSAGE_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  const now = new Date();
  const channelRef = randomUUID();
  const accountRef = randomUUID();
  const controlId = randomUUID();
  await database.insert(socialChannelControl).values({
    id: controlId,
    channelRef,
    accountRef,
    enabled: true,
    circuitStatus: "active",
    changedBy: actorId,
    changedAt: now,
  });
  const message = {
    conversationRef: randomUUID(),
    messageRef: randomUUID(),
    direction: "inbound",
    identityQuality: "dom_id",
    body: "SYNTHETIC incoming request",
    receivedAt: now.toISOString(),
  };
  const batch = { channelRef, accountRef, observedAt: now.toISOString(), messages: [message] };
  const ingest = (input: unknown) =>
    database.transaction((tx) => ingestFacebookInboundBatch(tx, input, actorId, now));
  const counts = await Promise.all(Array.from({ length: 8 }, () => ingest(batch)));
  assert.equal(
    counts.reduce((sum, item) => sum + item.accepted, 0),
    1,
  );
  assert.equal(
    counts.reduce((sum, item) => sum + item.duplicates, 0),
    7,
  );
  const [conversation] = await database
    .select()
    .from(socialConversation)
    .where(
      and(
        eq(socialConversation.channelRef, channelRef),
        eq(socialConversation.accountRef, accountRef),
      ),
    );
  assert.equal(conversation.leadId, null);
  assert.ok(
    (await listUnassignedInboundConversations(database)).some(
      (item) => item.id === conversation.id,
    ),
  );
  const routed = await routeInboundConversation(
    { conversationId: conversation.id, mode: "create" },
    actorId,
    database,
  );
  const [project] = await database
    .select()
    .from(workspaceProject)
    .where(eq(workspaceProject.id, routed.projectId));
  const [lead] = await database
    .select()
    .from(aggregateRecord)
    .where(eq(aggregateRecord.id, routed.leadId));
  assert.equal(project.kind, "sales");
  assert.equal(lead.state, "LEAD_RECEIVED");
  assert.equal(lead.payload.next_action, "collect_rfq");
  await assert.rejects(
    routeInboundConversation(
      { conversationId: conversation.id, mode: "create" },
      actorId,
      database,
    ),
    /已完成分流/,
  );

  const [stored] = await database
    .select()
    .from(socialMessage)
    .where(eq(socialMessage.conversationId, conversation.id));
  assert.equal(decryptSocialMessageBody(stored.bodyCiphertext), message.body);
  assert.equal(stored.bodyCiphertext.includes(message.body), false);
  assert.equal(stored.expiresAt.getTime() - now.getTime(), 30 * 86400000);
  await ingest({
    ...batch,
    messages: [
      {
        ...message,
        messageRef: randomUUID(),
        receivedAt: new Date(now.getTime() - 10000).toISOString(),
      },
    ],
  });
  const [updated] = await database
    .select()
    .from(socialConversation)
    .where(eq(socialConversation.id, conversation.id));
  assert.equal(updated.lastMessageAt.getTime(), now.getTime());
  assert.equal(updated.leadId, routed.leadId);
  assert.equal(
    (await listUnassignedInboundConversations(database)).some(
      (item) => item.id === conversation.id,
    ),
    false,
  );
  // A conflict late in the batch rolls back an earlier new conversation/message.
  const rollbackRef = randomUUID();
  await assert.rejects(
    ingest({
      ...batch,
      messages: [
        { ...message, conversationRef: rollbackRef, messageRef: randomUUID() },
        { ...message, body: "SYNTHETIC conflicting body" },
      ],
    }),
    /inbound_message_conflict/,
  );
  assert.equal(
    (
      await database
        .select()
        .from(socialConversation)
        .where(eq(socialConversation.externalConversationRef, rollbackRef))
    ).length,
    0,
  );
  await database
    .update(socialMessage)
    .set({ deletedAt: now, bodyCiphertext: "deleted" })
    .where(eq(socialMessage.id, stored.id));
  assert.deepEqual(await ingest(batch), { accepted: 0, duplicates: 1 });
  const [tombstone] = await database
    .select()
    .from(socialMessage)
    .where(eq(socialMessage.id, stored.id));
  assert.equal(tombstone.bodyCiphertext, "deleted");
  for (const invalid of [
    { ...batch, accountRef: randomUUID() },
    { ...batch, observedAt: new Date(now.getTime() - 300001).toISOString() },
    { ...batch, messages: [{ ...message, direction: "outbound" }] },
    { ...batch, messages: [{ ...message, receivedAt: new Date(now.getTime() + 1).toISOString() }] },
    {
      ...batch,
      messages: [{ ...message, receivedAt: new Date(now.getTime() - 30 * 86400000).toISOString() }],
    },
  ])
    await assert.rejects(ingest(invalid));
  await database
    .update(socialChannelControl)
    .set({ circuitStatus: "paused", pauseReason: "synthetic_pause" })
    .where(eq(socialChannelControl.id, controlId));
  await assert.rejects(ingest(batch), /inbound_channel_inactive/);
  const audits = await database.execute(
    sql`SELECT metadata FROM audit_event WHERE action = 'social_inbound.received' AND subject_id = ${stored.id}`,
  );
  assert.equal(audits.rows.length, 1);
  assert.equal(JSON.stringify(audits.rows).includes(message.body), false);
  console.log(
    "PASS inbound concurrency, encrypted retention, unassigned routing, rollback, replay conflicts, tombstones and pause enforcement",
  );
}
