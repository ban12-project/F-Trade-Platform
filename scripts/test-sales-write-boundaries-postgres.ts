import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import readyProduct from "../data/fixtures/product-ready.synthetic.json";
import readyRfq from "../data/fixtures/rfq-ready.synthetic.json";
import { closeDatabase, getDatabase } from "../lib/db/client";
import * as schema from "../lib/db/schema";
import {
  createDeliveryRequest,
  createOrReviseQuotation,
  decideDelivery,
  decideQuotation,
} from "../lib/sales/closing-store";

const connection = process.env.SALES_WRITE_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/f_trade_stream_test"
)
  throw new Error("Dedicated synthetic local database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";

void (async () => {
  const db = getDatabase();
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const [owner, outsider, viewer, projectA, projectB, rfqA, rfqB, productId, leadId] = Array.from(
      { length: 9 },
      () => randomUUID(),
    );
    await db.insert(schema.user).values(
      [owner, outsider, viewer].map((id) => ({
        id,
        name: "SYNTHETIC sales write boundaries",
        email: `${id}@example.invalid`,
        role: "user",
      })),
    );
    await db.insert(schema.workspaceProject).values(
      [projectA, projectB].map((id) => ({
        id,
        kind: "sales" as const,
        title: "SYNTHETIC sales write boundaries",
        createdById: owner,
      })),
    );
    await db.insert(schema.workspaceProjectMember).values([
      ...[projectA, projectB].map((projectId) => ({
        id: randomUUID(),
        projectId,
        userId: owner,
        role: "owner" as const,
        createdById: owner,
      })),
      {
        id: randomUUID(),
        projectId: projectA,
        userId: outsider,
        role: "editor" as const,
        createdById: owner,
      },
      {
        id: randomUUID(),
        projectId: projectB,
        userId: viewer,
        role: "viewer" as const,
        createdById: owner,
      },
    ]);
    await db.insert(schema.aggregateRecord).values([
      ...[rfqA, rfqB].map((id) => ({
        id,
        type: "rfq" as const,
        state: "RFQ_READY",
        payload: { ...readyRfq, rfq_id: id },
        createdByType: "human" as const,
        createdById: owner,
      })),
      {
        id: productId,
        type: "product",
        state: "PRODUCT_READY",
        payload: { ...readyProduct, product_id: productId },
        createdByType: "human",
        createdById: owner,
      },
      {
        id: leadId,
        type: "lead",
        state: "FOLLOW_UP",
        payload: {
          lead_id: leadId,
          rfq_ref: rfqB,
          status: "follow_up",
          score: 0,
          score_reasons: [],
          next_action: "confirm_delivery",
        },
        createdByType: "human",
        createdById: owner,
      },
    ]);
    await db.insert(schema.workspaceProjectItem).values([
      ...[projectA, projectB].map((projectId) => ({
        id: randomUUID(),
        projectId,
        aggregateId: projectId === projectA ? rfqA : rfqB,
        role: "sales_rfq" as const,
        relation: "owned" as const,
      })),
      ...[projectA, projectB].map((projectId) => ({
        id: randomUUID(),
        projectId,
        aggregateId: productId,
        role: "product_reference" as const,
        relation: "reference" as const,
      })),
      {
        id: randomUUID(),
        projectId: projectB,
        aggregateId: leadId,
        role: "sales_lead",
        relation: "owned",
      },
    ]);
    const draft = {
      projectId: projectB,
      rfqId: rfqB,
      productId,
      unitPrice: "12.50",
      currency: "USD",
      moq: "10",
      leadTimeDays: "30",
      paymentTerms: "SYNTHETIC terms",
      validityDays: "30",
      evidenceRef: "evidence-synthetic-sales-boundaries",
    };
    const quotation = await createOrReviseQuotation(draft, owner, db);
    const [pending] = await db
      .select()
      .from(schema.approval)
      .where(eq(schema.approval.aggregateId, quotation.id));
    await decideQuotation(
      {
        projectId: projectB,
        quotationId: quotation.id,
        reviewedVersion: "1",
        approvalId: pending.id,
        decision: "rejected",
        evidenceRef: draft.evidenceRef,
        notes: "SYNTHETIC revision needed",
      },
      owner,
      db,
    );
    const snapshot = async () => ({
      records: await db
        .select()
        .from(schema.aggregateRecord)
        .where(inArray(schema.aggregateRecord.id, [quotation.id, leadId]))
        .orderBy(asc(schema.aggregateRecord.id)),
      approvals: await db
        .select()
        .from(schema.approval)
        .where(eq(schema.approval.aggregateId, quotation.id))
        .orderBy(asc(schema.approval.id)),
      events: await db
        .select()
        .from(schema.workflowEvent)
        .where(eq(schema.workflowEvent.aggregateId, quotation.id))
        .orderBy(asc(schema.workflowEvent.id)),
      audits: await db
        .select()
        .from(schema.auditEvent)
        .where(eq(schema.auditEvent.aggregateId, quotation.id))
        .orderBy(asc(schema.auditEvent.id)),
      projects: await db
        .select()
        .from(schema.workspaceProject)
        .where(inArray(schema.workspaceProject.id, [projectA, projectB]))
        .orderBy(asc(schema.workspaceProject.id)),
    });
    const before = await snapshot();
    for (const actor of [outsider, owner]) {
      await assert.rejects(
        createOrReviseQuotation(
          { ...draft, projectId: projectA, rfqId: rfqA, quotationId: quotation.id },
          actor,
          db,
        ),
        /报价不属于当前项目/,
      );
      assert.deepEqual(await snapshot(), before, "Cross-project rejection must leave no writes");
    }
    await assert.rejects(
      createOrReviseQuotation({ ...draft, quotationId: quotation.id }, viewer, db),
      /编辑权限/,
    );
    assert.deepEqual(await snapshot(), before);
    await db
      .update(schema.workspaceProject)
      .set({ status: "archived" })
      .where(eq(schema.workspaceProject.id, projectB));
    await assert.rejects(
      createOrReviseQuotation({ ...draft, quotationId: quotation.id }, owner, db),
      /已归档/,
    );
    await db
      .update(schema.workspaceProject)
      .set({ status: "active" })
      .where(eq(schema.workspaceProject.id, projectB));
    await createOrReviseQuotation(
      { ...draft, quotationId: quotation.id, unitPrice: "13" },
      owner,
      db,
    );
    const after = await snapshot();
    assert.equal(
      after.records.find((row) => row.id === quotation.id)?.state,
      "QUOTE_REVIEW_REQUIRED",
    );
    assert.equal(after.approvals.filter((row) => row.status === "pending").length, 1);
    console.log(
      "PASS quotation revision: foreign project, shared owner, viewer, archive and fresh Gate 02",
    );

    const request = {
      projectId: projectB,
      leadId,
      evidenceRef: "evidence-synthetic-delivery-renewal",
    };
    const original = await createDeliveryRequest(request, owner, db);
    assert.equal((await createDeliveryRequest(request, owner, db)).id, original.id);
    await decideDelivery(
      {
        projectId: projectB,
        confirmationId: original.id,
        decision: "confirmed",
        leadTimeDays: "20",
        evidenceRef: request.evidenceRef,
        notes: "SYNTHETIC approval",
      },
      owner,
      db,
    );
    assert.equal((await createDeliveryRequest(request, owner, db)).id, original.id);
    const [confirmed] = await db
      .select()
      .from(schema.aggregateRecord)
      .where(eq(schema.aggregateRecord.id, original.id));
    const priorApproval = await db
      .select()
      .from(schema.approval)
      .where(eq(schema.approval.aggregateId, original.id));
    await db
      .update(schema.aggregateRecord)
      .set({
        payload: {
          ...confirmed.payload,
          result: {
            ...(confirmed.payload.result as object),
            valid_until: new Date(Date.now() - 1_000).toISOString(),
          },
        },
      })
      .where(eq(schema.aggregateRecord.id, original.id));
    const renewed = await Promise.all(
      Array.from({ length: 3 }, () => createDeliveryRequest(request, owner, db)),
    );
    assert.notEqual(
      renewed[0].id,
      original.id,
      "Expired Gate 03 must permit a fresh human request",
    );
    assert(
      renewed.every((row) => row.id === renewed[0].id),
      "Concurrent renewal must reuse one request",
    );
    const rows = await db
      .select()
      .from(schema.aggregateRecord)
      .where(inArray(schema.aggregateRecord.id, [original.id, renewed[0].id, leadId]));
    assert.equal(
      rows.find((row) => row.id === original.id)?.state,
      "DELIVERY_CONFIRMATION_EXPIRED",
    );
    const next = rows.find((row) => row.id === renewed[0].id);
    assert(next);
    assert.equal(next.state, "DELIVERY_CONFIRMATION_PENDING");
    assert.equal(next.payload.status, "pending");
    assert.equal(next.payload.result, undefined);
    assert.equal(next.payload.approval_ref, undefined);
    assert.equal(rows.find((row) => row.id === leadId)?.payload.delivery_confirmation_ref, next.id);
    assert.deepEqual(
      await db.select().from(schema.approval).where(eq(schema.approval.aggregateId, original.id)),
      priorApproval,
      "Renewal must not alter historical human approval",
    );
    const [nextApproval] = await db
      .select()
      .from(schema.approval)
      .where(eq(schema.approval.aggregateId, next.id));
    assert.equal(nextApproval.gate, "gate_03_delivery");
    assert.equal(nextApproval.status, "pending");
    const expiryEvents = await db
      .select()
      .from(schema.workflowEvent)
      .where(eq(schema.workflowEvent.aggregateId, original.id));
    assert.equal(
      expiryEvents.filter((row) => row.toState === "DELIVERY_CONFIRMATION_EXPIRED").length,
      1,
    );
    const expiryAudits = await db
      .select()
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.aggregateId, original.id));
    assert.equal(
      expiryAudits.filter((row) => row.action === "delivery_confirmation.expired_before_renewal")
        .length,
      1,
    );
    console.log(
      "PASS Gate 03: pending/valid idempotency, expired renewal, concurrency and fresh human approval",
    );
  } finally {
    await closeDatabase();
  }
})();
