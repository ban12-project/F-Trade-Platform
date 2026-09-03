import { z } from "zod";

import { marketingVideoAiDraftSchema, marketingVideoDraftSchema, type MarketingVideoAiDraft, type MarketingVideoDraft } from "./edit-contracts";

const privateAssetRef = z.string().trim().regex(/^(?:asset|evidence)-[a-z0-9][a-z0-9_-]{2,120}$/i);

export const marketingShotCandidateSchema = z.object({
  id: z.string().trim().regex(/^shot-[0-9]{3}-[0-9]{3}$/),
  assetRef: privateAssetRef,
  mediaType: z.enum(["image", "video"]),
  trimStartMs: z.number().int().min(0),
  maximumDurationMs: z.number().int().min(1_000).max(10_000),
}).strict().superRefine((candidate, context) => {
  if (candidate.mediaType === "image" && candidate.trimStartMs !== 0) {
    context.addIssue({ code: "custom", path: ["trimStartMs"], message: "图片候选镜头必须从 0ms 开始。" });
  }
});

export type MarketingShotCandidate = z.infer<typeof marketingShotCandidateSchema>;

export function videoShotCandidateStarts(durationMs: number) {
  if (!Number.isInteger(durationMs) || durationMs < 1_000) throw new Error("源视频不足 1 秒，不能生成候选镜头。");
  const latestStartMs = durationMs - 1_000;
  return [...new Set([0.2, 0.5, 0.8].map((position) => Math.min(Math.round(durationMs * position), latestStartMs)))];
}

export function createMarketingShotCandidate(input: {
  sourceIndex: number;
  candidateIndex: number;
  assetRef: string;
  mediaType: "image" | "video";
  trimStartMs: number;
  sourceDurationMs?: number;
}) {
  if (input.mediaType === "video" && (!Number.isInteger(input.sourceDurationMs) || input.sourceDurationMs! - input.trimStartMs < 1_000)) {
    throw new Error("视频候选镜头必须保留至少 1 秒可用源素材。");
  }
  return marketingShotCandidateSchema.parse({
    id: `shot-${String(input.sourceIndex + 1).padStart(3, "0")}-${String(input.candidateIndex + 1).padStart(3, "0")}`,
    assetRef: input.assetRef,
    mediaType: input.mediaType,
    trimStartMs: input.trimStartMs,
    maximumDurationMs: input.mediaType === "image" ? 10_000 : Math.min(10_000, input.sourceDurationMs! - input.trimStartMs),
  });
}

export function compileMarketingVideoAiDraft(input: {
  suggestion: MarketingVideoAiDraft;
  candidates: MarketingShotCandidate[];
  platform: MarketingVideoDraft["platform"];
}) {
  const suggestion = marketingVideoAiDraftSchema.parse(input.suggestion);
  const candidates = input.candidates.map((candidate) => marketingShotCandidateSchema.parse(candidate));
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  if (candidatesById.size !== candidates.length) throw new Error("候选镜头标识不能重复。");
  const selected = new Set<string>();
  const clips = suggestion.clips.map((clip, index) => {
    const candidate = candidatesById.get(clip.shotCandidateId);
    if (!candidate) throw new Error(`AI 初稿引用了未知候选镜头：${clip.shotCandidateId}`);
    if (selected.has(candidate.id)) throw new Error(`AI 初稿重复选择了候选镜头：${candidate.id}`);
    selected.add(candidate.id);
    if (clip.durationMs > candidate.maximumDurationMs) throw new Error(`AI 初稿片段超过候选镜头可用时长：${candidate.id}`);
    if (candidate.mediaType === "image" && clip.audioMode !== "muted") throw new Error(`图片候选镜头不能保留原声：${candidate.id}`);
    return {
      clipId: `clip-${String(index + 1).padStart(3, "0")}`,
      assetRef: candidate.assetRef,
      mediaType: candidate.mediaType,
      trimStartMs: candidate.trimStartMs,
      durationMs: clip.durationMs,
      fitMode: clip.fitMode,
      audioMode: clip.audioMode,
      caption: clip.caption,
    };
  });
  return marketingVideoDraftSchema.parse({ version: 2, platform: input.platform, clips, ctaText: suggestion.ctaText });
}
