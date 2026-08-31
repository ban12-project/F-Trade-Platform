import { z } from "zod";

import { videoProjectSchema, type VideoProject } from "./contracts";

const privateAssetRef = z.string().trim().regex(/^asset-[a-z0-9][a-z0-9_-]{2,120}$/i, "必须是脱敏的私有素材引用。");

const narrationSchema = z.object({
  text: z.string().trim().min(1).max(500),
  claimRefs: z.array(z.string().trim().min(1)).max(24),
}).strict();

export const marketingTimelineInputSchema = z.object({
  sceneAssets: z.record(z.string().trim().min(1), privateAssetRef),
  narration: z.record(z.string().trim().min(1), narrationSchema).default({}),
  soundtrackAssetRef: privateAssetRef.optional(),
}).strict();

export type MarketingTimelineInput = z.infer<typeof marketingTimelineInputSchema>;

export type MarketingTimeline = {
  durationSeconds: number;
  soundtrackAssetRef?: string;
  scenes: Array<{
    sceneId: string;
    assetRef: string;
    startSeconds: number;
    durationSeconds: number;
    prompt: string;
    claimRefs: string[];
    narration?: { text: string; claimRefs: string[]; startSeconds: number; durationSeconds: number };
    subtitles: Array<{ text: string; startSeconds: number; endSeconds: number; claimRefs: string[] }>;
  }>;
};

/**
 * Converts approved scene-level assets into a deterministic editing plan.
 * It deliberately never creates media or marketing claims: narration and
 * subtitles are explicit review inputs bound to the project's fact paths.
 */
export function createMarketingTimeline(projectInput: VideoProject, input: z.input<typeof marketingTimelineInputSchema>): MarketingTimeline {
  const project = videoProjectSchema.parse(projectInput);
  if (project.status !== "approved" || !project.approvalRefs.length) {
    throw new Error("只有通过人工审核的视频项目才能进入渲染时间线。");
  }
  const value = marketingTimelineInputSchema.parse(input);
  const permittedClaims = new Set(project.factualClaims.map((claim) => claim.field));
  let startSeconds = 0;

  const scenes = project.scenes.map((scene) => {
    const assetRef = value.sceneAssets[scene.sceneId];
    if (!assetRef) throw new Error(`镜头 ${scene.sceneId} 缺少已生成或已授权的视频素材。`);
    const narration = value.narration[scene.sceneId];
    if (narration && !narration.claimRefs.every((claimRef) => permittedClaims.has(claimRef))) {
      throw new Error(`镜头 ${scene.sceneId} 的旁白引用了未绑定证据的产品字段。`);
    }
    const sceneStart = startSeconds;
    startSeconds += scene.durationSeconds;
    const timedNarration = narration ? { ...narration, startSeconds: sceneStart, durationSeconds: scene.durationSeconds } : undefined;
    return {
      sceneId: scene.sceneId,
      assetRef,
      startSeconds: sceneStart,
      durationSeconds: scene.durationSeconds,
      prompt: scene.prompt,
      claimRefs: scene.claimRefs,
      ...(timedNarration ? { narration: timedNarration, subtitles: [{ text: timedNarration.text, startSeconds: sceneStart, endSeconds: startSeconds, claimRefs: timedNarration.claimRefs }] } : { subtitles: [] }),
    };
  });

  return { durationSeconds: startSeconds, ...(value.soundtrackAssetRef ? { soundtrackAssetRef: value.soundtrackAssetRef } : {}), scenes };
}
