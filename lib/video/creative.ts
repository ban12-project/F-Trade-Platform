import { randomUUID } from "node:crypto";

import type { ProductReady } from "@/lib/product/verification";
import { videoProjectSchema, type VideoProject } from "./contracts";

export type VideoCreativeInput = {
  productId: string;
  objective: string;
  targetAudience: string;
  factPaths: string[];
  sourceAssets: VideoProject["sourceAssets"];
  platforms: VideoProject["platforms"];
  scenes: Array<Pick<VideoProject["scenes"][number], "prompt" | "durationSeconds" | "claimRefs" | "assetRefs">>;
};

function valueAt(product: ProductReady, path: string) {
  const [section, field] = path.split(".");
  const value = product[section as "product" | "specifications" | "commercial"]?.[field];
  if (value === undefined || value === null || value === "") return undefined;
  return Array.isArray(value) ? value.join(", ") : String(value);
}

/** Builds a review-only creative plan; prompts can cite only selected ProductReady facts. */
export function buildVideoCreative(input: VideoCreativeInput, product: ProductReady, id = randomUUID()): VideoProject {
  if (product.verification_status !== "verified" || product.record_id !== input.productId) {
    throw new Error("只能从匹配的 ProductReady 记录创建视频创作计划。");
  }
  const factualClaims = input.factPaths.map((field) => {
    const value = valueAt(product, field);
    const evidenceRef = product.field_evidence[field];
    if (!value || !evidenceRef || !product.evidence_refs.includes(evidenceRef)) {
      throw new Error(`所选字段没有有效的 ProductReady 证据：${field}`);
    }
    return { field, value, evidenceRef };
  });
  if (!factualClaims.length) throw new Error("视频创作计划至少需要一条已核验事实。");
  return videoProjectSchema.parse({
    id,
    productId: product.record_id,
    status: "ready_for_generation",
    objective: input.objective,
    targetAudience: input.targetAudience,
    platforms: input.platforms,
    factualClaims,
    sourceAssets: input.sourceAssets,
    scenes: input.scenes.map((scene, index) => ({ ...scene, sceneId: `scene-${String(index + 1).padStart(3, "0")}` })),
    approvalRefs: [],
  });
}
