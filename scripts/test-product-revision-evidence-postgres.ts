import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDatabase, getDatabase } from "../lib/db/client";
import * as schema from "../lib/db/schema";
import {
  manualProductFactEvidenceFields,
  productCatalogFormSchema,
} from "../lib/product/catalog-form-schema";
import {
  buildEvidenceBoundProductCatalogDraft,
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
    for (const index of [0, 1] as const) {
      await db.insert(schema.user).values({
        id: actors[index],
        name: "SYNTHETIC revision test",
        email: `${actors[index]}@example.invalid`,
        role: "admin",
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
        actors[0],
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
    const current = async () =>
      (
        await db
          .select()
          .from(schema.aggregateRecord)
          .where(eq(schema.aggregateRecord.id, saved.id))
      )[0]!;
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
    const decision = {
      productId: saved.id,
      approvalId: success.value.approvalId,
      reviewedVersion: "3",
      decision: "approved" as const,
      evidenceRef: supplementRef,
      notes: "MOCK simulated approval",
    };
    await assert.rejects(decideProductCatalogReview(decision, actors[0], db), /图片/);
    await decideProductCatalogReview(
      { ...decision, imageConsistencyConfirmed: "true" },
      actors[0],
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
    console.log(
      "PASS locked revision preserves unchanged locations, rejects changed/foreign/rebound facts, serializes competing edits and retains image Gate",
    );
  } finally {
    await closeDatabase();
  }
})();
