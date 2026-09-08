/** Synthetic, migrated PostgreSQL regression for claim -> signed authorization.
 * No browser, Facebook account, or blob/network delivery is used. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { Database } from "../lib/db/client";
import { facebookPublicationManifest } from "../lib/db/facebook-runtime-schema";
import { productMediaAsset } from "../lib/db/product-media-schema";
import * as schema from "../lib/db/schema";
import { authorizeFacebookPublication } from "../lib/social/facebook-media-store";
import { claimNextSocialWorkerJob } from "../lib/social/job-store";

async function main() {
  const connectionString = process.env.FACEBOOK_PUBLICATION_TEST_DATABASE_URL;
  assert.ok(connectionString, "Dedicated synthetic database required");
  const address = new URL(connectionString);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(address.hostname));
  assert.equal(address.pathname, "/facebook_publication_test");
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  const database = db as unknown as Database;
  const now = new Date();
  const actor = randomUUID();
  const projectId = randomUUID();
  const channelRef = randomUUID();
  const accountRef = randomUUID();
  const workerId = randomUUID();
  process.env.SOCIAL_WORKER_ID = workerId;
  process.env.SOCIAL_WORKER_CHANNEL_REF = channelRef;
  process.env.SOCIAL_WORKER_ACCOUNT_REF = accountRef;
  process.env.SOCIAL_WORKER_SIGNING_KEY = Buffer.alloc(32, 7).toString("base64");

  async function fixture(format = "text", jobAccount = accountRef) {
    const contentRef = randomUUID();
    const id = randomUUID();
    const jobId = randomUUID();
    await db.insert(schema.aggregateRecord).values({
      id: contentRef,
      type: "content",
      state: "CONTENT_APPROVED",
      payload: { body: "SYNTHETIC review fixture; no product claims." },
      createdByType: "human",
      createdById: actor,
    });
    await db.insert(schema.workspaceProjectItem).values({
      id: randomUUID(),
      projectId,
      aggregateId: contentRef,
      role: "marketing_content",
    });
    await db.insert(schema.approval).values({
      id: randomUUID(),
      aggregateId: contentRef,
      gate: "gate_01_truth",
      status: "approved",
      requestedByType: "human",
      requestedById: actor,
      requestedAt: now,
      decidedByType: "human",
      decidedById: actor,
      decidedAt: now,
      evidenceRef: "synthetic-review",
    });
    await db.insert(schema.socialBrowserJob).values({
      id: jobId,
      channelRef,
      accountRef: jobAccount,
      kind: "publish",
      idempotencyKey: randomUUID(),
      payloadRef: id,
    });
    await db.insert(schema.socialPublication).values({
      id,
      projectId,
      channelRef,
      accountRef: jobAccount,
      contentRef,
      format,
      confirmationRef: "synthetic-confirmation",
      browserJobId: jobId,
      status: "submitted",
    });
    return { id, jobId, contentRef };
  }
  async function imageFixture() {
    const f = await fixture("image");
    const productId = randomUUID();
    const evidenceId = randomUUID();
    const mediaId = randomUUID();
    const caption = "SYNTHETIC image review fixture; no product claims.";
    const sha256 = createHash("sha256").update(evidenceId).digest("hex");
    await db.insert(schema.aggregateRecord).values({
      id: productId,
      type: "product",
      state: "PRODUCT_READY",
      payload: { synthetic: true },
      createdByType: "human",
      createdById: actor,
    });
    await db
      .update(schema.aggregateRecord)
      .set({ payload: { body: caption, product_id: productId } })
      .where(eq(schema.aggregateRecord.id, f.contentRef));
    await db.insert(schema.evidence).values({
      id: evidenceId,
      classification: "internal",
      blobKey: `synthetic/${evidenceId}`,
      contentType: "image/png",
      sha256,
      sizeBytes: 100,
      sourceLabel: "SYNTHETIC ONLY",
      uploadedByType: "human",
      uploadedById: actor,
    });
    await db.insert(productMediaAsset).values({
      id: mediaId,
      productId,
      evidenceId,
      origin: "user_upload",
      mediaType: "image",
      role: "product_hero",
      contentType: "image/png",
      width: 10,
      height: 10,
      rightsEvidenceRef: evidenceId,
      publicDistributionAllowed: true,
      reviewStatus: "approved",
      reviewedBy: actor,
      reviewedAt: now,
      reviewEvidenceRef: evidenceId,
      createdBy: actor,
    });
    await db.insert(facebookPublicationManifest).values({
      publicationId: f.id,
      contentVersion: 1,
      format: "image",
      caption,
      mediaId,
      confirmedBy: actor,
      media: { assetRef: evidenceId, contentType: "image/png", sizeBytes: 100, sha256 },
    });
    return { ...f, mediaId };
  }
  async function claim() {
    return claimNextSocialWorkerJob(workerId, new Date(), database);
  }
  async function expectPaused(jobId: string) {
    assert.equal(await claim(), null);
    const [job] = await db
      .select()
      .from(schema.socialBrowserJob)
      .where(eq(schema.socialBrowserJob.id, jobId));
    assert.equal(job.status, "paused");
  }
  try {
    await migrate(db, { migrationsFolder: "drizzle" });
    await db
      .insert(schema.user)
      .values({ id: actor, name: "Synthetic", email: `${actor}@example.invalid` });
    await db
      .insert(schema.workspaceProject)
      .values({ id: projectId, kind: "marketing", title: "SYNTHETIC", createdById: actor });
    await db.insert(schema.socialChannelControl).values({
      id: randomUUID(),
      channelRef,
      accountRef,
      enabled: true,
      circuitStatus: "active",
      changedBy: actor,
      changedAt: now,
    });

    const text = await fixture();
    const claimed = await claim();
    assert.ok(claimed);
    assert.equal(claimed.command.command.jobId, text.jobId);
    await authorizeFacebookPublication(claimed.command, claimed.payload, database);
    await assert.rejects(
      authorizeFacebookPublication(
        claimed.command,
        { ...claimed.payload, text: "tampered" },
        database,
      ),
    );
    await db
      .update(schema.aggregateRecord)
      .set({ payload: { body: "changed after claim" } })
      .where(eq(schema.aggregateRecord.id, text.contentRef));
    await assert.rejects(authorizeFacebookPublication(claimed.command, claimed.payload, database));
    console.log("PASS text claim authorizes; tampering and post-claim edits denied");

    const image = await imageFixture();
    const mediaClaim = await claim();
    assert.ok(mediaClaim);
    assert.equal(mediaClaim.command.command.jobId, image.jobId);
    assert.equal(mediaClaim.payload.version, 2);
    await authorizeFacebookPublication(mediaClaim.command, mediaClaim.payload, database);
    await db
      .update(productMediaAsset)
      .set({ publicDistributionAllowed: false })
      .where(eq(productMediaAsset.id, image.mediaId));
    await assert.rejects(
      authorizeFacebookPublication(mediaClaim.command, mediaClaim.payload, database),
    );
    console.log("PASS image manifest authorizes; revoked rights denied");

    await expectPaused((await fixture("image")).jobId);
    const stale = await imageFixture();
    await db
      .update(schema.aggregateRecord)
      .set({ version: 2 })
      .where(eq(schema.aggregateRecord.id, stale.contentRef));
    await expectPaused(stale.jobId);
    const mismatched = await imageFixture();
    await db
      .update(schema.socialPublication)
      .set({ format: "text" })
      .where(eq(schema.socialPublication.id, mismatched.id));
    // A text publication must not silently inherit a previously confirmed image manifest.
    await expectPaused(mismatched.jobId);
    const wrongManifest = await imageFixture();
    await db
      .update(facebookPublicationManifest)
      .set({ format: "video" })
      .where(eq(facebookPublicationManifest.publicationId, wrongManifest.id));
    await expectPaused(wrongManifest.jobId);
    const wrongPublication = await fixture();
    await db
      .update(schema.socialPublication)
      .set({ accountRef: randomUUID() })
      .where(eq(schema.socialPublication.id, wrongPublication.id));
    await expectPaused(wrongPublication.jobId);
    console.log("PASS missing, stale and mismatched manifests pause claims");

    const foreign = await fixture("text", randomUUID());
    const foreignStale = await fixture("text", randomUUID());
    await db
      .update(schema.socialBrowserJob)
      .set({ status: "claimed", updatedAt: new Date(now.getTime() - 11 * 60_000) })
      .where(eq(schema.socialBrowserJob.id, foreignStale.jobId));
    await assert.rejects(claimNextSocialWorkerJob("wrong-worker", now, database));
    const own = await fixture();
    const results = await Promise.all([claim(), claim()]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(results.find(Boolean)?.command.command.jobId, own.jobId);
    const [untouched] = await db
      .select()
      .from(schema.socialBrowserJob)
      .where(eq(schema.socialBrowserJob.id, foreign.jobId));
    const [unexpired] = await db
      .select()
      .from(schema.socialBrowserJob)
      .where(eq(schema.socialBrowserJob.id, foreignStale.jobId));
    assert.equal(untouched.status, "queued");
    assert.equal(unexpired.status, "claimed");
    console.log("PASS worker/account isolation and concurrent single claim");
    const ownClaim = results.find(Boolean);
    assert.ok(ownClaim);
    await db
      .update(schema.socialBrowserJob)
      .set({ accountRef: randomUUID() })
      .where(eq(schema.socialBrowserJob.id, own.jobId));
    await assert.rejects(
      authorizeFacebookPublication(ownClaim.command, ownClaim.payload, database),
    );
    await db
      .update(schema.socialBrowserJob)
      .set({ accountRef, updatedAt: new Date(now.getTime() - 11 * 60_000) })
      .where(eq(schema.socialBrowserJob.id, own.jobId));
    assert.equal(await claim(), null);
    const [expired] = await db
      .select()
      .from(schema.socialBrowserJob)
      .where(eq(schema.socialBrowserJob.id, own.jobId));
    const [unknown] = await db
      .select()
      .from(schema.socialPublication)
      .where(eq(schema.socialPublication.id, own.id));
    assert.equal(expired.status, "paused");
    assert.equal(unknown.status, "unknown");
    await assert.rejects(
      authorizeFacebookPublication(ownClaim.command, ownClaim.payload, database),
    );
    console.log("PASS authorization checks job scope; own timed-out claim pauses without retry");
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
