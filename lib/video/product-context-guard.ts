import { and, eq, inArray } from "drizzle-orm";
import type { DatabaseTransaction } from "@/lib/db/client";
import { productMediaAsset } from "@/lib/db/product-media-schema";
import { aggregateRecord } from "@/lib/db/schema";
import type { VideoProject } from "./contracts";
import { assertCurrentProductFacts } from "./product-fact-runtime-policy";
import {
  assertCurrentProductMediaUsage,
  productMediaIdsForVideoProject,
  productMediaRuntimeRecordFromRow,
} from "./product-media-runtime-policy";

/** Caller holds the video lock; keep its current product and media valid until commit. */
export async function assertLockedVideoProductContext(
  tx: DatabaseTransaction,
  project: VideoProject,
) {
  const [product] = await tx
    .select({
      id: aggregateRecord.id,
      state: aggregateRecord.state,
      payload: aggregateRecord.payload,
    })
    .from(aggregateRecord)
    .where(and(eq(aggregateRecord.id, project.productId), eq(aggregateRecord.type, "product")))
    .for("update");
  if (product?.state !== "PRODUCT_READY")
    throw new Error("视频引用的产品已不再处于 ProductReady，不能继续处理。");
  assertCurrentProductFacts(project, product.payload);
  const mediaIds = productMediaIdsForVideoProject(project);
  if (!mediaIds.length) return;
  const mediaRows = await tx
    .select()
    .from(productMediaAsset)
    .where(inArray(productMediaAsset.id, mediaIds))
    .for("update");
  // A grant may expire while this transaction waits for a row lock.
  assertCurrentProductMediaUsage(
    project,
    mediaRows.map(productMediaRuntimeRecordFromRow),
    "organic",
    new Date(),
  );
}
