import { z } from "zod";

import { marketingVideoAiDraftSchema, marketingVideoDraftSchema, type MarketingVideoAiDraft, type MarketingVideoDraft } from "./edit-contracts";
import { selectDiverseActionIntervals, shotSourceAnalysisSchema, type ShotSourceAnalysis } from "./shot-analysis";

const privateAssetRef = z.string().trim().regex(/^(?:asset|evidence)-[a-z0-9][a-z0-9_-]{2,120}$/i);

export const marketingShotCandidateSchema = z.object({
  id: z.string().trim().regex(/^shot-[0-9]{3}-[0-9]{3}$/),
  assetRef: privateAssetRef,
  mediaType: z.enum(["image", "video"]),
  trimStartMs: z.number().int().min(0),
  maximumDurationMs: z.number().int().min(1_000).max(10_000),
  sourceAnalysis: shotSourceAnalysisSchema.optional(),
}).strict().superRefine((candidate, context) => {
  if (candidate.mediaType === "image" && candidate.trimStartMs !== 0) {
    context.addIssue({ code: "custom", path: ["trimStartMs"], message: "图片候选镜头必须从 0ms 开始。" });
  }
  if (candidate.mediaType === "image" && candidate.sourceAnalysis) {
    context.addIssue({ code: "custom", path: ["sourceAnalysis"], message: "图片候选镜头不能携带视频镜头分析。" });
  }
  if (candidate.sourceAnalysis && (candidate.trimStartMs < candidate.sourceAnalysis.intervalStartMs || candidate.trimStartMs + candidate.maximumDurationMs > candidate.sourceAnalysis.intervalEndMs)) {
    context.addIssue({ code: "custom", path: ["sourceAnalysis"], message: "候选镜头必须位于检测区间内。" });
  }
});

export type MarketingShotCandidate = z.infer<typeof marketingShotCandidateSchema>;

export const maximumMarketingVisualCandidates = 12;
export const maximumMarketingSourceDurationSeconds = 15 * 60;

export function videoShotCandidateStarts(durationMs: number, maximumCandidates = 3) {
  if (!Number.isInteger(durationMs) || durationMs < 1_000) throw new Error("源视频不足 1 秒，不能生成候选镜头。");
  if (durationMs > maximumMarketingSourceDurationSeconds * 1_000) {
    throw new Error(`源视频不能超过 ${maximumMarketingSourceDurationSeconds} 秒。`);
  }
  if (!Number.isInteger(maximumCandidates) || maximumCandidates < 1 || maximumCandidates > maximumMarketingVisualCandidates) {
    throw new Error(`候选镜头数量必须介于 1 和 ${maximumMarketingVisualCandidates} 之间。`);
  }
  const latestStartMs = durationMs - 1_000;
  const desiredCandidates = Math.min(maximumCandidates, Math.max(3, Math.ceil(durationMs / 60_000)));
  const positions = desiredCandidates === 3
    ? [0.2, 0.5, 0.8]
    : Array.from({ length: desiredCandidates }, (_, index) => (index + 1) / (desiredCandidates + 1));
  return [...new Set(positions.map((position) => Math.min(Math.round(durationMs * position), latestStartMs)))];
}

export function createMarketingShotCandidate(input: {
  sourceIndex: number;
  candidateIndex: number;
  assetRef: string;
  mediaType: "image" | "video";
  trimStartMs: number;
  sourceDurationMs?: number;
  sourceAnalysis?: ShotSourceAnalysis;
}) {
  if (input.mediaType === "video" && (!Number.isInteger(input.sourceDurationMs) || input.sourceDurationMs! - input.trimStartMs < 1_000)) {
    throw new Error("视频候选镜头必须保留至少 1 秒可用源素材。");
  }
  return marketingShotCandidateSchema.parse({
    id: `shot-${String(input.sourceIndex + 1).padStart(3, "0")}-${String(input.candidateIndex + 1).padStart(3, "0")}`,
    assetRef: input.assetRef,
    mediaType: input.mediaType,
    trimStartMs: input.trimStartMs,
    maximumDurationMs: input.mediaType === "image" ? 10_000 : Math.min(10_000, Math.min(input.sourceAnalysis?.intervalEndMs ?? input.sourceDurationMs!, input.sourceDurationMs!) - input.trimStartMs),
    sourceAnalysis: input.sourceAnalysis,
  });
}

export function createScoredVideoShotCandidates(input: {
  sourceIndex: number;
  assetRef: string;
  sourceDurationMs: number;
  maximumCandidates: number;
  intervals: ShotSourceAnalysis[];
}) {
  const desiredCount = videoShotCandidateStarts(input.sourceDurationMs, input.maximumCandidates).length;
  const selected = selectDiverseActionIntervals(input.intervals, desiredCount);
  const analyses = selected.length >= desiredCount
    ? selected
    : videoShotCandidateStarts(input.sourceDurationMs, input.maximumCandidates).map((startMs) => input.intervals.find((interval) => startMs >= interval.intervalStartMs && startMs < interval.intervalEndMs) ?? input.intervals[0]).filter((interval): interval is ShotSourceAnalysis => Boolean(interval));
  return analyses.map((analysis, candidateIndex) => {
    const desiredStartMs = selected.length >= desiredCount ? analysis.representativeMs - 1_000 : videoShotCandidateStarts(input.sourceDurationMs, input.maximumCandidates)[candidateIndex]!;
    const trimStartMs = Math.max(analysis.intervalStartMs, Math.min(desiredStartMs, analysis.intervalEndMs - 1_000));
    return createMarketingShotCandidate({
      sourceIndex: input.sourceIndex,
      candidateIndex,
      assetRef: input.assetRef,
      mediaType: "video",
      trimStartMs,
      sourceDurationMs: input.sourceDurationMs,
      sourceAnalysis: analysis,
    });
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
    const caption = clip.caption.kind === "none"
      ? { kind: "none" as const }
      : clip.caption.kind === "creative"
        ? { kind: "creative" as const, text: clip.caption.text }
        : { kind: "verified_fact" as const, claimRef: clip.caption.claimRef };
    return {
      clipId: `clip-${String(index + 1).padStart(3, "0")}`,
      assetRef: candidate.assetRef,
      mediaType: candidate.mediaType,
      trimStartMs: candidate.trimStartMs,
      durationMs: clip.durationMs,
      fitMode: clip.fitMode,
      audioMode: clip.audioMode,
      caption,
      abcdRoles: clip.abcdRoles,
      motionPreset: clip.motionPreset,
      sourceAnalysis: candidate.sourceAnalysis,
    };
  });
  return marketingVideoDraftSchema.parse({ version: 3, creativeFramework: "google_abcd", platform: input.platform, clips, ctaText: suggestion.ctaText });
}
