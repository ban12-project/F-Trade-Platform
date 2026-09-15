import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { get } from "@vercel/blob";
import { eq, inArray, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDatabase, getDatabase } from "../lib/db/client";
import { productCatalogAttempt, productCatalogImport } from "../lib/db/product-catalog-schema";
import {
  aggregateRecord,
  approval,
  auditEvent,
  evidence,
  productDocumentUploadReceipt,
  session,
  user,
  workflowEvent,
  workspaceProject,
  workspaceProjectEvidence,
  workspaceProjectItem,
  workspaceProjectMember,
} from "../lib/db/schema";
import { finalizeProductAgentDraft, type ProductAgentSource } from "../lib/product/agent";
import {
  catalogImportView,
  claimCatalogAttempt,
  completeCatalogCandidate,
  completeCatalogParsing,
  failCatalogAttempt,
  intakeCatalog,
  retryCatalogParsing,
  selectCatalogRecords,
} from "../lib/product/catalog-import-store";
import {
  claimDocumentUpload,
  issueDocumentUploadReceipt,
} from "../lib/product/document-upload-receipts";
import { prepareProductAgentEvidenceSource } from "../lib/product/evidence-locations";

const url = process.env.DOCUMENT_UPLOAD_TEST_DATABASE_URL;
if (
  !url ||
  new URL(url).hostname !== "127.0.0.1" ||
  !["/f_trade_stream_test", "/f_trade_browser_test"].includes(new URL(url).pathname)
)
  throw new Error("Dedicated local synthetic database required");
process.env.DATABASE_URL = url;
process.env.DATABASE_TRANSPORT = "postgres";
const db = getDatabase();
const identity = { actorId: randomUUID(), sessionId: randomUUID(), projectId: randomUUID() };
const bytes = Buffer.from("SYNTHETIC,ONLY\n");
const readBlob = (async () => ({
  statusCode: 200,
  blob: { contentType: "text/csv" },
  stream: new Blob([bytes]).stream(),
})) as unknown as typeof get;
const claim: typeof claimDocumentUpload = (input, actor, database) =>
  claimDocumentUpload(input, actor, database, readBlob);
const productIds: string[] = [];

function result(source: ProductAgentSource) {
  const prepared = prepareProductAgentEvidenceSource(source);
  const fields = {
    product_name: "MOCK clutch kit",
    product_type: "clutch_kit",
    internal_sku: source.candidate_identifier,
  };
  const labels = {
    product_name: "Product name:",
    product_type: "Product type:",
    internal_sku: "Internal SKU:",
  };
  return {
    draft: finalizeProductAgentDraft(
      {
        record_id: source.record_id,
        source_ref: source.source_ref,
        evidence_refs: prepared.evidence_refs,
        field_evidence: Object.fromEntries(
          Object.entries(labels).map(([key, label]) => {
            const location = prepared.evidence_locations.find((entry) =>
              entry.text.includes(label),
            );
            assert.ok(location);
            return [`product.${key}`, location.ref];
          }),
        ),
        verification_status: "review_required",
        blocking_missing_fields: [],
        optional_missing_fields: [],
        product: fields,
      },
      prepared,
    ),
    metadata: { prompt_version: "SYNTHETIC", prompt_hash: "SYNTHETIC" },
  };
}

void (async () => {
  await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: "./drizzle" });
  try {
    await db.insert(user).values({
      id: identity.actorId,
      name: "SYNTHETIC",
      email: `${identity.actorId}@example.invalid`,
      role: "user",
      banned: false,
    });
    await db.insert(session).values({
      id: identity.sessionId,
      userId: identity.actorId,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await db.insert(workspaceProject).values({
      id: identity.projectId,
      title: "SYNTHETIC catalog",
      kind: "marketing",
      createdById: identity.actorId,
    });
    await db.insert(workspaceProjectMember).values({
      id: randomUUID(),
      projectId: identity.projectId,
      userId: identity.actorId,
      role: "owner",
      createdById: identity.actorId,
    });
    const receipt = await issueDocumentUploadReceipt(
      {
        receiptId: randomUUID(),
        projectId: identity.projectId,
        purpose: "agent",
        originalFilename: "synthetic.csv",
        contentType: "text/csv",
        sizeBytes: bytes.length,
      },
      identity.actorId,
      db,
    );
    const input = { projectId: identity.projectId, receiptId: receipt.id };
    const [first, repeated] = await Promise.all([
      intakeCatalog(input, identity, db, claim),
      intakeCatalog(input, identity, db, claim),
    ]);
    assert.equal(first.importId, repeated.importId);
    const parseIds = [...first.attemptIds, ...repeated.attemptIds];
    assert.equal(parseIds.length, 1, "concurrent receipt intake creates one parse attempt");
    const parseId = parseIds[0];
    assert.ok(parseId);
    const claims = await Promise.all([
      claimCatalogAttempt(parseId, db),
      claimCatalogAttempt(parseId, db),
    ]);
    assert.equal(claims.filter(Boolean).length, 1, "duplicate workers cannot both claim");
    const work = claims.find(Boolean);
    assert.ok(work);
    const sourceText = Array.from(
      { length: 20 },
      (_, index) =>
        `<!-- f-trade:pdf-page=${index + 1} -->\nInternal SKU: RYC-MOCK${index === 1 ? 0 : index}\nProduct name: MOCK clutch kit\nProduct type: clutch_kit`,
    ).join("\n\n");
    await assert.rejects(
      completeCatalogParsing(
        parseId,
        {
          source: {
            record_id: first.importId,
            source_ref: "synthetic",
            evidence_refs: ["synthetic"],
            source_text: sourceText,
            image_availability: "none",
            image_refs: [],
          },
          document_sha256: "bad",
          filename: "synthetic.csv",
          media_type: "text/csv",
          ocr_enabled: false,
          layout_recovered_pages: [],
          conversion_status: "converted",
        },
        db,
      ),
      /摘要/,
    );
    assert.equal(
      await completeCatalogParsing(
        parseId,
        {
          source: {
            record_id: first.importId,
            source_ref: "synthetic",
            evidence_refs: ["synthetic"],
            source_text: sourceText,
            image_availability: "none",
            image_refs: [],
          },
          document_sha256: work.original.sha256,
          filename: "synthetic.csv",
          media_type: "text/csv",
          ocr_enabled: false,
          layout_recovered_pages: [],
          conversion_status: "converted",
        },
        db,
      ),
      true,
    );
    const lookup = { projectId: identity.projectId, importId: first.importId };
    const view = await catalogImportView(lookup, identity, db);
    assert.equal(view.candidates.length, 20);
    assert.equal(view.candidates.filter((candidate) => candidate.duplicateIdentifier).length, 2);
    assert.deepEqual(
      view.candidates.map((candidate) => candidate.physicalPage),
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    assert.equal((await retryCatalogParsing(lookup, identity, db)).attemptIds.length, 0);
    productIds.push(...view.candidates.map((candidate) => candidate.id));
    const selection = {
      ...lookup,
      candidateIds: productIds,
      modelConfigId: "synthetic-model",
      model: "synthetic",
    };
    await assert.rejects(
      selectCatalogRecords({ ...selection, candidateIds: [randomUUID()] }, identity, db),
      /不属于/,
    );
    await assert.rejects(
      selectCatalogRecords(selection, { ...identity, sessionId: randomUUID() }, db),
      /会话/,
    );
    await db
      .update(workspaceProject)
      .set({ status: "archived" })
      .where(eq(workspaceProject.id, identity.projectId));
    await assert.rejects(selectCatalogRecords(selection, identity, db), /进行中/);
    await db
      .update(workspaceProject)
      .set({ status: "active" })
      .where(eq(workspaceProject.id, identity.projectId));
    const batch = await selectCatalogRecords(selection, identity, db);
    assert.equal(batch.attemptIds.length, 20);
    assert.equal((await selectCatalogRecords(selection, identity, db)).attemptIds.length, 0);

    // One failure, one expired worker and one permission change; every other record completes.
    for (const [index, id] of batch.attemptIds.entries()) {
      const item = await claimCatalogAttempt(id, db);
      assert.ok(item?.source);
      if (index === 0) {
        await failCatalogAttempt(id, "MODEL_FAILED", db);
        continue;
      }
      if (index === 1) {
        await db
          .update(productCatalogAttempt)
          .set({ leaseExpiresAt: new Date(0) })
          .where(eq(productCatalogAttempt.id, id));
        const retried = await selectCatalogRecords(
          { ...selection, candidateIds: [item.source.record_id] },
          identity,
          db,
        );
        assert.equal(retried.attemptIds.length, 1);
        assert.equal(
          await completeCatalogCandidate(id, result(item.source), db),
          false,
          "late worker cannot insert",
        );
        await failCatalogAttempt(id, "MODEL_FAILED", db);
        const freshId = retried.attemptIds[0];
        assert.ok(freshId);
        const fresh = await claimCatalogAttempt(freshId, db);
        assert.ok(fresh?.source, "late failure must not clobber the current attempt");
        await completeCatalogCandidate(fresh.attemptId, result(fresh.source), db);
        continue;
      }
      if (index === 2) {
        await db.update(user).set({ banned: true }).where(eq(user.id, identity.actorId));
        await assert.rejects(completeCatalogCandidate(id, result(item.source), db), /会话/);
        await db.update(user).set({ banned: false }).where(eq(user.id, identity.actorId));
        await db
          .update(session)
          .set({ expiresAt: new Date(0) })
          .where(eq(session.id, identity.sessionId));
        await assert.rejects(completeCatalogCandidate(id, result(item.source), db), /会话/);
        await db
          .update(session)
          .set({ expiresAt: new Date(Date.now() + 3_600_000) })
          .where(eq(session.id, identity.sessionId));
        await db
          .delete(workspaceProjectMember)
          .where(eq(workspaceProjectMember.projectId, identity.projectId));
        await assert.rejects(completeCatalogCandidate(id, result(item.source), db), /权限/);
        await db.insert(workspaceProjectMember).values({
          id: randomUUID(),
          projectId: identity.projectId,
          userId: identity.actorId,
          role: "owner",
          createdById: identity.actorId,
        });
        await failCatalogAttempt(id, "ACCESS_REVOKED", db);
        continue;
      }
      if (index === 3) {
        const poisoned = result(item.source);
        poisoned.draft.product.product_name = "Invented unsupported fact";
        await assert.rejects(completeCatalogCandidate(id, poisoned, db));
      }
      assert.equal(await completeCatalogCandidate(id, result(item.source), db), true);
      assert.equal(await completeCatalogCandidate(id, result(item.source), db), false);
    }
    const partial = await catalogImportView(lookup, identity, db);
    assert.equal(
      partial.candidates.filter((candidate) => candidate.status === "completed").length,
      18,
    );
    const retry = await selectCatalogRecords(selection, identity, db);
    assert.equal(retry.attemptIds.length, 2, "only failed records are retried");
    for (const id of retry.attemptIds) {
      const item = await claimCatalogAttempt(id, db);
      assert.ok(item?.source);
      await completeCatalogCandidate(id, result(item.source), db);
    }
    const saved = await db
      .select()
      .from(aggregateRecord)
      .where(inArray(aggregateRecord.id, productIds));
    assert.equal(saved.length, 20);
    assert.ok(saved.every((row) => row.state === "PRODUCT_REVIEW_REQUIRED"));
    const audits = await db
      .select()
      .from(auditEvent)
      .where(inArray(auditEvent.aggregateId, productIds));
    assert.equal(audits.length, 20);
    assert.ok(
      audits.every((row) => row.metadata.original_evidence_id === work.original.evidenceId),
    );
    const approvals = await db
      .select()
      .from(approval)
      .where(inArray(approval.aggregateId, productIds));
    assert.equal(approvals.length, 20);
    assert.ok(approvals.every((row) => row.status === "pending"));
    const final = await catalogImportView(lookup, identity, db);
    assert.ok(final.candidates.every((candidate) => candidate.status === "completed"));
    assert.equal((await selectCatalogRecords(selection, identity, db)).attemptIds.length, 0);
    await db.delete(session).where(eq(session.id, identity.sessionId));
    await assert.rejects(catalogImportView(lookup, identity, db), /会话/);
    console.log(
      "PASS: 20 independent review drafts, duplicate identifiers/pages, concurrent intake/claim, partial retry, stale worker fencing, revoked session/user and invented-fact rejection",
    );
  } finally {
    try {
      await db.transaction(async (tx) => {
        // Restricted to the dedicated synthetic database; rollback restores triggers on failure.
        await tx.execute(
          sql`ALTER TABLE workflow_event DISABLE TRIGGER workflow_event_append_only`,
        );
        await tx.execute(sql`ALTER TABLE audit_event DISABLE TRIGGER audit_event_append_only`);
        await tx
          .delete(productCatalogImport)
          .where(eq(productCatalogImport.projectId, identity.projectId));
        if (productIds.length) {
          await tx
            .delete(workspaceProjectItem)
            .where(inArray(workspaceProjectItem.aggregateId, productIds));
          await tx.delete(approval).where(inArray(approval.aggregateId, productIds));
          await tx.delete(workflowEvent).where(inArray(workflowEvent.aggregateId, productIds));
          await tx.delete(auditEvent).where(inArray(auditEvent.aggregateId, productIds));
          await tx.delete(aggregateRecord).where(inArray(aggregateRecord.id, productIds));
        }
        await tx
          .delete(workspaceProjectEvidence)
          .where(eq(workspaceProjectEvidence.projectId, identity.projectId));
        await tx
          .delete(productDocumentUploadReceipt)
          .where(eq(productDocumentUploadReceipt.projectId, identity.projectId));
        await tx.delete(evidence).where(eq(evidence.uploadedById, identity.actorId));
        await tx.delete(workspaceProject).where(eq(workspaceProject.id, identity.projectId));
        await tx.delete(user).where(eq(user.id, identity.actorId));
        await tx.execute(sql`ALTER TABLE workflow_event ENABLE TRIGGER workflow_event_append_only`);
        await tx.execute(sql`ALTER TABLE audit_event ENABLE TRIGGER audit_event_append_only`);
      });
    } finally {
      await closeDatabase();
    }
  }
})();
