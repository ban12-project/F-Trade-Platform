import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { DatabaseExecutor, DatabaseTransaction } from "@/lib/db/client";
import { evidence, productDocumentUploadReceipt, productSourceImage } from "@/lib/db/schema";
import { maximumProductImages } from "./source-image-contracts";

export async function insertProductSourceImages(
  tx: DatabaseTransaction,
  productId: string,
  projectId: string | undefined,
  actorId: string,
  refs: readonly string[],
) {
  if (!refs.length) return;
  if (!projectId || refs.length > maximumProductImages || new Set(refs).size !== refs.length)
    throw new Error("产品图片关联无效。");
  const rows = await tx
    .select({ evidenceId: evidence.id })
    .from(productDocumentUploadReceipt)
    .innerJoin(evidence, eq(evidence.id, productDocumentUploadReceipt.evidenceId))
    .where(
      and(
        eq(productDocumentUploadReceipt.projectId, projectId),
        eq(productDocumentUploadReceipt.ownerId, actorId),
        eq(productDocumentUploadReceipt.purpose, "agent_image"),
        inArray(evidence.id, [...refs]),
        inArray(evidence.contentType, ["image/png", "image/jpeg"]),
      ),
    );
  if (new Set(rows.map((row) => row.evidenceId)).size !== refs.length)
    throw new Error("产品图片未完成当前项目的私有上传核验。");
  await tx
    .insert(productSourceImage)
    .values(refs.map((evidenceId) => ({ id: randomUUID(), productId, projectId, evidenceId })));
}

export async function listProductSourceImages(productId: string, database: DatabaseExecutor) {
  return database
    .select({ evidenceId: productSourceImage.evidenceId })
    .from(productSourceImage)
    .where(eq(productSourceImage.productId, productId))
    .orderBy(productSourceImage.evidenceId);
}
