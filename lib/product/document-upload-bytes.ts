import { createHash } from "node:crypto";
import sharp from "sharp";
import { documentContentType, maximumProductDocumentBytes } from "./document-upload-contracts";
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
    throw new Error("文件大小超出限制。");
  const isImage = productImageFilenameSchema.safeParse(filename).success;
  if (isImage && expectedSize > maximumProductImageBytes) throw new Error("图片超过 5 MiB 限制。");
  const contentType = isImage ? productImageContentType(filename) : documentContentType(filename);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > expectedSize) throw new Error("文件大小与上传回执不一致。");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (length !== expectedSize) throw new Error("文件大小与上传回执不一致。");
  const bytes = Buffer.concat(chunks, length);
  const prefix = bytes.subarray(0, 8);
  let valid = false;
  if (isImage) {
    const expectedFormat = contentType === "image/png" ? "png" : "jpeg";
    const decoder = sharp(bytes, { limitInputPixels: 25_000_000, failOn: "warning" });
    const metadata = await decoder.metadata();
    if (metadata.format !== expectedFormat || (metadata.pages ?? 1) !== 1)
      throw new Error("图片类型不匹配或包含多帧。");
    // Decode every pixel to reject truncated/corrupt files, but preserve the original bytes.
    await decoder.stats();
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
  if (!valid) throw new Error("文件内容与声明的文档类型不一致。");
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: length };
}
