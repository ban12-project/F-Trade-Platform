import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import sharp from "sharp";
import fixture from "../data/fixtures/product-draft-complete.synthetic.json";
import { closeDatabase, getDatabase } from "../lib/db/client";
import * as schema from "../lib/db/schema";
import {
  claimDocumentUpload,
  issueDocumentUploadReceipt,
} from "../lib/product/document-upload-receipts";
import { readProductSourceImage } from "../lib/product/source-image-preview";
import { type ProductDraft, reviewProductDraft } from "../lib/product/verification";
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
  const actors = [randomUUID(), randomUUID()];
  const projects = [randomUUID(), randomUUID()];
  const productIds: string[] = [];
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "blue" } })
    .png()
    .toBuffer();
  const reader = (async () => ({
    statusCode: 200,
    stream: new Blob([bytes]).stream(),
    blob: { contentType: "image/png" },
  })) as unknown as typeof get;
  try {
    await migrate(db as unknown as Parameters<typeof migrate>[0], {
      migrationsFolder: "./drizzle",
    });
    for (let index = 0; index < 2; index++) {
      await db.insert(schema.user).values({
        id: actors[index],
        name: "SYNTHETIC image test",
        email: `${actors[index]}@example.invalid`,
        role: "admin",
      });
      await db.insert(schema.workspaceProject).values({
        id: projects[index],
        title: "SYNTHETIC image test",
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
    const receiptId = randomUUID();
    const payload = {
      receiptId,
      projectId: projects[0],
      purpose: "agent_image",
      originalFilename: "synthetic.png",
      contentType: "image/png",
      sizeBytes: bytes.length,
    };
    await issueDocumentUploadReceipt(payload, actors[0]!, db);
    const claim = { receiptId, projectId: projects[0], purpose: "agent_image" };
    for (const invalid of [
      { ...claim, purpose: "agent" },
      { ...claim, projectId: projects[1] },
    ])
      await assert.rejects(claimDocumentUpload(invalid, actors[0]!, db, reader));
    await assert.rejects(claimDocumentUpload(claim, actors[1]!, db, reader));
    const image = await claimDocumentUpload(claim, actors[0]!, db, reader);
    assert.equal(
      (await claimDocumentUpload(claim, actors[0]!, db, reader)).evidenceId,
      image.evidenceId,
    );
    const changed = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } })
      .png()
      .toBuffer();
    const alteredReader = (async () => ({
      statusCode: 200,
      stream: new Blob([changed]).stream(),
      blob: { contentType: "image/png" },
    })) as unknown as typeof get;
    await assert.rejects(claimDocumentUpload(claim, actors[0]!, db, alteredReader));
    async function makeDraft(refs: string[], index = 0) {
      const id = randomUUID();
      productIds.push(id);
      const draft = reviewProductDraft({ ...fixture, record_id: id } as ProductDraft);
      return db.transaction((tx) =>
        insertProductAgentDraft(tx, draft, actors[index]!, {}, projects[index], refs),
      );
    }
    await assert.rejects(makeDraft([image.evidenceId], 1));
    await assert.rejects(makeDraft([image.evidenceId, image.evidenceId]));
    const saved = await makeDraft([image.evidenceId]);
    assert.deepEqual(
      (await readProductSourceImage(saved.id, image.evidenceId, actors[0]!, db, reader))?.bytes,
      bytes,
    );
    assert.equal(
      await readProductSourceImage(saved.id, image.evidenceId, actors[1]!, db, reader),
      null,
    );
    assert.equal(
      await readProductSourceImage(randomUUID(), image.evidenceId, actors[0]!, db, reader),
      null,
    );
    await assert.rejects(async () => {
      const result = await readProductSourceImage(
        saved.id,
        image.evidenceId,
        actors[0]!,
        db,
        alteredReader,
      );
      if (!result) throw new Error("Changed bytes denied");
    });
    const revokeReader = (async (...args: Parameters<typeof get>) => {
      await db
        .delete(schema.workspaceProjectMember)
        .where(
          and(
            eq(schema.workspaceProjectMember.projectId, projects[0]!),
            eq(schema.workspaceProjectMember.userId, actors[0]!),
          ),
        );
      return reader(...args);
    }) as typeof get;
    assert.equal(
      await readProductSourceImage(saved.id, image.evidenceId, actors[0]!, db, revokeReader),
      null,
    );
    await db.insert(schema.workspaceProjectMember).values({
      id: randomUUID(),
      projectId: projects[0],
      userId: actors[0],
      role: "owner",
      createdById: actors[0],
    });
    const decision = {
      productId: saved.id,
      approvalId: saved.approvalId,
      reviewedVersion: "1",
      decision: "approved" as const,
      evidenceRef: image.evidenceId,
      notes: "SYNTHETIC simulated confirmation only",
    };
    await assert.rejects(decideProductCatalogReview(decision, actors[0]!, db), /图片/);
    await assert.rejects(
      decideProductCatalogReview(
        { ...decision, imageConsistencyConfirmed: "false" },
        actors[0]!,
        db,
      ),
      /图片/,
    );
    const [unchanged] = await db
      .select()
      .from(schema.aggregateRecord)
      .where(eq(schema.aggregateRecord.id, saved.id));
    assert.equal(unchanged?.version, 1);
    assert.equal(unchanged?.state, "PRODUCT_REVIEW_REQUIRED");
    assert.equal(
      (
        await decideProductCatalogReview(
          { ...decision, imageConsistencyConfirmed: "true" },
          actors[0]!,
          db,
        )
      ).state,
      "PRODUCT_READY",
    );
    const [audit] = await db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.aggregateId, saved.id),
          eq(schema.auditEvent.action, "product_gate_01_decided"),
        ),
      );
    assert.equal(audit?.metadata.image_consistency_confirmed, true);
    assert.deepEqual(audit?.metadata.source_image_refs, [image.evidenceId]);
    const noImage = await makeDraft([]);
    assert.equal(
      (
        await decideProductCatalogReview(
          { ...decision, productId: noImage.id, approvalId: noImage.approvalId },
          actors[0]!,
          db,
        )
      ).state,
      "PRODUCT_READY",
    );
    const rejected = await makeDraft([image.evidenceId]);
    assert.equal(
      (
        await decideProductCatalogReview(
          {
            ...decision,
            productId: rejected.id,
            approvalId: rejected.approvalId,
            decision: "rejected",
          },
          actors[0]!,
          db,
        )
      ).state,
      "PRODUCT_REVISION_REQUIRED",
    );
    console.log(
      "PASS PostgreSQL source-image project/owner/purpose binding, preview digest and revocation, required Gate 01 confirmation, refusal and no-image behavior",
    );
  } finally {
    // Audit/workflow tables are append-only. Keep synthetic fixtures in the dedicated test DB.
    await closeDatabase();
  }
})();
