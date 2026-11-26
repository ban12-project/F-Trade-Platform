import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mock } from "node:test";

const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const sha256 = createHash("sha256").update(bytes).digest("hex");

let nextGetResult: {
  statusCode: number;
  stream: ReadableStream<Uint8Array>;
  blob: { contentType: string; size: number };
};

mock.module("@vercel/blob", {
  exports: {
    get: async () => nextGetResult,
  },
});

const { openFacebookMediaSource } = await import("../lib/social/facebook-media-store");
const unusedDb = {
  select() {
    throw new Error("unexpected_db_query");
  },
} as unknown as Parameters<typeof openFacebookMediaSource>[1];

async function main() {
  let cancelledReason: unknown = null;
  const rawStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
    cancel(reason) {
      cancelledReason = reason;
    },
  });
  nextGetResult = {
    statusCode: 200,
    stream: rawStream,
    blob: { contentType: "video/mp4", size: bytes.byteLength },
  };
  const opened = await openFacebookMediaSource(
    {
      blobKey: "video/rendered/mvp1/synthetic.mp4",
      media: {
        assetRef: "asset-synthetic",
        contentType: "video/mp4",
        sizeBytes: bytes.byteLength,
        sha256,
      },
    },
    unusedDb,
  );
  assert.notEqual(opened.stream, rawStream, "must wrap @vercel/blob stream before Response()");
  const response = new Response(opened.stream, {
    headers: { "Content-Type": opened.media.contentType },
  });
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [...bytes]);
  assert.equal(cancelledReason, null);

  let cancelCount = 0;
  const cancellableRaw = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(bytes);
    },
    cancel(reason) {
      cancelCount++;
      cancelledReason = reason;
    },
  });
  nextGetResult = {
    statusCode: 200,
    stream: cancellableRaw,
    blob: { contentType: "video/mp4", size: bytes.byteLength },
  };
  const openedForCancel = await openFacebookMediaSource(
    {
      blobKey: "video/rendered/mvp1/synthetic.mp4",
      media: {
        assetRef: "asset-synthetic",
        contentType: "video/mp4",
        sizeBytes: bytes.byteLength,
        sha256,
      },
    },
    unusedDb,
  );
  const cancelResponse = new Response(openedForCancel.stream);
  await cancelResponse.body?.cancel("client-abort");
  assert.equal(cancelCount, 1);
  assert.equal(cancelledReason, "client-abort");

  let mismatchCancelled = false;
  nextGetResult = {
    statusCode: 200,
    stream: new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(bytes);
      },
      cancel() {
        mismatchCancelled = true;
      },
    }),
    blob: { contentType: "video/mp4", size: bytes.byteLength + 1 },
  };
  await assert.rejects(
    openFacebookMediaSource(
      {
        blobKey: "video/rendered/mvp1/synthetic.mp4",
        media: {
          assetRef: "asset-synthetic",
          contentType: "video/mp4",
          sizeBytes: bytes.byteLength,
          sha256,
        },
      },
      unusedDb,
    ),
    /media_unavailable/,
  );
  assert.equal(mismatchCancelled, true);

  console.log("PASS openFacebookMediaSource wraps blob stream and propagates cancellation");
}

void main();
