import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import type { Database } from "../lib/db/client";
import {
  aggregateRecord,
  approval,
  auditEvent,
  workflowEvent,
  workspaceProjectItem,
} from "../lib/db/schema";
import { finalizeProductAgentDraft } from "../lib/product/agent";
import { prepareProductAgentEvidenceSource } from "../lib/product/evidence-locations";
import { type ProductDraft, reviewProductDraft } from "../lib/product/verification";
import { decideProductCatalogReview, insertProductAgentDraft } from "../lib/products";
import { runReferenceMockWorkflow } from "./reference-mock-workflow";

/** Called only by the dedicated loopback PostgreSQL test. No reference data or business DB. */
export async function testMockProductPersistence(
  database: Database,
  actorId: string,
  projectId: string,
) {
  let missingEvidenceDraft: ProductDraft | undefined;
  for (let slot = 1; slot <= 20; slot++) {
    const source = {
      record_id: `synthetic-pg-source-${slot}`,
      source_ref: `synthetic:pg-source-${slot}`,
      evidence_refs: [`synthetic:pg-source-${slot}`],
      source_text: `Internal SKU: SYN-PG-${slot}\nVehicle model: SYN-PG Model ${slot}`,
      image_availability: "none" as const,
      image_refs: [],
    };
    const prepared = prepareProductAgentEvidenceSource(source);
    const original = finalizeProductAgentDraft(
      {
        record_id: source.record_id,
        source_ref: source.source_ref,
        evidence_refs: prepared.evidence_refs,
        verification_status: "review_required",
        product: { internal_sku: `SYN-PG-${slot}`, vehicle_model: `SYN-PG Model ${slot}` },
        field_evidence: {
          "product.internal_sku": prepared.evidence_locations[0]?.ref,
          "product.vehicle_model": prepared.evidence_locations[1]?.ref,
        },
        blocking_missing_fields: [],
        optional_missing_fields: [],
      },
      prepared,
    );
    const mock = await runReferenceMockWorkflow(source, original, slot);
    // Return through the real review transaction; never persist the simulated approval.
    const { approval_ref: _simulatedApproval, ...payload } = mock.ready;
    const draft = reviewProductDraft({ ...payload, verification_status: "review_required" });
    missingEvidenceDraft = draft;
    const inserted = await database.transaction((tx) =>
      insertProductAgentDraft(
        tx,
        draft,
        actorId,
        { classification: "synthetic", test_only: true },
        projectId,
      ),
    );
    const decision = {
      productId: inserted.id,
      approvalId: inserted.approvalId,
      reviewedVersion: "1",
      decision: "approved" as const,
      evidenceRef: "evidence-synthetic",
      notes: "SIMULATED PostgreSQL test decision",
    };
    await assert.rejects(
      () => decideProductCatalogReview({ ...decision, reviewedVersion: "0" }, actorId, database),
      /版本/,
    );
    await assert.rejects(
      () =>
        decideProductCatalogReview(
          { ...decision, approvalId: "wrong-approval" },
          actorId,
          database,
        ),
      /审核请求已变更/,
    );
    const [before] = await database
      .select()
      .from(aggregateRecord)
      .where(eq(aggregateRecord.id, inserted.id));
    assert.equal(before?.version, 1);
    assert.equal(before?.state, "PRODUCT_REVIEW_REQUIRED");
    const [pending] = await database
      .select()
      .from(approval)
      .where(eq(approval.id, inserted.approvalId));
    assert.equal(pending?.status, "pending");
    assert.equal(
      (
        await database
          .select()
          .from(workflowEvent)
          .where(eq(workflowEvent.aggregateId, inserted.id))
      ).length,
      1,
    );
    if (slot === 20) {
      const concurrent = await Promise.allSettled([
        decideProductCatalogReview(decision, actorId, database),
        decideProductCatalogReview(decision, actorId, database),
      ]);
      assert.equal(concurrent.filter((x) => x.status === "fulfilled").length, 1);
      assert.equal(concurrent.filter((x) => x.status === "rejected").length, 1);
      const rejected = concurrent.find((x) => x.status === "rejected");
      assert.ok(rejected?.status === "rejected");
      assert.match(String(rejected.reason), /版本|待审核状态/);
    } else {
      assert.equal(
        (await decideProductCatalogReview(decision, actorId, database)).state,
        "PRODUCT_READY",
      );
    }
    const [stored] = await database
      .select()
      .from(aggregateRecord)
      .where(eq(aggregateRecord.id, inserted.id));
    assert.ok(stored);
    assert.equal(stored.state, "PRODUCT_READY");
    assert.equal(stored.version, 2);
    assert.equal(stored.payload.verification_status, "verified");
    assert.deepEqual(stored.payload.product, draft.product);
    assert.deepEqual(stored.payload.field_evidence, draft.field_evidence);
    assert.equal(stored.payload.approval_ref, inserted.approvalId);
    assert.notEqual(stored.payload.approval_ref, mock.ready.approval_ref);
    const [link] = await database
      .select()
      .from(workspaceProjectItem)
      .where(eq(workspaceProjectItem.aggregateId, inserted.id));
    assert.equal(link?.projectId, projectId);
    const [approved] = await database
      .select()
      .from(approval)
      .where(eq(approval.id, inserted.approvalId));
    assert.equal(approved?.status, "approved");
    assert.equal(approved?.decidedById, actorId);
    const events = await database
      .select()
      .from(workflowEvent)
      .where(eq(workflowEvent.aggregateId, inserted.id));
    assert.equal(events.length, 2);
    assert.equal(
      events.filter((x) => x.toState === "PRODUCT_READY" && x.approvalId === inserted.approvalId)
        .length,
      1,
    );
    const audits = await database
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.aggregateId, inserted.id));
    assert.equal(audits.filter((x) => x.action === "product_gate_01_decided").length, 1);
    assert.ok(
      audits.some(
        (x) =>
          x.action === "product_agent_draft_created" && x.metadata.classification === "synthetic",
      ),
    );
  }
  assert.ok(missingEvidenceDraft);
  const invalid = structuredClone(missingEvidenceDraft);
  invalid.record_id = "synthetic-pg-missing-evidence";
  delete invalid.field_evidence["product.product_name"];
  const inserted = await database.transaction((tx) =>
    insertProductAgentDraft(
      tx,
      invalid,
      actorId,
      { classification: "synthetic", test_only: true },
      projectId,
    ),
  );
  await assert.rejects(
    () =>
      decideProductCatalogReview(
        {
          productId: inserted.id,
          approvalId: inserted.approvalId,
          reviewedVersion: "1",
          decision: "approved",
          evidenceRef: "evidence-synthetic",
          notes: "Synthetic missing-evidence rejection",
        },
        actorId,
        database,
      ),
    /field_evidence/,
  );
  const [unchanged] = await database
    .select()
    .from(aggregateRecord)
    .where(eq(aggregateRecord.id, inserted.id));
  const [unapproved] = await database
    .select()
    .from(approval)
    .where(eq(approval.id, inserted.approvalId));
  assert.equal(unchanged?.version, 1);
  assert.equal(unchanged?.state, "PRODUCT_REVIEW_REQUIRED");
  assert.equal(unapproved?.status, "pending");
  assert.equal(
    (await database.select().from(workflowEvent).where(eq(workflowEvent.aggregateId, inserted.id)))
      .length,
    1,
  );
  assert.equal(
    (
      await database.select().from(auditEvent).where(eq(auditEvent.aggregateId, inserted.id))
    ).filter((x) => x.action === "product_gate_01_decided").length,
    0,
  );
  console.log(
    "PASS PostgreSQL: 20 mock products persisted, source/mock evidence retained, project links and review audits verified; stale/concurrent/missing-evidence decisions fail atomically",
  );
}
