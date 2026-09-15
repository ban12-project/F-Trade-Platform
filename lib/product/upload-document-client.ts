"use client";

import { uploadPresigned } from "@vercel/blob/client";
import {
  type DocumentUploadPayload,
  documentContentType,
  documentUploadPath,
  documentUploadPayloadSchema,
} from "./document-upload-contracts";

export async function uploadProductDocument(
  file: File,
  projectId: string,
  purpose: DocumentUploadPayload["purpose"],
) {
  const payload = documentUploadPayloadSchema.parse({
    receiptId: crypto.randomUUID(),
    projectId,
    purpose,
    originalFilename: file.name,
    contentType: documentContentType(file.name),
    sizeBytes: file.size,
  });
  await uploadPresigned(documentUploadPath(payload), file, {
    access: "private",
    contentType: payload.contentType,
    handleUploadUrl: "/api/product-documents/upload",
    clientPayload: JSON.stringify(payload),
  });
  return payload.receiptId;
}
