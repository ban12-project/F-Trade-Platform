import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { get } from "@vercel/blob";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDatabase, getDatabase } from "../lib/db/client";
import {
  evidence,
  productDocumentUploadReceipt as receipt,
  user,
  workspaceProject,
  workspaceProjectEvidence,
  workspaceProjectMember,
} from "../lib/db/schema";
import { verifyDocumentUploadBytes } from "../lib/product/document-upload-bytes";
import {
  documentUploadPayloadSchema,
  maximumProductDocumentBytes,
} from "../lib/product/document-upload-contracts";
import {
  claimDocumentUpload,
  issueDocumentUploadReceipt,
} from "../lib/product/document-upload-receipts";
import { removeWorkspaceProjectMember } from "../lib/workspace/access";

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
const actors = [randomUUID(), randomUUID()];
const projects = [randomUUID(), randomUUID()];
const bytes = Buffer.from("SYNTHETIC,UPLOAD\nMOCK,ONLY\n");
let blobBytes = bytes;
let reads = 0;
const readBlob = (async () => {
  reads++;
  return {
    statusCode: 200,
    blob: { contentType: "text/csv" },
    stream: new Blob([blobBytes]).stream(),
  };
}) as unknown as typeof get;
const payload = (overrides = {}) =>
  documentUploadPayloadSchema.parse({
    receiptId: randomUUID(),
    projectId: projects[0],
    purpose: "evidence",
    originalFilename: "synthetic.csv",
    contentType: "text/csv",
    sizeBytes: bytes.length,
    ...overrides,
  });
const claim = (id: string, overrides = {}) =>
  claimDocumentUpload(
    { receiptId: id, projectId: projects[0], purpose: "evidence", ...overrides },
    actors[0],
    db,
    readBlob,
  );

void (async () => {
  await migrate(db as unknown as Parameters<typeof migrate>[0], {
    migrationsFolder: "./drizzle",
  });
  try {
    for (const actor of actors)
      await db
        .insert(user)
        .values({ id: actor, name: "SYNTHETIC", email: `${actor}@example.invalid`, role: "admin" });
    for (const project of projects) {
      await db.insert(workspaceProject).values({
        id: project,
        title: "SYNTHETIC upload",
        kind: "marketing",
        createdById: actors[0],
      });
      await db.insert(workspaceProjectMember).values({
        id: randomUUID(),
        projectId: project,
        userId: actors[0],
        role: "owner",
        createdById: actors[0],
      });
    }
    const first = await issueDocumentUploadReceipt(payload(), actors[0], db);
    const results = await Promise.all([claim(first.id), claim(first.id)]);
    assert.equal(results[0].evidenceId, results[1].evidenceId, "concurrent claims are idempotent");
    assert.equal(results[0].sha256, createHash("sha256").update(bytes).digest("hex"));
    const second = await issueDocumentUploadReceipt(payload(), actors[0], db);
    assert.notEqual(
      (await claim(second.id)).evidenceId,
      results[0].evidenceId,
      "identical bytes retain independent provenance",
    );
    await assert.rejects(
      issueDocumentUploadReceipt(payload({ receiptId: first.id }), actors[0], db),
      /已使用/,
    );
    await assert.rejects(issueDocumentUploadReceipt(payload(), actors[1], db), /权限/);
    let before = reads;
    await assert.rejects(claim(first.id, { purpose: "agent" }), /无效/);
    await assert.rejects(claim(first.id, { projectId: projects[1] }), /无效/);
    await assert.rejects(claim(first.id, { blobPath: first.blobPath }));
    assert.equal(reads, before, "invalid authority must not read the blob");
    await db
      .update(receipt)
      .set({ expiresAt: new Date(0) })
      .where(eq(receipt.id, first.id));
    await assert.rejects(claim(first.id), /过期/);
    assert.equal(reads, before);
    blobBytes = Buffer.alloc(bytes.length, 0);
    await assert.rejects(claim(second.id), /类型/);
    blobBytes = Buffer.alloc(bytes.length, 65);
    await assert.rejects(claim(second.id), /变化/);
    blobBytes = bytes;
    const revoked = await issueDocumentUploadReceipt(payload(), actors[0], db);
    await db.insert(workspaceProjectMember).values({
      id: randomUUID(),
      projectId: projects[0],
      userId: actors[1],
      role: "owner",
      createdById: actors[0],
    });
    // Revoke after the private read starts: the final transaction must re-authorize.
    const revokeOnRead = (async () => {
      await removeWorkspaceProjectMember(
        { projectId: projects[0], userId: actors[0] },
        actors[1],
        db,
      );
      return readBlob(revoked.blobPath, { access: "private" });
    }) as typeof get;
    await assert.rejects(
      claimDocumentUpload(
        { receiptId: revoked.id, projectId: projects[0], purpose: "evidence" },
        actors[0],
        db,
        revokeOnRead,
      ),
      /权限/,
    );
    const [unclaimed] = await db.select().from(receipt).where(eq(receipt.id, revoked.id));
    assert.equal(unclaimed.evidenceId, null);
    before = reads;
    await assert.rejects(claim(revoked.id), /权限/);
    assert.equal(reads, before);
    for (const size of [1024 * 1024 + 1, maximumProductDocumentBytes]) {
      const large = Buffer.alloc(size, 65);
      const verified = await verifyDocumentUploadBytes(
        new Blob([large]).stream(),
        "synthetic.csv",
        size,
      );
      assert.equal(verified.sizeBytes, size);
      assert.equal(verified.sha256, createHash("sha256").update(large).digest("hex"));
    }
    await assert.rejects(
      verifyDocumentUploadBytes(new Blob([bytes]).stream(), "synthetic.csv", bytes.length - 1),
      /大小/,
    );
    await assert.rejects(
      verifyDocumentUploadBytes(new Blob([bytes]).stream(), "synthetic.csv", bytes.length + 1),
      /大小/,
    );
    await assert.rejects(
      verifyDocumentUploadBytes(new Blob([bytes]).stream(), "synthetic.pdf", bytes.length),
      /类型/,
    );
    await assert.rejects(
      verifyDocumentUploadBytes(new Blob([bytes]).stream(), "synthetic.xlsx", bytes.length),
      /类型/,
    );
    await assert.rejects(
      verifyDocumentUploadBytes(
        new Blob([bytes]).stream(),
        "synthetic.csv",
        maximumProductDocumentBytes + 1,
      ),
      /大小/,
    );
    assert.throws(() => payload({ sizeBytes: maximumProductDocumentBytes + 1 }));
    assert.throws(() => payload({ originalFilename: "../synthetic.csv" }));
    assert.throws(() => payload({ contentType: "application/pdf" }));
    console.log(
      "PASS: direct document upload bounds, digest, provenance, concurrent claims, type/purpose/owner/project/expiry and mid-read revocation",
    );
  } finally {
    await db
      .delete(workspaceProjectEvidence)
      .where(inArray(workspaceProjectEvidence.projectId, projects));
    await db.delete(receipt).where(inArray(receipt.projectId, projects));
    await db.delete(evidence).where(inArray(evidence.uploadedById, actors));
    await db.delete(workspaceProject).where(inArray(workspaceProject.id, projects));
    await db.delete(user).where(inArray(user.id, actors));
    await closeDatabase();
  }
})();
