import { createProductAgentModel } from "@/lib/ai/model-provider";
import { resolveProductAgentModelConfig } from "@/lib/ai/product-agent-model-config";
import { AiSdkStructuredGenerator } from "@/lib/ai/structured-generator";
import { marketingVideoAiDraftSchema, marketingVideoDraftSchema } from "@/lib/video/edit-contracts";
import { createReviewVideoExport } from "@/lib/video/export-artifact";
import { videoExportPresets } from "@/lib/video/export-presets";
import {
  beginGuardedMarketingVideoRender,
  completeGuardedMarketingVideoRender,
} from "@/lib/video/product-media-guarded-operations";
import { assertCurrentProductMediaUsageForVideo } from "@/lib/video/product-media-runtime-store";
import { VercelPrivateVideoAssetStore } from "@/lib/video/private-asset-store";
import { completeVideoJob, failVideoJob, markVideoJobRunning } from "@/lib/video/processing-jobs";
import { renderApprovedMarketingTimeline } from "@/lib/video/rendering";
import { extractMarketingVisualSamplesInSandbox, renderMarketingTimelineInSandbox } from "@/lib/video/sandbox-media";
import { issueSandboxVideoSources } from "@/lib/video/sandbox-sources";
import { failMarketingVideoRender, getMarketingVideoEditProject, updateMarketingVideoEditDraft } from "@/lib/video/store";
import { createMarketingEditTimeline } from "@/lib/video/timeline";

export type MarketingVideoWorkflowInput = { jobId: string; videoId: string; actorId: string };

async function generateAiDraft(input: MarketingVideoWorkflowInput) {
  "use step";
  const job = await markVideoJobRunning(input.jobId);
  if (job.status === "succeeded" || job.status === "failed") return;
  try {
    const { project, state } = await getMarketingVideoEditProject(input.videoId);
    if (!["VIDEO_DRAFT", "VIDEO_REVISION_REQUIRED"].includes(state)) throw new Error("当前视频状态不能生成 AI 初稿。");
    await assertCurrentProductMediaUsageForVideo(project);
    const sources = await issueSandboxVideoSources(project.sourceAssets.map((asset) => asset.assetRef));
    const suggestion = await new AiSdkStructuredGenerator().generate({
      model: createProductAgentModel(await resolveProductAgentModelConfig()),
      schema: marketingVideoAiDraftSchema,
      schemaName: "marketing_video_edit_draft",
      task: `Create an editable B2B marketing cut draft, never new media. Use 1-3 of these authorized assets: ${JSON.stringify(project.sourceAssets.map(({ assetRef, mediaType }) => ({ assetRef, mediaType })))}. Total duration must be at most 15000ms and every clip 1000-10000ms. Choose trimStartMs only from supplied sample timestamps or 0. Captions and CTA may use only supplied verified facts. Prefer concise captions, hard cuts, and a muted default.`,
      verifiedFacts: project.factualClaims.map(({ field, value, evidenceRef }) => ({ field, value, evidenceRef })),
      visualSamples: await extractMarketingVisualSamplesInSandbox(project.sourceAssets, sources),
    });
    const sourceByRef = new Map(project.sourceAssets.map((asset) => [asset.assetRef, asset]));
    const draft = marketingVideoDraftSchema.parse({
      version: 1,
      platform: project.editDraft!.platform,
      clips: suggestion.clips.map((clip, index) => {
        const source = sourceByRef.get(clip.assetRef);
        if (!source || !["image", "video"].includes(source.mediaType)) throw new Error("AI 初稿引用了未授权素材。");
        return { ...clip, clipId: `clip-${String(index + 1).padStart(3, "0")}`, mediaType: source.mediaType, ...(source.mediaType === "image" ? { trimStartMs: 0, audioMode: "muted" as const } : {}) };
      }),
      ctaText: suggestion.ctaText,
    });
    await updateMarketingVideoEditDraft(input.videoId, draft, input.actorId);
    await completeVideoJob(input.jobId);
  } catch (error) {
    await failVideoJob(input.jobId, "AI_DRAFT_FAILED", error instanceof Error ? error.message : "未知 AI 初稿错误");
  }
}

async function renderPreview(input: MarketingVideoWorkflowInput) {
  "use step";
  const job = await markVideoJobRunning(input.jobId);
  if (job.status === "succeeded" || job.status === "failed") return;
  let rendering = false;
  try {
    const project = await beginGuardedMarketingVideoRender(input.videoId, input.actorId);
    rendering = true;
    const timeline = createMarketingEditTimeline(project, project.editDraft!);
    const preset = videoExportPresets.find((candidate) => candidate.platform === project.editDraft!.platform && candidate.verification === "verified");
    if (!preset) throw new Error("目标平台没有可用的已核验导出预设。");
    const request = { timeline, platform: preset.platform, width: preset.width, height: preset.height, fps: preset.fps } as const;
    const sources = await issueSandboxVideoSources(project.editDraft!.clips.map((clip) => clip.assetRef));
    const expectedAssetRef = `asset-render-${input.jobId}`;
    let rendered: Awaited<ReturnType<typeof renderMarketingTimelineInSandbox>> | undefined;
    await renderApprovedMarketingTimeline(request, { render: async (validated) => {
      rendered = await renderMarketingTimelineInSandbox(validated, sources);
      return { assetRef: expectedAssetRef };
    } });
    if (!rendered) throw new Error("Sandbox 未生成视频输出。");
    const exportArtifact = createReviewVideoExport({
      videoId: input.videoId,
      sourceAssetRef: expectedAssetRef,
      platform: preset.platform,
      media: rendered.probe,
      timeline: { durationSeconds: timeline.durationSeconds },
    });
    const assetRef = await new VercelPrivateVideoAssetStore().putRenderedVideo({ data: rendered.data, contentType: "video/mp4", assetRef: expectedAssetRef });
    await completeGuardedMarketingVideoRender(input.videoId, assetRef, exportArtifact);
    await completeVideoJob(input.jobId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知渲染错误";
    if (rendering) await failMarketingVideoRender(input.videoId, message);
    await failVideoJob(input.jobId, "RENDER_FAILED", message);
  }
}

export async function generateMarketingVideoAiDraftWorkflow(input: MarketingVideoWorkflowInput) {
  "use workflow";
  await generateAiDraft(input);
}

export async function renderMarketingVideoPreviewWorkflow(input: MarketingVideoWorkflowInput) {
  "use workflow";
  await renderPreview(input);
}
