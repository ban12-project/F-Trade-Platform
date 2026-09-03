import { z } from "zod";

import { videoProjectSchema, type VideoProject } from "./contracts";
import { marketingVideoDraftSchema, type MarketingVideoDraft } from "./edit-contracts";

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
    mediaType?: "image" | "video";
    trimStartSeconds?: number;
    fitMode?: "contain" | "cover";
    audioMode?: "muted" | "source";
    startSeconds: number;
    durationSeconds: number;
    prompt: string;
    claimRefs: string[];
    narration?: { text: string; claimRefs: string[]; startSeconds: number; durationSeconds: number };
    subtitles: Array<{ text: string; startSeconds: number; endSeconds: number; claimRefs: string[] }>;
  }>;
  cta?: { text: string; startSeconds: number; endSeconds: number };
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

/** Builds the deterministic MVP1 edit timeline before any external media work begins. */
export function createMarketingEditTimeline(projectInput: VideoProject, draftInput: MarketingVideoDraft): MarketingTimeline {
  const project = videoProjectSchema.parse(projectInput);
  const draft = marketingVideoDraftSchema.parse(draftInput);
  const sourceAssets = new Map(project.sourceAssets.map((asset) => [asset.assetRef, asset]));
  const claimsByField = new Map(project.factualClaims.map((claim) => [claim.field, claim]));
  let startSeconds = 0;
  const scenes = draft.clips.map((clip) => {
    const source = sourceAssets.get(clip.assetRef);
    if (!source || source.mediaType !== clip.mediaType) throw new Error(`片段 ${clip.clipId} 引用了未授权或类型不匹配的素材。`);
    const verifiedClaim = clip.caption.kind === "verified_fact" ? claimsByField.get(clip.caption.claimRef) : undefined;
    if (clip.caption.kind === "verified_fact" && !verifiedClaim) throw new Error(`片段 ${clip.clipId} 的字幕引用了未绑定证据的产品字段。`);
    const caption = clip.caption.kind === "none"
      ? undefined
      : clip.caption.kind === "creative"
        ? { text: clip.caption.text, claimRefs: [] as string[] }
        : { text: verifiedClaim!.value, claimRefs: [verifiedClaim!.field] };
    const durationSeconds = clip.durationMs / 1_000;
    const sceneStart = startSeconds;
    startSeconds += durationSeconds;
    return {
      sceneId: clip.clipId,
      assetRef: clip.assetRef,
      mediaType: clip.mediaType,
      trimStartSeconds: clip.trimStartMs / 1_000,
      fitMode: clip.fitMode,
      audioMode: clip.audioMode,
      startSeconds: sceneStart,
      durationSeconds,
      prompt: "用户授权素材剪辑",
      claimRefs: caption?.claimRefs ?? [],
      subtitles: caption ? [{ ...caption, startSeconds: sceneStart, endSeconds: startSeconds }] : [],
    };
  });
  const cta = draft.ctaText ? { text: draft.ctaText, startSeconds: Math.max(0, startSeconds - 2), endSeconds: startSeconds } : undefined;
  return { durationSeconds: startSeconds, scenes, ...(cta ? { cta } : {}) };
}
