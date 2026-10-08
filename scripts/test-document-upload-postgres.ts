import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { get } from "@vercel/blob";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDatabase, getDatabase } from "../lib/db/client";
import {
  evidence,
  productDocumentUploadReceipt as receipt,
  session,
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
import { ProductUploadError, productIntakeFailureMessage } from "../lib/product/intake-errors";
import { listProjectEvidenceOptions, removeWorkspaceProjectMember } from "../lib/workspace/access";

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
const sessionIds = [randomUUID(), randomUUID()];
const identity = (index: number) => ({
  actorId: actors[index],
  sessionId: sessionIds[index],
  projectId: projects[0],
});
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
    identity(0),
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
    await db.insert(session).values(
      actors.map((userId, index) => ({
        id: sessionIds[index],
        userId,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 3_600_000),
      })),
    );
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
    const first = await issueDocumentUploadReceipt(payload(), identity(0), db);
    const results = await Promise.all([claim(first.id), claim(first.id)]);
    assert.equal(results[0].evidenceId, results[1].evidenceId, "concurrent claims are idempotent");
    assert.equal(results[0].sha256, createHash("sha256").update(bytes).digest("hex"));
    const second = await issueDocumentUploadReceipt(
      payload({ originalFilename: "SYNTHETIC 第二份目录.csv" }),
      identity(0),
      db,
    );
    const secondClaim = await claim(second.id);
    assert.notEqual(
      secondClaim.evidenceId,
      results[0].evidenceId,
      "identical bytes retain independent provenance",
    );
    const options = await listProjectEvidenceOptions(projects[0], actors[0], db);
    assert.equal(
      options.find((item) => item.id === results[0].evidenceId)?.sourceLabel,
      "synthetic.csv",
    );
    assert.equal(
      options.find((item) => item.id === secondClaim.evidenceId)?.sourceLabel,
      "SYNTHETIC 第二份目录.csv",
      "distinct original filenames identify identical-byte source uploads",
    );
    assert.deepEqual(Object.keys(options[0]).sort(), [
      "classification",
      "contentType",
      "createdAt",
      "id",
      "sourceLabel",
    ]);
    await assert.rejects(listProjectEvidenceOptions(projects[0], actors[1], db), /不是该项目成员/);
    const ownedOptions = await listProjectEvidenceOptions(projects[1], actors[0], db);
    assert.ok(ownedOptions.some((item) => item.id === results[0].evidenceId));
    assert.equal(
      ownedOptions.find((item) => item.id === secondClaim.evidenceId)?.sourceLabel,
      "SYNTHETIC 第二份目录.csv",
    );
    const legacyId = `evidence-${randomUUID()}`;
    const legacyPath = `synthetic:legacy-${randomUUID()}`;
    await db.insert(evidence).values({
      id: legacyId,
      classification: "restricted",
      blobKey: legacyPath,
      contentType: "text/csv",
      sha256: "0".repeat(64),
      sizeBytes: 1,
      sourceLabel: "SYNTHETIC legacy source",
      uploadedByType: "human",
      uploadedById: actors[0],
    });
    await db.insert(workspaceProjectEvidence).values({
      id: randomUUID(),
      projectId: projects[0],
      evidenceId: legacyId,
      linkedById: actors[0],
    });
    const legacyLabel = async () =>
      (await listProjectEvidenceOptions(projects[0], actors[0], db)).find(
        (item) => item.id === legacyId,
      )?.sourceLabel;
    assert.equal(await legacyLabel(), "SYNTHETIC legacy source", "old sources retain their label");
    const unmatched = await issueDocumentUploadReceipt(
      payload({ originalFilename: "SYNTHETIC mismatched receipt.csv" }),
      identity(0),
      db,
    );
    await db.update(receipt).set({ evidenceId: legacyId }).where(eq(receipt.id, unmatched.id));
    assert.equal(
      await legacyLabel(),
      "SYNTHETIC legacy source",
      "different blob metadata is ignored",
    );
    await db.update(evidence).set({ blobKey: unmatched.blobPath }).where(eq(evidence.id, legacyId));
    await db.update(receipt).set({ ownerId: actors[1] }).where(eq(receipt.id, unmatched.id));
    assert.equal(
      await legacyLabel(),
      "SYNTHETIC legacy source",
      "different uploader metadata is ignored",
    );
    await db.update(receipt).set({ ownerId: actors[0] }).where(eq(receipt.id, unmatched.id));
    await db.update(evidence).set({ uploadedByType: "agent" }).where(eq(evidence.id, legacyId));
    assert.equal(
      await legacyLabel(),
      "SYNTHETIC legacy source",
      "non-human sources retain their label",
    );
    await db.update(evidence).set({ uploadedByType: "human" }).where(eq(evidence.id, legacyId));
    await db
      .update(receipt)
      .set({ evidenceId: secondClaim.evidenceId })
      .where(eq(receipt.id, unmatched.id));
    assert.equal(
      await legacyLabel(),
      "SYNTHETIC legacy source",
      "different evidence metadata is ignored",
    );
    await db.update(receipt).set({ evidenceId: null }).where(eq(receipt.id, unmatched.id));
    await db.update(evidence).set({ blobKey: legacyPath }).where(eq(evidence.id, legacyId));
    const viewerMemberships = [randomUUID(), randomUUID()];
    await db.insert(workspaceProjectMember).values(
      projects.map((projectId, index) => ({
        id: viewerMemberships[index],
        projectId,
        userId: actors[1],
        role: "viewer" as const,
        createdById: actors[0],
      })),
    );
    const sharedOptions = await listProjectEvidenceOptions(projects[0], actors[1], db);
    assert.equal(
      sharedOptions.find((item) => item.id === results[0].evidenceId)?.sourceLabel,
      "synthetic.csv",
    );
    assert.deepEqual(
      await listProjectEvidenceOptions(projects[1], actors[1], db),
      [],
      "membership in another project does not reveal unlinked foreign source names",
    );
    await db
      .delete(workspaceProjectMember)
      .where(inArray(workspaceProjectMember.id, viewerMemberships));
    await assert.rejects(
      issueDocumentUploadReceipt(payload({ receiptId: first.id }), identity(0), db),
      /已使用/,
    );
    await assert.rejects(issueDocumentUploadReceipt(payload(), identity(1), db), /权限/);
    let before = reads;
    await assert.rejects(claim(first.id, { purpose: "agent" }), /无效/);
    await assert.rejects(claim(first.id, { projectId: projects[1] }), /权限/);
    await assert.rejects(claim(first.id, { blobPath: first.blobPath }));
    assert.equal(reads, before, "invalid authority must not read the blob");
    await db
      .update(receipt)
      .set({ expiresAt: new Date(0) })
      .where(eq(receipt.id, first.id));
    assert.equal(
      (await listProjectEvidenceOptions(projects[0], actors[0], db)).find(
        (item) => item.id === results[0].evidenceId,
      )?.sourceLabel,
      "synthetic.csv",
      "receipt expiry does not erase a previously claimed source's identity",
    );
    await assert.rejects(claim(first.id), /过期/);
    assert.equal(reads, before);
    blobBytes = Buffer.alloc(bytes.length, 0);
    await assert.rejects(claim(second.id), /类型/);
    blobBytes = Buffer.alloc(bytes.length, 65);
    await assert.rejects(
      claim(second.id),
      (error: unknown) => error instanceof ProductUploadError && error.code === "upload_changed",
    );
    blobBytes = bytes;
    const transportError = () =>
      Object.assign(new Error("SYNTHETIC transport failure"), { code: "ECONNRESET" });
    const runWithReader = (id: string, reader: typeof get) =>
      claimDocumentUpload(
        { receiptId: id, projectId: projects[0], purpose: "evidence" },
        identity(0),
        db,
        reader,
      );
    for (const mode of ["initial", "partial"] as const) {
      const retryReceipt = await issueDocumentUploadReceipt(payload(), identity(0), db);
      let attempts = 0;
      const flaky = (async () => {
        attempts++;
        if (attempts === 1) {
          if (mode === "initial") throw new Error("SYNTHETIC wrapper", { cause: transportError() });
          let pulled = false;
          return {
            statusCode: 200,
            blob: { contentType: "text/csv" },
            stream: new ReadableStream<Uint8Array>({
              pull(controller) {
                if (pulled) controller.error(transportError());
                else {
                  pulled = true;
                  controller.enqueue(bytes.subarray(0, 5));
                }
              },
            }),
          };
        }
        return readBlob(retryReceipt.blobPath, { access: "private" });
      }) as typeof get;
      const result = await runWithReader(retryReceipt.id, flaky);
      assert.equal(attempts, 2);
      assert.equal(
        result.sha256,
        createHash("sha256").update(bytes).digest("hex"),
        "retry discards partial bytes",
      );
      const [saved] = await db.select().from(receipt).where(eq(receipt.id, retryReceipt.id));
      assert.equal(saved.evidenceId, result.evidenceId);
    }
    for (const mode of ["persistent", "missing", "mime", "bytes", "dns", "expired"] as const) {
      const failed = await issueDocumentUploadReceipt(payload(), identity(0), db);
      let attempts = 0;
      const reader = (async () => {
        attempts++;
        if (mode === "persistent") throw transportError();
        if (mode === "dns")
          throw Object.assign(new Error("SYNTHETIC invalid host"), { code: "ENOTFOUND" });
        if (mode === "expired") {
          await db
            .update(receipt)
            .set({ expiresAt: new Date(0) })
            .where(eq(receipt.id, failed.id));
          throw transportError();
        }
        if (mode === "missing") return null;
        return {
          statusCode: 200,
          blob: { contentType: mode === "mime" ? "application/pdf" : "text/csv" },
          stream: new Blob([Buffer.alloc(bytes.length, 0)]).stream(),
        };
      }) as typeof get;
      await assert.rejects(runWithReader(failed.id, reader), (error: unknown) => {
        if (["missing", "mime", "bytes"].includes(mode)) {
          assert.ok(error instanceof ProductUploadError);
          assert.equal(
            error.code,
            mode === "missing" ? "upload_unavailable" : "upload_type_mismatch",
          );
        } else {
          assert.ok(!(error instanceof ProductUploadError));
          assert.equal(productIntakeFailureMessage(error), productIntakeFailureMessage(null));
        }
        return true;
      });
      assert.equal(attempts, mode === "persistent" ? 2 : 1, `${mode}: bounded retry policy`);
      const [saved] = await db.select().from(receipt).where(eq(receipt.id, failed.id));
      assert.equal(saved.evidenceId, null, "failed reads must not attach evidence");
    }
    const revoked = await issueDocumentUploadReceipt(payload(), identity(0), db);
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
        identity(0),
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
    await db.insert(workspaceProjectMember).values({
      id: randomUUID(),
      projectId: projects[0],
      userId: actors[0],
      role: "owner",
      createdById: actors[1],
    });
    const retryRevoked = await issueDocumentUploadReceipt(payload(), identity(0), db);
    let revokedAttempts = 0;
    await assert.rejects(
      runWithReader(retryRevoked.id, (async () => {
        revokedAttempts++;
        await removeWorkspaceProjectMember(
          { projectId: projects[0], userId: actors[0] },
          actors[1],
          db,
        );
        throw transportError();
      }) as typeof get),
      /权限/,
    );
    assert.equal(revokedAttempts, 1, "revocation prevents a second private read");
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
      "PASS: direct document upload bounds, digest, provenance, source filenames/fallback/metadata isolation, concurrent claims, type/purpose/owner/project/expiry and mid-read revocation",
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
