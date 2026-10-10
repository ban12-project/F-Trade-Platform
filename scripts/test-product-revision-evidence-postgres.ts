import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDatabase, getDatabase } from "../lib/db/client";
import * as schema from "../lib/db/schema";
import {
  manualProductFactEvidenceFields,
  productCatalogFormSchema,
} from "../lib/product/catalog-form-schema";
import {
  buildEvidenceBoundProductCatalogDraft,
  createEvidenceBoundProductCatalogDraft,
  reviseEvidenceBoundProductCatalogDraft,
} from "../lib/product/evidence-bound-catalog";
import { productStreamFields } from "../lib/product/stream-contract";
import { decideProductCatalogReview, insertProductAgentDraft } from "../lib/products";

const connection = process.env.DOCUMENT_UPLOAD_TEST_DATABASE_URL;
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
  const actors = [randomUUID(), randomUUID()] as const;
  const projects = [randomUUID(), randomUUID()] as const;
  const refs = Array.from({ length: 4 }, () => `evidence-${randomUUID()}`);
  const [baseRef, supplementRef, foreignRef, imageRef] = refs as [string, string, string, string];
  try {
    await migrate(db as unknown as Parameters<typeof migrate>[0], {
      migrationsFolder: "./drizzle",
    });
    const sessionIds = [randomUUID(), randomUUID()] as const;
    const reviewIdentity = { actorId: actors[0], sessionId: sessionIds[0], projectId: projects[0] };
    for (const index of [0, 1] as const) {
      await db.insert(schema.user).values({
        id: actors[index],
        name: "SYNTHETIC revision test",
        email: `${actors[index]}@example.invalid`,
        role: "admin",
      });
      await db.insert(schema.session).values({
        id: sessionIds[index],
        token: randomUUID(),
        userId: actors[index],
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await db.insert(schema.workspaceProject).values({
        id: projects[index],
        title: "SYNTHETIC revision test",
        kind: "marketing",
        createdById: actors[index],
      });
      await db.insert(schema.workspaceProjectMember).values({
        id: randomUUID(),
        projectId: projects[index],
        userId: actors[index],
        role: "owner",
        createdById: actors[index],
      });
    }
    // Membership in another project must not authorize changing this product there.
    await db.insert(schema.workspaceProjectMember).values({
      id: randomUUID(),
      projectId: projects[1],
      userId: actors[0],
      role: "editor",
      createdById: actors[1],
    });
    for (const ref of refs)
      await db.insert(schema.evidence).values({
        id: ref,
        classification: "restricted",
        blobKey: `synthetic-only/${ref}`,
        contentType: ref === imageRef ? "image/png" : "text/csv",
        sha256: createHash("sha256").update(ref).digest("hex"),
        sizeBytes: 8,
        sourceLabel: "SYNTHETIC revision test",
        uploadedByType: "human",
        uploadedById: ref === foreignRef ? actors[1] : actors[0],
      });
    // Synthetic metadata fixture only; this test never writes to cloud storage.
    await db.insert(schema.productDocumentUploadReceipt).values({
      id: randomUUID(),
      projectId: projects[0],
      ownerId: actors[0],
      purpose: "agent_image",
      blobPath: `synthetic-only/${imageRef}`,
      originalFilename: "synthetic.png",
      contentType: "image/png",
      sizeBytes: 8,
      evidenceId: imageRef,
      expiresAt: new Date(Date.now() + 60000),
    });
    const values = [
      "MOCK kit",
      "clutch_kit",
      "MOCK-SKU",
      "000-MOCK-OE",
      "MOCK application",
      "MOCK Brand",
      "MOCK Model",
      "240",
      "21",
      "MOCK spline",
      "MOCK material",
      "clutch_disc,pressure_plate",
      "9.5",
      "8.5",
      "MOCK box",
      "10",
      "0",
      "MOCK original packaging",
      "MOCK label",
      "no",
    ];
    assert.equal(values.length, manualProductFactEvidenceFields.length);
    const form = productCatalogFormSchema.parse(
      Object.fromEntries([
        ...manualProductFactEvidenceFields.flatMap(([name, ref], index) => [
          [name, values[index]],
          [
            ref,
            `evidence-loc-line-${String(index + 1).padStart(6, "0")}-${String(index + 1).padStart(6, "0")}-${createHash("sha256").update(`MOCK-${index}`).digest("hex").slice(0, 32)}`,
          ],
        ]),
        ["sourceRef", "source-synthetic-revision"],
      ]),
    );
    async function createRejected(withImage: boolean) {
      const id = randomUUID();
      const draft = buildEvidenceBoundProductCatalogDraft(form, id);
      const saved = await db.transaction((tx) =>
        insertProductAgentDraft(tx, draft, actors[0], {}, projects[0], withImage ? [imageRef] : []),
      );
      await decideProductCatalogReview(
        {
          productId: id,
          approvalId: saved.approvalId,
          reviewedVersion: "1",
          decision: "rejected",
          evidenceRef: baseRef,
          notes: "MOCK simulated rejection",
        },
        reviewIdentity,
        db,
      );
      return { id, draft };
    }
    const saved = await createRejected(true);
    const revision = {
      ...form,
      packaging: "MOCK revised packaging",
      packagingEvidenceRef: supplementRef,
    };
    const current = async () => {
      const [record] = await db
        .select()
        .from(schema.aggregateRecord)
        .where(eq(schema.aggregateRecord.id, saved.id));
      assert.ok(record);
      return record;
    };
    const baseline = await current();
    for (const [input, actor, project] of [
      [{ ...revision, productName: "MOCK changed without fresh evidence" }, actors[0], projects[0]],
      [
        { ...revision, productNameEvidenceRef: form.internalSkuEvidenceRef },
        actors[0],
        projects[0],
      ],
      [
        {
          ...revision,
          productNameEvidenceRef: `evidence-loc-line-000099-000099-${"f".repeat(32)}`,
        },
        actors[0],
        projects[0],
      ],
      [{ ...revision, packagingEvidenceRef: foreignRef }, actors[0], projects[0]],
      [{ ...revision, sourceRef: "source-unrelated" }, actors[0], projects[0]],
      [revision, actors[1], projects[0]],
      [revision, actors[0], projects[1]],
    ] as const) {
      await assert.rejects(reviseEvidenceBoundProductCatalogDraft(saved.id, input, actor, project));
      assert.deepEqual(await current(), baseline);
    }
    await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, actors[0]));
    await assert.rejects(
      reviseEvidenceBoundProductCatalogDraft(saved.id, revision, actors[0], projects[0]),
    );
    await db.update(schema.user).set({ banned: false }).where(eq(schema.user.id, actors[0]));
    const attempts = await Promise.allSettled(
      [0, 1].map(() =>
        reviseEvidenceBoundProductCatalogDraft(saved.id, revision, actors[0], projects[0]),
      ),
    );
    assert.equal(attempts.filter((a) => a.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((a) => a.status === "rejected").length, 1);
    const success = attempts.find((a) => a.status === "fulfilled");
    assert.ok(success?.status === "fulfilled");
    const updated = await current();
    assert.equal(updated.state, "PRODUCT_REVIEW_REQUIRED");
    assert.equal(updated.version, 3);
    const result = success.value.draft;
    for (const path of productStreamFields.filter((p) => p !== "commercial.packaging"))
      assert.equal(result.field_evidence[path], saved.draft.field_evidence[path]);
    assert.deepEqual(result.product, saved.draft.product);
    assert.deepEqual(result.specifications, saved.draft.specifications);
    assert.equal(result.commercial?.sample_available, false);
    assert.deepEqual(result.commercial, {
      ...saved.draft.commercial,
      packaging: revision.packaging,
    });
    const images = await db
      .select()
      .from(schema.productSourceImage)
      .where(eq(schema.productSourceImage.productId, saved.id));
    assert.deepEqual(
      images.map((i) => i.evidenceId),
      [imageRef],
    );
    const [audit] = await db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.aggregateId, saved.id),
          eq(schema.auditEvent.action, "product_draft_revised"),
        ),
      );
    assert.equal(audit?.metadata.retained_evidence_location_count, 19);
    assert.ok(audit);
    assert.equal(audit?.actorId, actors[0]);
    assert.equal(audit?.metadata.approval_id, success.value.approvalId);
    assert.deepEqual(audit?.metadata.fact_revision, {
      schema_version: "1.0.0",
      from_version: 2,
      to_version: 3,
      source_ref_before: saved.draft.source_ref,
      source_ref_after: saved.draft.source_ref,
      changes: [
        {
          path: "commercial.packaging",
          before: {
            value: form.packaging,
            evidence_ref: saved.draft.field_evidence["commercial.packaging"],
          },
          after: { value: success.value.draft.commercial?.packaging, evidence_ref: supplementRef },
        },
      ],
    });
    const correctionAudits = await db
      .select({ id: schema.auditEvent.id })
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.aggregateId, saved.id),
          eq(schema.auditEvent.action, "product_draft_revised"),
        ),
      );
    assert.equal(
      correctionAudits.length,
      1,
      "Rejected and competing revisions cannot leave false history",
    );
    await assert.rejects(
      db.update(schema.auditEvent).set({ metadata: {} }).where(eq(schema.auditEvent.id, audit.id)),
      (error: unknown) =>
        error instanceof Error &&
        error.cause instanceof Error &&
        /append-only/.test(error.cause.message),
    );
    await assert.rejects(
      db.delete(schema.auditEvent).where(eq(schema.auditEvent.id, audit.id)),
      (error: unknown) =>
        error instanceof Error &&
        error.cause instanceof Error &&
        /append-only/.test(error.cause.message),
    );
    const decision = {
      productId: saved.id,
      approvalId: success.value.approvalId,
      reviewedVersion: "3",
      decision: "approved" as const,
      evidenceRef: supplementRef,
      notes: "MOCK simulated approval",
    };
    await assert.rejects(decideProductCatalogReview(decision, reviewIdentity, db), /图片/);
    await decideProductCatalogReview(
      { ...decision, imageConsistencyConfirmed: "true" },
      reviewIdentity,
      db,
    );
    assert.equal((await current()).state, "PRODUCT_READY");
    const unchanged = await createRejected(false);
    const retained = await reviseEvidenceBoundProductCatalogDraft(
      unchanged.id,
      form,
      actors[0],
      projects[0],
    );
    assert.deepEqual(retained.draft.field_evidence, unchanged.draft.field_evidence);
    const [unchangedAudit] = await db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.aggregateId, unchanged.id),
          eq(schema.auditEvent.action, "product_draft_revised"),
        ),
      );
    assert.ok(unchangedAudit);
    assert.deepEqual((unchangedAudit.metadata.fact_revision as { changes: unknown[] }).changes, []);
    console.log(
      "PASS locked revision preserves unchanged locations, rejects changed/foreign/rebound facts, serializes competing edits and retains image Gate",
    );

    const manualForm = { ...form };
    for (const [, key] of manualProductFactEvidenceFields) manualForm[key] = baseRef;
    const manual = await createEvidenceBoundProductCatalogDraft(
      manualForm,
      actors[0],
      projects[0],
      [imageRef],
      reviewIdentity,
    );
    const [manualRecord] = await db
      .select()
      .from(schema.aggregateRecord)
      .where(eq(schema.aggregateRecord.id, manual.id));
    assert.equal(manualRecord?.state, "PRODUCT_REVIEW_REQUIRED");
    assert.equal(manualRecord?.version, 1);
    const manualImages = await db
      .select()
      .from(schema.productSourceImage)
      .where(eq(schema.productSourceImage.productId, manual.id));
    assert.deepEqual(
      manualImages.map((i) => i.evidenceId),
      [imageRef],
    );
    assert.ok(!manual.draft.evidence_refs.includes(imageRef));
    const [manualAudit] = await db
      .select()
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.aggregateId, manual.id));
    assert.deepEqual(manualAudit?.metadata.source_image_refs, [imageRef]);
    const manualDecision = {
      productId: manual.id,
      approvalId: manual.approvalId,
      reviewedVersion: "1",
      decision: "approved" as const,
      evidenceRef: baseRef,
      notes: "SYNTHETIC manual image gate",
    };
    await assert.rejects(decideProductCatalogReview(manualDecision, reviewIdentity, db), /图片/);
    await decideProductCatalogReview(
      { ...manualDecision, imageConsistencyConfirmed: "true" },
      reviewIdentity,
      db,
    );

    const footprint = async () =>
      JSON.stringify(
        (
          await db.execute(
            sql`SELECT (SELECT count(*) FROM aggregate_record) AS products,(SELECT count(*) FROM product_source_image) AS images,(SELECT count(*) FROM approval) AS approvals,(SELECT count(*) FROM workflow_event) AS transitions,(SELECT count(*) FROM audit_event) AS audit`,
          )
        ).rows,
      );
    const expectNoPartialCreate = async (
      input: unknown,
      refs: string[],
      identity = reviewIdentity,
    ) => {
      const before = await footprint();
      await assert.rejects(
        createEvidenceBoundProductCatalogDraft(input, actors[0], projects[0], refs, identity),
      );
      assert.equal(await footprint(), before);
    };
    await expectNoPartialCreate(manualForm, [foreignRef]);
    await expectNoPartialCreate(manualForm, [imageRef, imageRef]);
    await expectNoPartialCreate(manualForm, [
      imageRef,
      baseRef,
      supplementRef,
      foreignRef,
      "evidence-synthetic-fifth",
    ]);
    await expectNoPartialCreate({ ...manualForm, productNameEvidenceRef: imageRef }, []);
    await expectNoPartialCreate(manualForm, [imageRef], {
      ...reviewIdentity,
      sessionId: sessionIds[1],
    });
    await db
      .update(schema.session)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.session.id, sessionIds[0]));
    await expectNoPartialCreate(manualForm, [imageRef]);
    await db
      .update(schema.session)
      .set({ expiresAt: new Date(Date.now() + 3_600_000) })
      .where(eq(schema.session.id, sessionIds[0]));

    const beforeDeadline = await footprint();
    let unlockImages = () => {};
    let notifyImageLock = () => {};
    const imageLockReady = new Promise<void>((resolve) => {
      notifyImageLock = resolve;
    });
    const holdImages = new Promise<void>((resolve) => {
      unlockImages = resolve;
    });
    const blockedImages = db.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE product_source_image IN ACCESS EXCLUSIVE MODE`);
      notifyImageLock();
      await holdImages;
    });
    await imageLockReady;
    await db
      .update(schema.session)
      .set({ expiresAt: new Date(Date.now() + 1500) })
      .where(eq(schema.session.id, sessionIds[0]));
    const waitingCreate = createEvidenceBoundProductCatalogDraft(
      manualForm,
      actors[0],
      projects[0],
      [imageRef],
      reviewIdentity,
    );
    const rejectedCreate = assert.rejects(waitingCreate);
    try {
      let observedWaiting = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        const waits = await db.execute(
          sql`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%product_source_image%' AND query NOT LIKE '%pg_stat_activity%'`,
        );
        if (waits.rows.length) {
          observedWaiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(
        observedWaiting,
        true,
        "Observe the actual image insertion transaction waiting before expiry",
      );
      await new Promise((resolve) => setTimeout(resolve, 1600));
    } finally {
      unlockImages();
      await blockedImages;
    }
    await rejectedCreate;
    assert.equal(await footprint(), beforeDeadline);
    await db
      .update(schema.session)
      .set({ expiresAt: new Date(Date.now() + 3_600_000) })
      .where(eq(schema.session.id, sessionIds[0]));
    console.log(
      "PASS session expiry while the real image-table write waits rolls back draft, images, approval, transition and audit at final commit guard",
    );
    await db
      .update(schema.workspaceProjectMember)
      .set({ role: "viewer" })
      .where(
        and(
          eq(schema.workspaceProjectMember.projectId, projects[0]),
          eq(schema.workspaceProjectMember.userId, actors[0]),
        ),
      );
    await expectNoPartialCreate(manualForm, [imageRef]);
    await db
      .update(schema.workspaceProjectMember)
      .set({ role: "owner" })
      .where(
        and(
          eq(schema.workspaceProjectMember.projectId, projects[0]),
          eq(schema.workspaceProjectMember.userId, actors[0]),
        ),
      );

    const imageRevision = await createRejected(false);
    const imageRevised = await reviseEvidenceBoundProductCatalogDraft(
      imageRevision.id,
      form,
      actors[0],
      projects[0],
      [imageRef],
      reviewIdentity,
    );
    const [imageRevisionRecord] = await db
      .select()
      .from(schema.aggregateRecord)
      .where(eq(schema.aggregateRecord.id, imageRevision.id));
    assert.equal(imageRevisionRecord?.version, 3);
    assert.equal(imageRevisionRecord?.state, "PRODUCT_REVIEW_REQUIRED");
    const [imageRevisionAudit] = await db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.aggregateId, imageRevision.id),
          eq(schema.auditEvent.action, "product_draft_revised"),
        ),
      );
    assert.deepEqual(imageRevisionAudit?.metadata.added_source_image_refs, [imageRef]);
    assert.ok(imageRevisionAudit);
    assert.deepEqual(
      (imageRevisionAudit.metadata.fact_revision as { changes: unknown[] }).changes,
      [],
    );
    await assert.rejects(
      decideProductCatalogReview(
        {
          ...manualDecision,
          productId: imageRevision.id,
          approvalId: imageRevised.approvalId,
          reviewedVersion: "3",
        },
        reviewIdentity,
        db,
      ),
      /图片/,
    );
    await decideProductCatalogReview(
      {
        ...manualDecision,
        decision: "rejected",
        productId: imageRevision.id,
        approvalId: imageRevised.approvalId,
        reviewedVersion: "3",
      },
      reviewIdentity,
      db,
    );
    const beforeDuplicate = await footprint();
    const [beforeDuplicateRecord] = await db
      .select()
      .from(schema.aggregateRecord)
      .where(eq(schema.aggregateRecord.id, imageRevision.id));
    await assert.rejects(
      reviseEvidenceBoundProductCatalogDraft(
        imageRevision.id,
        form,
        actors[0],
        projects[0],
        [imageRef],
        reviewIdentity,
      ),
      /重复/,
    );
    assert.equal(await footprint(), beforeDuplicate);
    const [afterDuplicateRecord] = await db
      .select()
      .from(schema.aggregateRecord)
      .where(eq(schema.aggregateRecord.id, imageRevision.id));
    assert.deepEqual(afterDuplicateRecord, beforeDuplicateRecord);
    console.log(
      "PASS manual entry/revision retain private images atomically, reset image review, reject foreign/duplicate images and image-as-fact; expired/foreign sessions and lost project access leave no partial product, image, approval or audit",
    );
  } finally {
    await closeDatabase();
  }
})();
