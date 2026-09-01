"use server";

import { readFile } from "node:fs/promises";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { createProductAgentModel } from "@/lib/ai/model-provider";
import { resolveProductAgentModelConfig } from "@/lib/ai/product-agent-model-config";
import { AiSdkStructuredGenerator } from "@/lib/ai/structured-generator";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import { marketingVideoAiDraftSchema, marketingVideoDraftSchema, type MarketingVideoDraft } from "@/lib/video/edit-contracts";
import { videoExportPresets } from "@/lib/video/export-presets";
import { createFfmpegTimelineRenderer } from "@/lib/video/ffmpeg-renderer";
import { VercelPrivateVideoAssetStore } from "@/lib/video/private-asset-store";
import { renderApprovedMarketingTimeline } from "@/lib/video/rendering";
import {
  assertMarketingVideoProjectLink,
  beginMarketingVideoRender,
  completeMarketingVideoRender,
  createMarketingVideoEditProject,
  decideVideoReview,
  failMarketingVideoRender,
  getMarketingVideoEditProject,
  updateMarketingVideoEditDraft,
} from "@/lib/video/store";
import { createMarketingEditTimeline } from "@/lib/video/timeline";
import { prepareUploadedVideoAssets, withTemporaryUploadedVideoAssets } from "@/lib/video/uploaded-assets";
import { extractMarketingVisualSamples } from "@/lib/video/visual-sampling";

export type MarketingVideoActionState = { status: "idle" | "success" | "error"; message: string; videoId?: string };
export const initialMarketingVideoActionState: MarketingVideoActionState = { status: "idle", message: "" };

async function requireVideoWriter() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "video:write")) throw new Error("无权编辑营销视频。");
  return session;
}

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function createMarketingVideoDraftAction(_previous: MarketingVideoActionState, formData: FormData): Promise<MarketingVideoActionState> {
  try {
    const session = await requireVideoWriter();
    const files = formData.getAll("assets").filter((value): value is File => value instanceof File && value.size > 0);
    if (files.length > 3) return { status: "error", message: "MVP1 每条视频最多使用三个素材。" };
    const rightsEvidenceRef = text(formData, "rightsEvidenceRef");
    const uploadedAssets = await prepareUploadedVideoAssets(files, session.user.id, rightsEvidenceRef);
    const result = await createMarketingVideoEditProject({
      projectId: text(formData, "projectId"), productId: text(formData, "productId"), factPath: text(formData, "factPath"),
      objective: text(formData, "objective"), targetAudience: text(formData, "targetAudience"), platform: text(formData, "platform"), rightsEvidenceRef,
    }, session.user.id, uploadedAssets);
    revalidatePath(`/workspace/${text(formData, "projectId")}`);
    return { status: "success", message: "素材已保存为私有剪辑稿。现在可以生成 AI 初稿或手动调整。", videoId: result.id };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "无法创建营销视频剪辑稿。" };
  }
}

export async function generateMarketingVideoAiDraftAction(projectId: string, videoId: string): Promise<MarketingVideoActionState> {
  try {
    const session = await requireVideoWriter();
    await assertMarketingVideoProjectLink(projectId, videoId);
    const { project, state } = await getMarketingVideoEditProject(videoId);
    if (!["VIDEO_DRAFT", "VIDEO_REVISION_REQUIRED"].includes(state)) throw new Error("当前视频状态不能生成 AI 初稿。");
    const suggestion = await withTemporaryUploadedVideoAssets(project.sourceAssets.map((asset) => asset.assetRef), async (paths) => new AiSdkStructuredGenerator().generate({
      model: createProductAgentModel(await resolveProductAgentModelConfig()),
      schema: marketingVideoAiDraftSchema,
      schemaName: "marketing_video_edit_draft",
      task: `Create an editable B2B marketing cut draft, never new media. Use 1-3 of these authorized assets: ${JSON.stringify(project.sourceAssets.map(({ assetRef, mediaType }) => ({ assetRef, mediaType })))}. Total duration must be at most 15000ms and every clip 1000-10000ms. Choose trimStartMs only from the supplied sample timestamps or 0. Captions and CTA may use only supplied verified facts. Prefer concise captions, hard cuts, and a muted default.`,
      verifiedFacts: project.factualClaims.map(({ field, value, evidenceRef }) => ({ field, value, evidenceRef })),
      visualSamples: await extractMarketingVisualSamples(project.sourceAssets, paths),
    }));
    const sourceByRef = new Map(project.sourceAssets.map((asset) => [asset.assetRef, asset]));
    const draft = marketingVideoDraftSchema.parse({
      version: 1,
      platform: project.editDraft!.platform,
      clips: suggestion.clips.map((clip, index) => {
        const source = sourceByRef.get(clip.assetRef);
        if (!source || (source.mediaType !== "image" && source.mediaType !== "video")) throw new Error("AI 初稿引用了未授权素材。");
        return { ...clip, clipId: `clip-${String(index + 1).padStart(3, "0")}`, mediaType: source.mediaType, ...(source.mediaType === "image" ? { trimStartMs: 0, audioMode: "muted" as const } : {}) };
      }),
      ctaText: suggestion.ctaText,
    });
    await updateMarketingVideoEditDraft(videoId, draft, session.user.id);
    revalidatePath(`/workspace/${projectId}`);
    return { status: "success", message: "AI 初稿已生成。请检查截取区间、字幕和 CTA 后再合成。", videoId };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "无法生成 AI 剪辑初稿。" };
  }
}

export async function saveMarketingVideoDraftAction(projectId: string, videoId: string, draft: MarketingVideoDraft): Promise<MarketingVideoActionState> {
  try {
    const session = await requireVideoWriter();
    await assertMarketingVideoProjectLink(projectId, videoId);
    await updateMarketingVideoEditDraft(videoId, draft, session.user.id);
    revalidatePath(`/workspace/${projectId}`);
    return { status: "success", message: "剪辑稿已保存。", videoId };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "无法保存剪辑稿。" };
  }
}

export async function renderMarketingVideoDraftAction(projectId: string, videoId: string, draft: MarketingVideoDraft): Promise<MarketingVideoActionState> {
  let renderBegan = false;
  try {
    const session = await requireVideoWriter();
    await assertMarketingVideoProjectLink(projectId, videoId);
    await updateMarketingVideoEditDraft(videoId, draft, session.user.id);
    const project = await beginMarketingVideoRender(videoId, session.user.id);
    renderBegan = true;
    const timeline = createMarketingEditTimeline(project, project.editDraft!);
    const preset = videoExportPresets.find((candidate) => candidate.platform === project.editDraft!.platform);
    if (!preset || preset.verification !== "verified") throw new Error("目标平台没有可用的已核验导出预设。");
    const assetRefs = project.editDraft!.clips.map((clip) => clip.assetRef);
    const assetRef = await withTemporaryUploadedVideoAssets(assetRefs, async (paths) => {
      const privateStore = new VercelPrivateVideoAssetStore();
      const renderer = createFfmpegTimelineRenderer({
        resolvePrivateAssetPath: async (sourceRef) => {
          const path = paths.get(sourceRef);
          if (!path) throw new Error("无法解析当前剪辑的私有素材。");
          return path;
        },
        storeRenderedVideo: async ({ filePath, contentType }) => privateStore.putRenderedVideo({ data: new Uint8Array(await readFile(filePath)), contentType }),
      });
      const result = await renderApprovedMarketingTimeline({ timeline, platform: preset.platform, width: preset.width, height: preset.height, fps: preset.fps }, renderer);
      return result.assetRef;
    });
    await completeMarketingVideoRender(videoId, assetRef);
    revalidatePath(`/workspace/${projectId}`);
    return { status: "success", message: "私有预览已生成，等待管理员审核成片。", videoId };
  } catch (error) {
    if (renderBegan) await failMarketingVideoRender(videoId, error instanceof Error ? error.message : "未知渲染错误");
    return { status: "error", message: error instanceof Error ? error.message : "无法合成营销视频。" };
  }
}

export async function reviewMarketingVideoAction(projectId: string, videoId: string, decision: "approved" | "rejected", evidenceRef: string, notes = ""): Promise<MarketingVideoActionState> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session || !hasPermission(session.user.role, "content:review")) throw new Error("只有管理员可以审核营销视频成片。");
    await assertMarketingVideoProjectLink(projectId, videoId);
    await decideVideoReview({ videoId, decision, evidenceRef, notes }, session.user.id);
    revalidatePath(`/workspace/${projectId}`);
    return { status: "success", message: decision === "approved" ? "成片已通过人工审核；不会自动发布。" : "成片已退回修改。", videoId };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "无法审核营销视频。" };
  }
}
