"use client";

import { uploadPresigned } from "@vercel/blob/client";
import {
  type DocumentUploadPayload,
  documentContentType,
  documentUploadPath,
  documentUploadPayloadSchema,
} from "./document-upload-contracts";
import { productImageContentType } from "./source-image-contracts";

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
    contentType:
      purpose === "agent_image"
        ? productImageContentType(file.name)
        : documentContentType(file.name),
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
