import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDatabase, getDatabase } from "../lib/db/client";
import { facebookPublicationManifest } from "../lib/db/facebook-runtime-schema";
import * as s from "../lib/db/schema";
import {
  seedPublicationAccessFixture,
  syntheticPublicationBytes,
} from "../tests/fixtures/publication-access";

const connection = process.env.SOCIAL_HUMAN_WRITE_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/f_trade_stream_test"
)
  throw Error("Dedicated synthetic loopback database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";
process.env.SOCIAL_FACEBOOK_WORKER_ENABLED = "1";
globalThis.fetch = async () => {
  throw Error("External delivery forbidden");
};
let blobBarrier: (() => Promise<void>) | undefined;
mock.module("@vercel/blob", {
  exports: {
    get: async () => {
      await blobBarrier?.();
      return {
        statusCode: 200,
        stream: new ReadableStream({
          start(c) {
            c.enqueue(syntheticPublicationBytes);
            c.close();
          },
        }),
      };
    },
  },
});
const {
  submitFacebookMediaPublication,
  listFacebookMediaOptions,
  buildFacebookMediaPayload,
  resolveFacebookMediaSource,
} = await import("../lib/social/facebook-media-store");
const db = getDatabase();
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function fixture(format: "video" | "image" = "video") {
  const f = await seedPublicationAccessFixture(db, format);
  process.env.SOCIAL_FACEBOOK_OWNER_USER_ID = f.actorId;
  process.env.SOCIAL_WORKER_ID = "synthetic-worker";
  process.env.SOCIAL_WORKER_CHANNEL_REF = f.channelRef;
  process.env.SOCIAL_WORKER_ACCOUNT_REF = f.accountRef;
  const captionId = randomUUID(),
    gateId = randomUUID();
  const body = "SYNTHETIC approved caption; no factory claims.";
  await db.insert(s.aggregateRecord).values({
    id: captionId,
    type: "content",
    state: "CONTENT_APPROVED",
    payload: { product_id: f.productId, status: "approved", body },
    createdByType: "human",
    createdById: f.actorId,
  });
  await db.insert(s.workspaceProjectItem).values({
    id: randomUUID(),
    projectId: f.projectId,
    aggregateId: captionId,
    role: "marketing_content",
    relation: "owned",
  });
  await db.insert(s.approval).values({
    id: gateId,
    aggregateId: captionId,
    gate: "gate_01_truth",
    status: "approved",
    requestedByType: "human",
    requestedById: f.actorId,
    requestedAt: new Date(),
    decidedByType: "human",
    decidedById: f.actorId,
    decidedAt: new Date(),
    evidenceRef: f.decisionRef,
  });
  return { ...f, captionId, captionGateId: gateId, body };
}
async function input(f: Fixture) {
  const options = await listFacebookMediaOptions(f.projectId, f.actorId, db, f.contentId);
  const selected = options.find((o) => o.captionContentRef === f.captionId);
  assert.ok(selected, "Approved same-product caption must be offered");
  return {
    ...f.mediaSubmission,
    captionContentRef: f.captionId,
    previewDigest: selected.previewDigest,
  };
}
async function snapshot(f: Fixture) {
  return Promise.all([
    db.select().from(s.socialPublication).where(eq(s.socialPublication.projectId, f.projectId)),
    db.select().from(s.socialBrowserJob).where(eq(s.socialBrowserJob.accountRef, f.accountRef)),
    db.select().from(s.auditEvent).where(eq(s.auditEvent.actorId, f.actorId)),
  ]);
}
async function changeBody(f: Fixture) {
  await db
    .update(s.aggregateRecord)
    .set({
      payload: {
        product_id: f.productId,
        status: "approved",
        body: "SYNTHETIC changed after confirmation",
      },
    })
    .where(eq(s.aggregateRecord.id, f.captionId));
}
async function newGate(f: Fixture, status: "approved" | "pending" = "approved") {
  await db.insert(s.approval).values({
    id: randomUUID(),
    aggregateId: f.captionId,
    gate: "gate_01_truth",
    status,
    requestedByType: "human",
    requestedById: f.actorId,
    requestedAt: new Date(Date.now() + 1000),
    ...(status === "approved"
      ? {
          decidedByType: "human" as const,
          decidedById: f.actorId,
          decidedAt: new Date(),
          evidenceRef: f.decisionRef,
        }
      : {}),
  });
}
let count = 0;
try {
  await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: "drizzle" });
  const f = await fixture(),
    value = await input(f);
  const options = await listFacebookMediaOptions(f.projectId, f.actorId, db, f.contentId);
  assert.equal(options.length, 2);
  assert.equal(
    options.find((o) => !o.captionContentRef)?.previewDigest,
    f.mediaSubmission.previewDigest,
  );
  assert.equal(options.find((o) => o.captionContentRef)?.preview, f.body);
  const result = await submitFacebookMediaPublication(value, f.identity, db);
  const [manifest] = await db
    .select()
    .from(facebookPublicationManifest)
    .where(eq(facebookPublicationManifest.publicationId, result.publicationId));
  assert.equal(manifest.caption, f.body);
  assert.deepEqual(manifest.captionSource, {
    contentRef: f.captionId,
    contentVersion: 1,
    approvalRef: f.captionGateId,
  });
  const [publication] = await db
    .select()
    .from(s.socialPublication)
    .where(eq(s.socialPublication.id, result.publicationId));
  const payload = await db.transaction((tx) =>
    buildFacebookMediaPayload(tx, publication, new Date(), true),
  );
  assert.equal(payload.text, f.body);
  assert.equal(
    (await db.transaction((tx) => resolveFacebookMediaSource(tx, publication, new Date()))).media
      .sha256,
    payload.media.sha256,
  );
  assert.deepEqual(await submitFacebookMediaPublication(value, f.identity, db), result);
  assert.equal((await snapshot(f))[0].length, 1);
  count += 3;
  await assert.rejects(
    submitFacebookMediaPublication(f.mediaSubmission, f.identity, db),
    /existing_caption_changed/,
  );
  assert.equal((await snapshot(f))[0].length, 1);
  count++;

  const mutations: Array<[string, (f: Fixture) => Promise<unknown>]> = [
    [
      "unapproved state",
      (f) =>
        db
          .update(s.aggregateRecord)
          .set({ state: "CONTENT_DRAFT" })
          .where(eq(s.aggregateRecord.id, f.captionId)),
    ],
    [
      "unapproved status",
      (f) =>
        db.execute(
          sql`UPDATE aggregate_record SET payload = jsonb_set(payload, '{status}', '"draft"') WHERE id = ${f.captionId}`,
        ),
    ],
    [
      "wrong product",
      (f) =>
        db.execute(
          sql`UPDATE aggregate_record SET payload = jsonb_set(payload, '{product_id}', ${JSON.stringify(randomUUID())}::jsonb) WHERE id = ${f.captionId}`,
        ),
    ],
    [
      "wrong role",
      (f) =>
        db
          .update(s.workspaceProjectItem)
          .set({ role: "product_source" })
          .where(eq(s.workspaceProjectItem.aggregateId, f.captionId)),
    ],
    [
      "reference only",
      (f) =>
        db
          .update(s.workspaceProjectItem)
          .set({ role: "product_reference", relation: "reference" })
          .where(eq(s.workspaceProjectItem.aggregateId, f.captionId)),
    ],
    [
      "not in project",
      (f) =>
        db
          .delete(s.workspaceProjectItem)
          .where(eq(s.workspaceProjectItem.aggregateId, f.captionId)),
    ],
    [
      "revoked gate",
      (f) =>
        db.update(s.approval).set({ status: "rejected" }).where(eq(s.approval.id, f.captionGateId)),
    ],
    ["new pending gate", (f) => newGate(f, "pending")],
    [
      "blank copy",
      (f) =>
        db.execute(
          sql`UPDATE aggregate_record SET payload = jsonb_set(payload, '{body}', '""') WHERE id = ${f.captionId}`,
        ),
    ],
    ["same-version body change", changeBody],
    [
      "version change",
      (f) =>
        db
          .update(s.aggregateRecord)
          .set({ version: 2 })
          .where(eq(s.aggregateRecord.id, f.captionId)),
    ],
    ["new approval", (f) => newGate(f)],
  ];
  for (const [name, mutate] of mutations) {
    const f = await fixture(),
      value = await input(f),
      before = await snapshot(f);
    await mutate(f);
    await assert.rejects(
      submitFacebookMediaPublication(value, f.identity, db),
      /video_caption_not_approved|media_changed_since_preview/,
      name,
    );
    assert.deepEqual(await snapshot(f), before, `${name} must leave no publication/job/audit`);
    count++;
  }
  for (const mutate of [changeBody, (f: Fixture) => newGate(f, "pending")]) {
    const f = await fixture(),
      value = await input(f),
      before = await snapshot(f);
    blobBarrier = async () => {
      await mutate(f);
    };
    try {
      await assert.rejects(
        submitFacebookMediaPublication(value, f.identity, db),
        /video_caption_not_approved|media_changed_since_preview/,
      );
    } finally {
      blobBarrier = undefined;
    }
    assert.deepEqual(await snapshot(f), before, "Change during media read must roll back");
    count++;
  }
  for (const mutate of [
    changeBody,
    (f: Fixture) => newGate(f, "pending"),
    (f: Fixture) => newGate(f),
  ]) {
    const f = await fixture(),
      value = await input(f);
    const saved = await submitFacebookMediaPublication(value, f.identity, db);
    const [publication] = await db
      .select()
      .from(s.socialPublication)
      .where(eq(s.socialPublication.id, saved.publicationId));
    await mutate(f);
    await assert.rejects(
      db.transaction((tx) => buildFacebookMediaPayload(tx, publication, new Date(), true)),
      /video_caption_not_approved|media_manifest_stale/,
    );
    count++;
  }
  {
    const f = await fixture("image");
    await assert.rejects(
      submitFacebookMediaPublication(
        { ...f.mediaSubmission, captionContentRef: f.captionId },
        f.identity,
        db,
      ),
      /image_caption_source_invalid/,
    );
    const saved = await submitFacebookMediaPublication(f.mediaSubmission, f.identity, db);
    assert.deepEqual(
      await submitFacebookMediaPublication(f.mediaSubmission, f.identity, db),
      saved,
    );
    count++;
  }
  {
    const f = await fixture();
    const saved = await submitFacebookMediaPublication(f.mediaSubmission, f.identity, db);
    const [manifest] = await db
      .select()
      .from(facebookPublicationManifest)
      .where(eq(facebookPublicationManifest.publicationId, saved.publicationId));
    assert.equal(manifest.caption, "");
    assert.equal(manifest.captionSource, null);
    count++;
  }
  console.log(
    `PASS ${count} migrated PostgreSQL video caption cases: approval, ownership, preview drift, read races, durable source, dispatch revocation, idempotency and legacy compatibility; no external delivery`,
  );
} finally {
  await closeDatabase();
}
