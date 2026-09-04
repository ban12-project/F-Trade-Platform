import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { type Database, getDatabase } from "@/lib/db/client";
import { productMediaAsset } from "@/lib/db/product-media-schema";
import { aggregateRecord } from "@/lib/db/schema";

import { videoProjectSchema } from "./contracts";
import {
  assertCurrentProductMediaUsage,
  type ProductMediaRuntimeUsage,
  productMediaIdsForVideoProject,
  productMediaRuntimeRecordFromRow,
} from "./product-media-runtime-policy";

/**
 * Loads and validates current ProductReady/ProductMedia state for workflow
 * steps that run outside a larger transaction.
 */
export async function assertCurrentProductMediaUsageForVideo(
  projectInput: unknown,
  usage: ProductMediaRuntimeUsage = "organic",
  evaluatedAt = new Date(),
  database: Database = getDatabase(),
) {
  const project = videoProjectSchema.parse(projectInput);
  const mediaIds = productMediaIdsForVideoProject(project);
  if (!mediaIds.length) return [];

  const [productRows, mediaRows] = await Promise.all([
    database
      .select({ id: aggregateRecord.id, state: aggregateRecord.state })
      .from(aggregateRecord)
      .where(and(eq(aggregateRecord.id, project.productId), eq(aggregateRecord.type, "product")))
      .limit(1),
    database.select().from(productMediaAsset).where(inArray(productMediaAsset.id, mediaIds)),
  ]);
  const product = productRows[0];
  if (!product || product.state !== "PRODUCT_READY") {
    throw new Error("视频引用的产品已不再处于 ProductReady，不能继续处理。");
  }

  return assertCurrentProductMediaUsage(
    project,
    mediaRows.map(productMediaRuntimeRecordFromRow),
    usage,
    evaluatedAt,
  );
}
