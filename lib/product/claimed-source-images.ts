import "server-only";
import { inArray } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { evidence } from "@/lib/db/schema";
import type { ProductAgentSource } from "./agent";
import { claimDocumentUpload } from "./document-upload-receipts";
import { productImageContentType, productImageReceiptIdsSchema } from "./source-image-contracts";

export async function attachClaimedProductImages(
  source: ProductAgentSource,
  receiptIds: unknown[],
  projectId: string | undefined,
  actorId: string,
): Promise<ProductAgentSource> {
  const ids = productImageReceiptIdsSchema.parse(receiptIds);
  const baseEvidence = await getDatabase()
    .select({ contentType: evidence.contentType })
    .from(evidence)
    .where(inArray(evidence.id, source.evidence_refs));
  if (baseEvidence.some((row) => row.contentType.startsWith("image/")))
    throw new Error("图片不能作为产品字段的文字来源证据。");
  if (!ids.length) return source;
  if (!projectId) throw new Error("产品图片必须绑定项目。");
  const imageInputs: NonNullable<ProductAgentSource["image_inputs"]> = [];
  for (const receiptId of ids) {
    const claimed = await claimDocumentUpload(
      { receiptId, projectId, purpose: "agent_image" },
      actorId,
    );
    imageInputs.push({
      ref: claimed.evidenceId,
      media_type: productImageContentType(claimed.filename),
      data_base64: claimed.bytes.toString("base64"),
    });
  }
  return {
    ...source,
    image_availability: "real_product_image",
    image_refs: imageInputs.map((image) => image.ref),
    image_inputs: imageInputs,
  };
}
