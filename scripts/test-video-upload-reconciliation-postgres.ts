import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { get } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDatabase, getDatabase } from "../lib/db/client";
import {
  evidence,
  user,
  videoUploadReceipt,
  workspaceProject,
  workspaceProjectMember,
} from "../lib/db/schema";
import { videoPresignedUploadPayloadSchema } from "../lib/video/upload-contracts";
import {
  claimCompletedVideoUploads,
  completeVideoUploadReceipt,
  issueVideoUploadReceipt,
} from "../lib/video/upload-receipts";

const url = process.env.DOCUMENT_UPLOAD_TEST_DATABASE_URL;
if (
  !url ||
  new URL(url).hostname !== "127.0.0.1" ||
  !["/f_trade_stream_test", "/f_trade_browser_test"].includes(new URL(url).pathname)
)
  throw new Error("Dedicated local synthetic database required");
process.env.DATABASE_URL = url;
process.env.DATABASE_TRANSPORT = "postgres";
const db = getDatabase(),
  actorId = randomUUID(),
  projectId = randomUUID(),
  rights = "evidence-synthetic-video-rights";
const bytes = Buffer.alloc(32);
bytes.write("ftyp", 4);
bytes.write("isom", 8);
const objects = new Map<string, Buffer>();
let reads = 0;
let mime = "video/mp4";
let onRead: undefined | (() => Promise<void>);
let cancelled = false;
const readBlob = (async (path: string) => {
  reads++;
  if (onRead) await onRead();
  const data = objects.get(path);
  if (!data) return null;
  return {
    statusCode: 200,
    blob: { contentType: mime },
    stream: new ReadableStream({
      start(c) {
        c.enqueue(data);
      },
      pull(c) {
        if (data.length > bytes.length) return; // Simulate an oversized stream that remains open.
        c.close();
      },
      cancel() {
        cancelled = true;
      },
    }),
  };
}) as unknown as typeof get;
const make = async (overrides = {}) => {
  const payload = videoPresignedUploadPayloadSchema.parse({
    receiptId: randomUUID(),
    projectId,
    originalFilename: "synthetic.mp4",
    contentType: "video/mp4",
    sizeBytes: bytes.length,
    rightsEvidenceRef: rights,
    ...overrides,
  });
  const issued = await issueVideoUploadReceipt(payload, actorId, db);
  objects.set(issued.blobPath, bytes);
  return { ...payload, actorId, blobPath: issued.blobPath };
};
const claim = (id: string, actor = actorId, project = projectId, right = rights) =>
  claimCompletedVideoUploads([id], actor, project, right, db, readBlob);
const receipt = async (id: string) =>
  (await db.select().from(videoUploadReceipt).where(eq(videoUploadReceipt.id, id)))[0];
void (async () => {
  await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: "drizzle" });
  try {
    await db.insert(user).values({
      id: actorId,
      name: "SYNTHETIC",
      email: `${actorId}@example.invalid`,
      role: "admin",
    });
    await db.insert(workspaceProject).values({
      id: projectId,
      title: "SYNTHETIC video reconciliation",
      kind: "marketing",
      createdById: actorId,
    });
    await db.insert(workspaceProjectMember).values({
      id: randomUUID(),
      projectId,
      userId: actorId,
      role: "owner",
      createdById: actorId,
    });
    const p = await make();
    const [a, b] = await Promise.all([claim(p.receiptId), claim(p.receiptId)]);
    assert.equal(a[0].assetRef, b[0].assetRef);
    assert.equal((await receipt(p.receiptId)).status, "claimed");
    const before = await receipt(p.receiptId);
    await completeVideoUploadReceipt(
      p,
      { pathname: p.blobPath, contentType: p.contentType, size: p.sizeBytes },
      db,
    );
    assert.deepEqual(await receipt(p.receiptId), before);
    await assert.rejects(
      completeVideoUploadReceipt(
        p,
        { pathname: p.blobPath, contentType: p.contentType, size: 1 },
        db,
      ),
    );
    assert.deepEqual(await receipt(p.receiptId), before);
    await assert.rejects(
      completeVideoUploadReceipt(
        { ...p, rightsEvidenceRef: "evidence-wrong-rights" },
        { pathname: p.blobPath, contentType: p.contentType, size: p.sizeBytes },
        db,
      ),
    );
    assert.deepEqual(await receipt(p.receiptId), before);
    const r = await make();
    const count = reads;
    await assert.rejects(claim(r.receiptId, randomUUID()));
    await assert.rejects(claim(r.receiptId, actorId, randomUUID()));
    await assert.rejects(claim(r.receiptId, actorId, projectId, "evidence-other"));
    assert.equal(reads, count);
    objects.delete(r.blobPath);
    await assert.rejects(claim(r.receiptId));
    objects.set(r.blobPath, bytes.subarray(0, 10));
    await assert.rejects(claim(r.receiptId));
    objects.set(r.blobPath, Buffer.alloc(32));
    await assert.rejects(claim(r.receiptId));
    objects.set(r.blobPath, bytes);
    mime = "image/png";
    await assert.rejects(claim(r.receiptId));
    mime = "video/mp4";
    objects.set(r.blobPath, Buffer.concat([bytes, bytes]));
    cancelled = false;
    await assert.rejects(claim(r.receiptId));
    assert.ok(cancelled);
    objects.set(r.blobPath, bytes);
    await db
      .update(videoUploadReceipt)
      .set({ expiresAt: new Date(0) })
      .where(eq(videoUploadReceipt.id, r.receiptId));
    await assert.rejects(claim(r.receiptId));
    await assert.rejects(
      completeVideoUploadReceipt(
        r,
        { pathname: r.blobPath, contentType: r.contentType, size: r.sizeBytes },
        db,
      ),
    );
    const expiring = await make();
    onRead = async () => {
      await db
        .update(videoUploadReceipt)
        .set({ expiresAt: new Date(0) })
        .where(eq(videoUploadReceipt.id, expiring.receiptId));
    };
    await assert.rejects(claim(expiring.receiptId));
    onRead = undefined;
    const failed = await make();
    await db
      .update(videoUploadReceipt)
      .set({ status: "failed" })
      .where(eq(videoUploadReceipt.id, failed.receiptId));
    const beforeFailedRead = reads;
    await assert.rejects(claim(failed.receiptId));
    assert.equal(reads, beforeFailedRead);
    const shortPng = await make({
      contentType: "image/png",
      originalFilename: "synthetic.png",
      sizeBytes: 3,
    });
    objects.set(shortPng.blobPath, Buffer.from([0x89, 0x50, 0x4e]));
    mime = "image/png";
    await assert.rejects(claim(shortPng.receiptId));
    mime = "video/mp4";
    await db.update(user).set({ banned: true }).where(eq(user.id, actorId));
    await assert.rejects(claim(p.receiptId));
    await assert.rejects(make());
    await db.update(user).set({ banned: false }).where(eq(user.id, actorId));
    const revoked = await make();
    onRead = async () => {
      await db
        .delete(workspaceProjectMember)
        .where(eq(workspaceProjectMember.projectId, projectId));
    };
    await assert.rejects(claim(revoked.receiptId));
    onRead = undefined;
    await db.insert(workspaceProjectMember).values({
      id: randomUUID(),
      projectId,
      userId: actorId,
      role: "owner",
      createdById: actorId,
    });
    const late = await make();
    onRead = async () => {
      await completeVideoUploadReceipt(
        late,
        { pathname: late.blobPath, contentType: late.contentType, size: late.sizeBytes },
        db,
      );
    };
    await claim(late.receiptId);
    onRead = undefined;
    await db
      .update(workspaceProject)
      .set({ status: "archived" })
      .where(eq(workspaceProject.id, projectId));
    const deniedReads = reads;
    await assert.rejects(claim(revoked.receiptId));
    assert.equal(reads, deniedReads);
    assert.equal(
      (await db.select().from(evidence).where(eq(evidence.uploadedById, actorId))).length,
      2,
    );
    console.log(
      "PASS missing/late callbacks, concurrent claims, immutable completion, exact bytes/type, stream bounds, expiry and revoked access",
    );
  } finally {
    await db.delete(videoUploadReceipt).where(eq(videoUploadReceipt.projectId, projectId));
    await db.delete(evidence).where(eq(evidence.uploadedById, actorId));
    await db.delete(workspaceProject).where(eq(workspaceProject.id, projectId));
    await db.delete(user).where(eq(user.id, actorId));
  }
})().finally(closeDatabase);
