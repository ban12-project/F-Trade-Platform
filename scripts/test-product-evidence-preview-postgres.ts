import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDatabase, getDatabase } from "../lib/db/client";
import { productCatalogCandidate, productCatalogImport } from "../lib/db/product-catalog-schema";
import * as schema from "../lib/db/schema";
import { issueDocumentUploadReceipt } from "../lib/product/document-upload-receipts";
import { prepareProductAgentEvidenceSource } from "../lib/product/evidence-locations";
import { listProductEvidencePreviews, readProductEvidence } from "../lib/product/evidence-preview";

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
  const [owner, viewer, outsider] = [randomUUID(), randomUUID(), randomUUID()];
  const [project, foreignProject, product, foreignProduct] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  const [sourceId, unrelatedId, foreignId] = [randomUUID(), randomUUID(), randomUUID()];
  const bytes = Buffer.from("Product name: SYNTHETIC kit\nInternal SKU: MOCK-401\n");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const source = {
    record_id: product,
    source_ref: `source-${digest}`,
    evidence_refs: [sourceId],
    source_text: bytes.toString(),
    image_availability: "none" as const,
    image_refs: [],
  };
  const sourceLocation = prepareProductAgentEvidenceSource(source).evidence_locations.find((item) =>
    item.text.includes("Product name:"),
  );
  assert.ok(sourceLocation);
  const payload = {
    source_ref: `source-${digest}`,
    field_evidence: {
      "product.product_name": sourceLocation.ref,
      "product.internal_sku": sourceId,
      "commercial.moq": "evidence-loc-unmatched",
    },
  };
  let reads = 0;
  function reader(data = bytes, contentType = "text/csv"): typeof get {
    return (async () => {
      reads++;
      return { statusCode: 200, stream: new Blob([data]).stream(), blob: { contentType } };
    }) as unknown as typeof get;
  }
  try {
    await migrate(db as unknown as Parameters<typeof migrate>[0], {
      migrationsFolder: "./drizzle",
    });
    for (const id of [owner, viewer, outsider])
      await db.insert(schema.user).values({
        id,
        name: "SYNTHETIC evidence preview",
        email: `${id}@example.invalid`,
        role: id === owner ? "admin" : "user",
      });
    for (const id of [project, foreignProject])
      await db
        .insert(schema.workspaceProject)
        .values({ id, title: "SYNTHETIC evidence preview", kind: "marketing", createdById: owner });
    for (const [projectId, userId, role] of [
      [project, owner, "owner"],
      [project, viewer, "viewer"],
      [foreignProject, owner, "owner"],
    ] as const)
      await db
        .insert(schema.workspaceProjectMember)
        .values({ id: randomUUID(), projectId, userId, role, createdById: owner });
    for (const [id, projectId] of [
      [product, project],
      [foreignProduct, foreignProject],
    ]) {
      await db.insert(schema.aggregateRecord).values({
        id,
        type: "product",
        state: "PRODUCT_REVIEW_REQUIRED",
        payload,
        createdByType: "human",
        createdById: owner,
      });
      await db
        .insert(schema.workspaceProjectItem)
        .values({ id: randomUUID(), projectId, aggregateId: id, role: "product_source" });
    }
    for (const [id, projectId] of [
      [sourceId, project],
      [unrelatedId, project],
      [foreignId, foreignProject],
    ]) {
      await db.insert(schema.evidence).values({
        id,
        classification: "internal",
        blobKey: `synthetic-private/${id}`,
        contentType: "text/csv",
        sha256: id === unrelatedId ? "0".repeat(64) : digest,
        sizeBytes: bytes.length,
        sourceLabel: `SYNTHETIC source ${id}`,
        uploadedByType: "human",
        uploadedById: owner,
      });
      await db
        .insert(schema.workspaceProjectEvidence)
        .values({ id: randomUUID(), projectId, evidenceId: id, linkedById: owner });
    }
    const receiptId = randomUUID();
    await issueDocumentUploadReceipt(
      {
        receiptId,
        projectId: project,
        purpose: "agent",
        originalFilename: "synthetic.csv",
        contentType: "text/csv",
        sizeBytes: bytes.length,
      },
      owner,
      db,
    );
    const importId = randomUUID();
    await db.insert(productCatalogImport).values({
      id: importId,
      projectId: project,
      actorId: owner,
      receiptId,
      evidenceId: sourceId,
      status: "ready",
    });
    await db.insert(productCatalogCandidate).values({
      id: randomUUID(),
      importId,
      ordinal: 0,
      identifier: "MOCK-401",
      source,
      recordLine: 1,
      reviewStatus: "source_review_required",
      status: "completed",
      productId: product,
    });
    const previews = await listProductEvidencePreviews(project, product, viewer, db);
    assert.equal(previews.length, 1);
    assert.deepEqual(Object.keys(previews[0]).sort(), [
      "contentType",
      "fields",
      "href",
      "id",
      "label",
    ]);
    assert.equal(
      previews[0].fields.find((field) => field.path === "product.product_name")?.excerpt,
      sourceLocation.text,
    );
    assert.equal(
      previews[0].fields.find((field) => field.path === "commercial.moq")?.excerpt,
      undefined,
    );
    assert.equal(
      previews[0].fields.find((field) => field.path === "product.internal_sku")?.excerpt,
      undefined,
    );
    assert.equal(previews[0].href, `/api/product-evidence/${project}/${product}/${sourceId}`);
    for (const actor of [owner, viewer]) {
      const file = await readProductEvidence(project, product, sourceId, actor, db, reader());
      assert.deepEqual(file?.bytes, bytes);
      assert.equal(file?.inline, true);
    }
    const beforeDenied = reads;
    for (const [p, item, evidenceId, actor] of [
      [project, product, sourceId, outsider],
      [project, foreignProduct, sourceId, owner],
      [foreignProject, product, sourceId, owner],
      [project, product, unrelatedId, owner],
      [project, product, foreignId, owner],
      [project, randomUUID(), sourceId, owner],
    ])
      assert.equal(await readProductEvidence(p, item, evidenceId, actor, db, reader()), null);
    assert.equal(reads, beforeDenied, "unauthorized requests must not access private storage");
    assert.deepEqual(await listProductEvidencePreviews(project, product, outsider, db), []);
    await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, viewer));
    assert.equal(await readProductEvidence(project, product, sourceId, viewer, db, reader()), null);
    await db.update(schema.user).set({ banned: false }).where(eq(schema.user.id, viewer));
    assert.equal(
      await readProductEvidence(
        project,
        product,
        sourceId,
        viewer,
        db,
        reader(bytes, "application/pdf"),
      ),
      null,
    );
    assert.equal(
      await readProductEvidence(
        project,
        product,
        sourceId,
        viewer,
        db,
        reader(Buffer.alloc(bytes.length, 65)),
      ),
      null,
    );
    await assert.rejects(
      readProductEvidence(
        project,
        product,
        sourceId,
        viewer,
        db,
        reader(Buffer.concat([bytes, bytes])),
      ),
      /大小/,
    );
    const revokingReader = (async (...args: Parameters<typeof get>) => {
      await db
        .delete(schema.workspaceProjectMember)
        .where(
          and(
            eq(schema.workspaceProjectMember.projectId, project),
            eq(schema.workspaceProjectMember.userId, viewer),
          ),
        );
      return reader()(...args);
    }) as typeof get;
    assert.equal(
      await readProductEvidence(project, product, sourceId, viewer, db, revokingReader),
      null,
    );
    // A saved reference alone must not expose a source removed from the current project.
    await db
      .delete(schema.workspaceProjectEvidence)
      .where(
        and(
          eq(schema.workspaceProjectEvidence.projectId, project),
          eq(schema.workspaceProjectEvidence.evidenceId, sourceId),
        ),
      );
    assert.equal(await readProductEvidence(project, product, sourceId, owner, db, reader()), null);
    console.log(
      "PASS private evidence: exact excerpts, minimal DTO, owner/viewer access, project/product/source binding, banned/nonmember denial, byte/MIME integrity and mid-read revocation",
    );
  } finally {
    await closeDatabase();
  }
})();
