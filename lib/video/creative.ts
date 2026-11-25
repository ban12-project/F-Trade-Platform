import { randomUUID } from "node:crypto";

import type { ProductReady } from "@/lib/product/verification";
import { type VideoProject, videoProjectSchema } from "./contracts";
import { currentVerifiedVideoFact } from "./product-fact-runtime-policy";

export type VideoCreativeInput = {
  productId: string;
  objective: string;
  targetAudience: string;
  creativeObjective?: VideoProject["creativeObjective"];
  pacingMode?: VideoProject["pacingMode"];
  factPaths: string[];
  sourceAssets: VideoProject["sourceAssets"];
  platforms: VideoProject["platforms"];
  scenes: Array<
    Pick<VideoProject["scenes"][number], "prompt" | "durationSeconds" | "claimRefs" | "assetRefs"> &
      Partial<Pick<VideoProject["scenes"][number], "abcdRoles" | "framing" | "visualContrast">>
  >;
};

/** Builds a review-only creative plan; prompts can cite only selected ProductReady facts. */
export function buildVideoCreative(
  input: VideoCreativeInput,
  product: ProductReady,
  id = randomUUID(),
): VideoProject {
  if (product.verification_status !== "verified" || product.record_id !== input.productId) {
    throw new Error("只能从匹配的 ProductReady 记录创建视频创作计划。");
  }
  const factualClaims = input.factPaths.map((field) => currentVerifiedVideoFact(product, field));
  if (!factualClaims.length) throw new Error("视频创作计划至少需要一条已核验事实。");
  return videoProjectSchema.parse({
    id,
    productId: product.record_id,
    status: "ready_for_generation",
    objective: input.objective,
    targetAudience: input.targetAudience,
    ...(input.creativeObjective ? { creativeObjective: input.creativeObjective } : {}),
    ...(input.pacingMode ? { pacingMode: input.pacingMode } : {}),
    platforms: input.platforms,
    factualClaims,
    sourceAssets: input.sourceAssets,
    scenes: input.scenes.map((scene, index) => ({
      prompt: scene.prompt,
      durationSeconds: scene.durationSeconds,
      claimRefs: scene.claimRefs,
      assetRefs: scene.assetRefs,
      ...(scene.abcdRoles ? { abcdRoles: scene.abcdRoles } : {}),
      ...(scene.framing ? { framing: scene.framing } : {}),
      ...(scene.visualContrast ? { visualContrast: scene.visualContrast } : {}),
      sceneId: `scene-${String(index + 1).padStart(3, "0")}`,
    })),
    approvalRefs: [],
  });
}
