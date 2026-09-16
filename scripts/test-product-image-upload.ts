import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { crc32 } from "node:zlib";
import sharp from "sharp";
import { verifyDocumentUploadBytes } from "../lib/product/document-upload-bytes";
import { documentUploadPayloadSchema } from "../lib/product/document-upload-contracts";
import {
  maximumProductImageBytes,
  productImageReceiptIdsSchema,
} from "../lib/product/source-image-contracts";

async function run() {
  const raw = sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } });
  for (const format of ["png", "jpeg"] as const) {
    const bytes = await raw.clone().toFormat(format).toBuffer();
    const payload = {
      receiptId: randomUUID(),
      projectId: randomUUID(),
      purpose: "agent_image",
      originalFilename: `synthetic.${format}`,
      contentType: `image/${format}`,
      sizeBytes: bytes.length,
    };
    assert.equal(documentUploadPayloadSchema.parse(payload).purpose, "agent_image");
    if (format === "png") {
      const animation = Buffer.alloc(20);
      animation.writeUInt32BE(8, 0);
      animation.write("acTL", 4);
      animation.writeUInt32BE(2, 8);
      animation.writeUInt32BE(0, 12);
      animation.writeUInt32BE(crc32(animation.subarray(4, 16)), 16);
      const animated = Buffer.concat([bytes.subarray(0, 33), animation, bytes.subarray(33)]);
      await assert.rejects(
        verifyDocumentUploadBytes(new Blob([animated]).stream(), "animated.png", animated.length),
        /多帧或动画/,
      );
    }

    assert.deepEqual(
      (
        await verifyDocumentUploadBytes(
          new Blob([bytes]).stream(),
          payload.originalFilename,
          bytes.length,
        )
      ).bytes,
      bytes,
    );
    assert.throws(() => documentUploadPayloadSchema.parse({ ...payload, purpose: "agent" }));
    assert.throws(() => documentUploadPayloadSchema.parse({ ...payload, purpose: "evidence" }));
    assert.throws(() =>
      documentUploadPayloadSchema.parse({ ...payload, sizeBytes: maximumProductImageBytes + 1 }),
    );
    assert.throws(() =>
      documentUploadPayloadSchema.parse({ ...payload, originalFilename: "../source.png" }),
    );
    await assert.rejects(
      verifyDocumentUploadBytes(
        new Blob([bytes]).stream(),
        format === "png" ? "wrong.jpg" : "wrong.png",
        bytes.length,
      ),
    );
    const corrupt = bytes.subarray(0, Math.floor(bytes.length / 2));
    await assert.rejects(
      verifyDocumentUploadBytes(
        new Blob([corrupt]).stream(),
        payload.originalFilename,
        corrupt.length,
      ),
    );
  }
  await assert.rejects(
    verifyDocumentUploadBytes(new Blob(["<svg></svg>"]).stream(), "fake.png", 11),
  );
  const ref = randomUUID();
  assert.throws(() => productImageReceiptIdsSchema.parse([ref, ref]));
  assert.throws(() =>
    productImageReceiptIdsSchema.parse(Array.from({ length: 5 }, () => randomUUID())),
  );
  let canceled = false;
  const tooLarge = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(20));
    },
    cancel() {
      canceled = true;
    },
  });
  await assert.rejects(verifyDocumentUploadBytes(tooLarge, "source.png", 10));
  assert.ok(canceled);
  console.log(
    "PASS source image MIME/purpose/byte bounds, full decoding, corruption and receipt limits",
  );
}
void run();
