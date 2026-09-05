import "server-only";

import { and, eq } from "drizzle-orm";

import { type Database, getDatabase } from "@/lib/db/client";
import { aggregateRecord } from "@/lib/db/schema";

import type { VideoProject } from "./contracts";
import { assertCurrentProductFacts } from "./product-fact-runtime-policy";

export async function assertCurrentProductFactsForVideo(
  project: VideoProject,
  database: Database = getDatabase(),
) {
  const [product] = await database
    .select({ state: aggregateRecord.state, payload: aggregateRecord.payload })
    .from(aggregateRecord)
    .where(and(eq(aggregateRecord.id, project.productId), eq(aggregateRecord.type, "product")))
    .limit(1);
  if (!product || product.state !== "PRODUCT_READY") {
    throw new Error("视频引用的产品已不再处于 ProductReady，不能继续处理。");
  }
  return assertCurrentProductFacts(project, product.payload);
}
