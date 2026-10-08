import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import readyRfq from "../../data/fixtures/rfq-ready.synthetic.json";
import type { Database } from "../../lib/db/client";
import * as s from "../../lib/db/schema";
import { createStoredSocialMessageRecord } from "../../lib/social/message-record";
import { seedInboundRoutingFixture } from "./inbound-routing";

/** Isolated synthetic conversation and Gate 03 facts; never delivers a message. */
export async function seedFollowUpFixture(db: Database, role = "user") {
  const f = await seedInboundRoutingFixture(db, role);
  const leadId = randomUUID(),
    inboundId = randomUUID(),
    controlId = randomUUID(),
    ownedId = randomUUID(),
    deliveryId = randomUUID(),
    rfqId = randomUUID(),
    confirmationRef = `evidence-mock-${randomUUID()}`;
  const [conversation] = await db
    .select()
    .from(s.socialConversation)
    .where(eq(s.socialConversation.id, f.conversationId));
  await db.insert(s.aggregateRecord).values({
    id: rfqId,
    type: "rfq",
    state: "RFQ_READY",
    createdByType: "human",
    createdById: f.actorId,
    payload: { ...readyRfq, rfq_id: rfqId },
  });
  await db.insert(s.aggregateRecord).values({
    id: leadId,
    type: "lead",
    state: "FOLLOW_UP",
    createdByType: "human",
    createdById: f.actorId,
    payload: {
      lead_id: leadId,
      conversation_ref: f.conversationId,
      rfq_ref: rfqId,
      delivery_confirmation_ref: deliveryId,
      status: "follow_up",
      score: 0,
      score_reasons: [],
      next_action: "SYNTHETIC test only",
    },
  });
  await db.insert(s.aggregateRecord).values({
    id: deliveryId,
    type: "delivery_confirmation",
    state: "DELIVERY_CONFIRMATION_CONFIRMED",
    createdByType: "human",
    createdById: f.actorId,
    payload: {
      confirmation_id: deliveryId,
      related_entity_type: "rfq",
      related_entity_id: rfqId,
      status: "confirmed",
      requested_by_type: "human",
      requested_by_id: f.actorId,
      requested_at: new Date().toISOString(),
      approval_ref: randomUUID(),
      result: {
        actor_type: "human",
        decided_by: f.actorId,
        decided_at: new Date().toISOString(),
        evidence_ref: confirmationRef,
        confirmed_lead_time_days: 21,
        valid_until: new Date(Date.now() + 3_600_000).toISOString(),
      },
    },
  });
  await db.insert(s.workspaceProjectItem).values([
    {
      id: ownedId,
      projectId: f.projectId,
      aggregateId: leadId,
      role: "sales_lead",
      relation: "owned",
    },
    {
      id: randomUUID(),
      projectId: f.projectId,
      aggregateId: deliveryId,
      role: "delivery_confirmation",
      relation: "owned",
    },
    {
      id: randomUUID(),
      projectId: f.projectId,
      aggregateId: rfqId,
      role: "sales_rfq",
      relation: "owned",
    },
  ]);
  await db
    .update(s.socialConversation)
    .set({ leadId })
    .where(eq(s.socialConversation.id, f.conversationId));
  await db.insert(s.socialChannelControl).values({
    id: controlId,
    channelRef: f.channelRef,
    accountRef: conversation.accountRef,
    enabled: true,
    circuitStatus: "active",
    changedBy: f.actorId,
    changedAt: new Date(),
  });
  await db.insert(s.socialMessage).values(
    createStoredSocialMessageRecord({
      id: inboundId,
      conversationId: f.conversationId,
      externalMessageRef: randomUUID(),
      direction: "inbound",
      identityQuality: "manual",
      body: "SYNTHETIC inbound only",
      receivedAt: new Date(),
    }),
  );
  return { ...f, leadId, inboundId, controlId, ownedId, deliveryId, confirmationRef };
}
