import { createProductAgentModel } from "@/lib/ai/model-provider";
import { resolveProductAgentModelConfig } from "@/lib/ai/product-agent-model-config";
import { AiSdkStructuredGenerator } from "@/lib/ai/structured-generator";
import {
  marketingVideoAiDraftSchema,
  safeAiCreativeCaptions,
  safeAiCtaTexts,
} from "@/lib/video/edit-contracts";
import { createReviewVideoExport } from "@/lib/video/export-artifact";
import { videoExportPresets } from "@/lib/video/export-presets";
import { VercelPrivateVideoAssetStore } from "@/lib/video/private-asset-store";
import { completeVideoJob, failVideoJob, markVideoJobRunning } from "@/lib/video/processing-jobs";
import { assertCurrentProductFactsForVideo } from "@/lib/video/product-fact-runtime-store";
import {
  beginGuardedMarketingVideoRender,
  completeGuardedMarketingVideoRender,
} from "@/lib/video/product-media-guarded-operations";
import { assertCurrentProductMediaUsageForVideo } from "@/lib/video/product-media-runtime-store";
import { renderApprovedMarketingTimeline } from "@/lib/video/rendering";
import {
  extractMarketingVisualSamplesInSandbox,
  renderMarketingTimelineInSandbox,
} from "@/lib/video/sandbox-media";
import { issueSandboxVideoSources } from "@/lib/video/sandbox-sources";
import { compileMarketingVideoAiDraft } from "@/lib/video/shot-candidates";
import {
  failMarketingVideoRender,
  getMarketingVideoEditProject,
  updateMarketingVideoEditDraft,
} from "@/lib/video/store";
import { createMarketingEditTimeline } from "@/lib/video/timeline";

export type MarketingVideoWorkflowInput = { jobId: string; videoId: string; actorId: string };

async function generateAiDraft(input: MarketingVideoWorkflowInput) {
  "use step";
  const job = await markVideoJobRunning(input.jobId);
  if (job.status === "succeeded" || job.status === "failed") return;
  try {
    const { project, state } = await getMarketingVideoEditProject(input.videoId);
    if (!["VIDEO_DRAFT", "VIDEO_REVISION_REQUIRED"].includes(state))
      throw new Error("当前视频状态不能生成 AI 初稿。");
    await Promise.all([
      assertCurrentProductFactsForVideo(project),
      assertCurrentProductMediaUsageForVideo(project),
    ]);
    const sources = await issueSandboxVideoSources(
      project.sourceAssets.map((asset) => asset.assetRef),
    );
    const sampling = await extractMarketingVisualSamplesInSandbox(project.sourceAssets, sources);
    const suggestion = await new AiSdkStructuredGenerator().generate({
      model: createProductAgentModel(await resolveProductAgentModelConfig()),
      schema: marketingVideoAiDraftSchema,
      schemaName: "marketing_video_edit_draft",
      task: `Create an editable B2B marketing cut draft, never new media. Follow Google's ABCD creative structure: Attention in the first 1-2 seconds, Branding early, Connection through a clear distributor or product-use context, and Direction through a CTA. Select 1-3 unique shotCandidateId values from ${JSON.stringify(sampling.candidates.map(({ id, mediaType, maximumDurationMs, sourceAnalysis }) => ({ id, mediaType, maximumDurationMs, ...(sourceAnalysis ? { intervalStartMs: sourceAnalysis.intervalStartMs, intervalEndMs: sourceAnalysis.intervalEndMs, representativeMs: sourceAnalysis.representativeMs, actionScore: sourceAnalysis.actionScore, actionLevel: sourceAnalysis.actionLevel } : {}) })))}. actionScore is only measured visual motion intensity, not semantic quality or factual relevance; judge usefulness from the supplied representative frame and the creative objective instead of blindly picking the highest score. A clip may cover multiple abcdRoles, but the complete draft must cover attention, branding, connection, and direction. Choose one bounded motionPreset per clip from punch_in, hero_reveal, slow_pan, or cta_hold. Never provide an asset reference or trim timestamp. Total duration must be at most 15000ms, every clip 1000-10000ms, and each durationMs must not exceed its candidate maximumDurationMs. Image candidates must be muted. Every caption object must contain kind, text, and claimRef. A factual caption must use { kind: "verified_fact", text: "", claimRef: <verified field> } and must never provide the fact text. A creative caption must use claimRef: "" and text exactly matching one of ${JSON.stringify(safeAiCreativeCaptions)}. Use { kind: "none", text: "", claimRef: "" } when no caption is needed. CTA must exactly match one of ${JSON.stringify(safeAiCtaTexts)}. Use purposeful pacing and motion; do not invent product facts.`,
      verifiedFacts: project.factualClaims.map(({ field, value, evidenceRef }) => ({
        field,
        value,
        evidenceRef,
      })),
      visualSamples: sampling.visualSamples,
    });
    const draft = compileMarketingVideoAiDraft({
      suggestion,
      candidates: sampling.candidates,
      platform: project.editDraft!.platform,
    });
    await updateMarketingVideoEditDraft(input.videoId, draft, input.actorId);
    await completeVideoJob(input.jobId);
  } catch (error) {
    await failVideoJob(
      input.jobId,
      "AI_DRAFT_FAILED",
      error instanceof Error ? error.message : "未知 AI 初稿错误",
    );
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
    const preset = videoExportPresets.find(
      (candidate) =>
        candidate.platform === project.editDraft!.platform && candidate.availability === "enabled",
    );
    if (!preset) throw new Error("目标平台没有已启用的项目导出预设。");
    const request = {
      timeline,
      platform: preset.platform,
      width: preset.width,
      height: preset.height,
      fps: preset.fps,
    } as const;
    const sources = await issueSandboxVideoSources(
      project.editDraft!.clips.map((clip) => clip.assetRef),
    );
    const useRemotion =
      process.env.VIDEO_COMPOSITOR === "remotion" &&
      preset.width === 1080 &&
      preset.height === 1920 &&
      preset.fps === 30;
    const expectedAssetRef = `asset-render-${input.jobId}`;
    let rendered: Awaited<ReturnType<typeof renderMarketingTimelineInSandbox>> | undefined;
    await renderApprovedMarketingTimeline(request, {
      render: async (validated) => {
        if (useRemotion) {
          const productName = project.factualClaims.find(
            (claim) => claim.field === "product.product_name",
          )?.value;
          if (!productName) throw new Error("Remotion ABCD 合成需要已核验的产品名称。");
          const { renderMarketingTimelineWithRemotion } = await import(
            "@/lib/video/remotion-sandbox"
          );
          rendered = await renderMarketingTimelineWithRemotion(validated, sources, productName);
        } else rendered = await renderMarketingTimelineInSandbox(validated, sources);
        return { assetRef: expectedAssetRef };
      },
    });
    if (!rendered) throw new Error("Sandbox 未生成视频输出。");
    const exportArtifact = createReviewVideoExport({
      videoId: input.videoId,
      sourceAssetRef: expectedAssetRef,
      platform: preset.platform,
      media: rendered.probe,
      timeline: { durationSeconds: timeline.durationSeconds },
    });
    const assetRef = await new VercelPrivateVideoAssetStore().putRenderedVideo({
      data: rendered.data,
      contentType: "video/mp4",
      assetRef: expectedAssetRef,
    });
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
