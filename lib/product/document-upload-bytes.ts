import { createHash } from "node:crypto";
import sharp from "sharp";
import { documentContentType, maximumProductDocumentBytes } from "./document-upload-contracts";
import { ProductUploadError } from "./intake-errors";
import {
  maximumProductImageBytes,
  productImageContentType,
  productImageFilenameSchema,
} from "./source-image-contracts";

/** Enforce the bound while reading, including dishonest or absent Blob metadata. */
export async function verifyDocumentUploadBytes(
  stream: ReadableStream<Uint8Array>,
  filename: string,
  expectedSize: number,
) {
  if (
    !Number.isInteger(expectedSize) ||
    expectedSize < 1 ||
    expectedSize > maximumProductDocumentBytes
  )
    throw new ProductUploadError("upload_size_mismatch");
  const isImage = productImageFilenameSchema.safeParse(filename).success;
  if (isImage && expectedSize > maximumProductImageBytes)
    throw new ProductUploadError("upload_size_mismatch");
  const contentType = isImage ? productImageContentType(filename) : documentContentType(filename);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > expectedSize) throw new ProductUploadError("upload_size_mismatch");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (length !== expectedSize) throw new ProductUploadError("upload_size_mismatch");
  const bytes = Buffer.concat(chunks, length);
  const prefix = bytes.subarray(0, 8);
  let valid = false;
  if (isImage) {
    const imageSignatureMatches =
      contentType === "image/png"
        ? prefix.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        : prefix.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    // Reject disguised SVG and other formats before libvips selects a decoder.
    if (!imageSignatureMatches) throw new ProductUploadError("upload_type_mismatch");
    if (contentType === "image/png") {
      // libvips can decode an APNG's default frame without reporting all frames.
      // Reject the animation control chunk before accepting the original container.
      for (let offset = 8; offset + 12 <= bytes.length; ) {
        if (bytes.toString("ascii", offset + 4, offset + 8) === "acTL")
          throw new ProductUploadError("upload_image_animated");
        offset += bytes.readUInt32BE(offset) + 12;
      }
    }
    const expectedFormat = contentType === "image/png" ? "png" : "jpeg";
    try {
      const decoder = sharp(bytes, { limitInputPixels: 25_000_000, failOn: "warning" });
      const metadata = await decoder.metadata();
      if (metadata.format !== expectedFormat) throw new ProductUploadError("upload_type_mismatch");
      if ((metadata.pages ?? 1) !== 1) throw new ProductUploadError("upload_image_animated");
      // Decode every pixel to reject truncated/corrupt files, but preserve the original bytes.
      await decoder.stats();
    } catch (error) {
      if (error instanceof ProductUploadError) throw error;
      throw new ProductUploadError("upload_image_invalid");
    }
    valid = true;
  } else if (contentType === "application/pdf")
    valid = prefix.subarray(0, 5).toString() === "%PDF-";
  else if (contentType === "application/vnd.ms-excel")
    valid = prefix.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  else if (contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    valid =
      prefix.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4])) &&
      bytes.includes(Buffer.from("[Content_Types].xml")) &&
      bytes.includes(Buffer.from("xl/workbook.xml"));
  else {
    // CSV has no magic bytes: require textual UTF-8, and reject binary/disguised documents.
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      valid =
        !bytes.some((byte) => byte < 32 && ![9, 10, 13].includes(byte)) &&
        !/^\s*(?:%PDF-|<\?xml|<!doctype|<html)/i.test(text);
    } catch {
      valid = false;
    }
  }
  if (!valid) throw new ProductUploadError("upload_type_mismatch");
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: length };
}
