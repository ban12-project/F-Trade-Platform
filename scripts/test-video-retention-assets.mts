import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDatabase, getDatabase } from "../lib/db/client";
import * as schema from "../lib/db/schema";
import { VideoRetentionError, videoRetentionMilliseconds } from "../lib/video/retention-policy";
import { seedVideoReviewFixture } from "../tests/fixtures/video-review";

const connection = process.env.VIDEO_RETENTION_TEST_DATABASE_URL;
if (
  !connection ||
  new URL(connection).hostname !== "127.0.0.1" ||
  new URL(connection).pathname !== "/f_trade_stream_test"
)
  throw new Error("Dedicated synthetic loopback database required");
process.env.DATABASE_URL = connection;
process.env.DATABASE_TRANSPORT = "postgres";
globalThis.fetch = async () => {
  throw new Error("Outbound forbidden in synthetic asset tests");
};
const paths = new Set<string>();
let wait = 0,
  cancelCount = 0,
  reads = 0,
  puts = 0;
mock.module("@vercel/blob", {
  exports: {
    put: async (path: string, _body: Blob, options: Record<string, unknown>) => {
      assert.equal(options.access, "private");
      assert.equal(options.allowOverwrite, false);
      puts++;
      paths.add(path);
      if (wait) await delay(wait);
      return { pathname: path };
    },
    get: async (path: string) => {
      reads++;
      if (!paths.has(path)) return null;
      return {
        statusCode: 200,
        stream: new ReadableStream({
          cancel: () => {
            cancelCount++;
          },
        }),
        blob: { contentType: "video/mp4", etag: '"synthetic"' },
        headers: new Headers({ "content-length": "3" }),
      };
    },
  },
});
const { VercelPrivateVideoAssetStore } = await import("../lib/video/private-asset-store");
const db = getDatabase();
try {
  await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: "./drizzle" });
  const store = new VercelPrivateVideoAssetStore(db),
    f = await seedVideoReviewFixture(db);
  const ref = `asset-synthetic-${randomUUID()}`;
  const input = {
    assetRef: ref,
    videoProjectId: f.videoId,
    data: new Uint8Array([1, 2, 3]),
    contentType: "video/mp4" as const,
  };
  assert.equal(await store.putRenderedVideo(input), ref);
  const [saved] = await db
    .select()
    .from(schema.videoGeneratedAsset)
    .where(eq(schema.videoGeneratedAsset.assetRef, ref));
  assert.equal(saved.videoProjectId, f.videoId);
  assert.equal(await store.putRenderedVideo(input), ref);
  assert.equal(puts, 1);
  assert.equal(cancelCount, 1);
  assert.equal(
    (
      await db
        .select()
        .from(schema.videoGeneratedAsset)
        .where(eq(schema.videoGeneratedAsset.assetRef, ref))
    )[0].createdAt.getTime(),
    saved.createdAt.getTime(),
  );
  const other = await seedVideoReviewFixture(db);
  await assert.rejects(
    store.putRenderedVideo({ ...input, videoProjectId: other.videoId }),
    /已绑定其他结果/,
  );
  assert.equal(puts, 1);
  await db
    .update(schema.videoGeneratedAsset)
    .set({ createdAt: new Date(Date.now() - videoRetentionMilliseconds - 1000) })
    .where(eq(schema.videoGeneratedAsset.assetRef, ref));
  const readsBefore = reads;
  assert.equal(await store.getGeneratedVideo(ref), null);
  assert.equal(reads, readsBefore);
  await assert.rejects(store.putRenderedVideo(input), VideoRetentionError);
  assert.equal(puts, 1);

  // Upload crosses the owner's cutoff: reject completion while retaining the pre-upload cleanup anchor.
  const crossing = await seedVideoReviewFixture(db),
    crossingRef = `asset-synthetic-${randomUUID()}`;
  await db
    .update(schema.aggregateRecord)
    .set({ createdAt: new Date(Date.now() - videoRetentionMilliseconds + 500) })
    .where(eq(schema.aggregateRecord.id, crossing.videoId));
  wait = 650;
  await assert.rejects(
    store.putRenderedVideo({ ...input, assetRef: crossingRef, videoProjectId: crossing.videoId }),
    VideoRetentionError,
  );
  const [tracked] = await db
    .select()
    .from(schema.videoGeneratedAsset)
    .where(eq(schema.videoGeneratedAsset.assetRef, crossingRef));
  assert(
    tracked && paths.has(tracked.blobPath),
    "Lost or rejected upload remains tracked for cleanup",
  );
  const readsAfter = reads;
  assert.equal(await store.getGeneratedVideo(crossingRef), null);
  assert.equal(reads, readsAfter);
  console.log(
    "PASS private asset cutoff, immutable retry, owner binding and tracked upload crossing; no external I/O",
  );
} finally {
  await closeDatabase();
  mock.restoreAll();
}
