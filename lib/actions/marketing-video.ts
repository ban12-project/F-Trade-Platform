"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { start } from "workflow/api";
import { z } from "zod";
import { authorizedActionSession, refreshWorkspace } from "@/lib/action-boundary";
import { getDatabase } from "@/lib/db/client";
import { videoReviewFormSchema } from "@/lib/form-schemas";
import {
  assertCurrentVideoDraftWriter,
  VideoDraftAccessError,
  type VideoDraftIdentity,
  videoDraftFailureMessage,
} from "@/lib/video/draft-write-access";
import {
  createMarketingVideoDraftFormSchema,
  createMarketingVideoFromInternetSchema,
  createMarketingVideoFromProductMediaSchema,
  type MarketingVideoDraft,
  marketingVideoDraftSchema,
} from "@/lib/video/edit-contracts";
import {
  type InternetMediaSearchResult,
  importInternetVideoMedia,
  internetMediaSearchInputSchema,
  searchInternetVideoMedia,
} from "@/lib/video/internet-media-search";
import {
  attachVideoWorkflowRun,
  queueVideoProcessingJob,
  releaseVideoWorkflowStart,
  reserveVideoWorkflowStart,
} from "@/lib/video/processing-jobs";
import { createMarketingVideoEditProjectFromProductMedia } from "@/lib/video/product-media-create";
import { decideGuardedVideoReview } from "@/lib/video/product-media-guarded-operations";
import { VideoReviewAccessError, videoReviewFailureMessage } from "@/lib/video/review-write-access";
import {
  assertMarketingVideoProjectLink,
  copyMarketingVideoDraftToProject,
  createMarketingVideoEditProject,
  saveMarketingVideoRenderRequest,
  updateMarketingVideoEditDraft,
} from "@/lib/video/store";
import { claimCompletedVideoUploads } from "@/lib/video/upload-receipts";
import { assertWorkspaceAggregateLink } from "@/lib/workspace/store";
import {
  generateMarketingVideoAiDraftWorkflow,
  renderMarketingVideoPreviewWorkflow,
} from "@/workflows/marketing-video-processing";

export type MarketingVideoActionState = {
  status: "idle" | "success" | "error";
  message: string;
  videoId?: string;
};
export type InternetMediaSearchActionState = {
  status: "idle" | "success" | "error";
  message: string;
  results: InternetMediaSearchResult[];
};
async function requireVideoDraftWriter() {
  const session = await authorizedActionSession("video:write");
  if (!session) throw new VideoDraftAccessError();
  return session;
}

type ProcessingJob = Awaited<ReturnType<typeof queueVideoProcessingJob>>["job"];
async function dispatchVideoJob(job: ProcessingJob, actorId: string) {
  if (job.status === "queued") {
    const claimId = `starting:${randomUUID()}`;
    if (!(await reserveVideoWorkflowStart(job.id, claimId))) return job;
    const workflow =
      job.kind === "ai_draft"
        ? generateMarketingVideoAiDraftWorkflow
        : renderMarketingVideoPreviewWorkflow;
    try {
      const run = await start(workflow, [{ jobId: job.id, videoId: job.videoProjectId, actorId }]);
      await attachVideoWorkflowRun(job.id, claimId, run.runId);
    } catch (error) {
      await releaseVideoWorkflowStart(job.id, claimId);
      throw error;
    }
  }
  return job;
}

async function startVideoJob(
  kind: "ai_draft" | "render",
  videoId: string,
  identity: VideoDraftIdentity,
) {
  const queued = await queueVideoProcessingJob(videoId, kind, identity);
  return dispatchVideoJob(queued.job, identity.actorId);
}

async function finishVideoCreation(
  result: { id: string; processingJob: ProcessingJob },
  projectId: string,
  actorId: string,
  message: string,
): Promise<MarketingVideoActionState> {
  try {
    await dispatchVideoJob(result.processingJob, actorId);
  } catch {
    message = "剪辑稿与后台任务已保存，任务暂未启动。请在剪辑器中重试。";
  }
  revalidatePath(`/workspace/${projectId}`);
  refreshWorkspace();
  return { status: "success", message, videoId: result.id };
}

export async function copyMarketingVideoDraftAction(
  projectIdInput: string,
  sourceVideoIdInput: string,
): Promise<MarketingVideoActionState> {
  try {
    const session = await requireVideoDraftWriter();
    const { projectId, sourceVideoId } = z
      .object({ projectId: z.uuid(), sourceVideoId: z.uuid() })
      .parse({ projectId: projectIdInput, sourceVideoId: sourceVideoIdInput });
    const result = await copyMarketingVideoDraftToProject(sourceVideoId, {
      actorId: session.user.id,
      sessionId: session.session.id,
      projectId,
    });
    revalidatePath(`/workspace/${projectId}`);
    refreshWorkspace();
    return {
      status: "success",
      message: "已复制为当前项目的独立剪辑稿；预览和审核状态不会共享。",
      videoId: result.id,
    };
  } catch (error) {
    return { status: "error", message: videoDraftFailureMessage(error, "copy") };
  }
}

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function jsonValue(formData: FormData, name: string, fallback: unknown) {
  const value = text(formData, name);
  return value ? (JSON.parse(value) as unknown) : fallback;
}

function creationFields(formData: FormData) {
  return {
    projectId: text(formData, "projectId"),
    productId: text(formData, "productId"),
    factPath: text(formData, "factPath"),
    objective: text(formData, "objective"),
    targetAudience: text(formData, "targetAudience"),
    platform: text(formData, "platform"),
  };
}

export async function createMarketingVideoDraftAction(
  _previous: MarketingVideoActionState,
  formData: FormData,
): Promise<MarketingVideoActionState> {
  try {
    const session = await requireVideoDraftWriter();
    const fields = creationFields(formData);
    const sourceMode = z
      .enum(["", "upload", "product_media", "internet_search"], { message: "素材来源模式无效。" })
      .parse(text(formData, "sourceMode"));

    if (sourceMode === "product_media") {
      const request = createMarketingVideoFromProductMediaSchema.parse({
        ...fields,
        sourceMode,
        productMediaIds: jsonValue(formData, "productMediaIds", []),
        rightsEvidenceRef: text(formData, "rightsEvidenceRef"),
      });
      await assertWorkspaceAggregateLink(
        request.projectId,
        request.productId,
        "marketing",
        "product",
        session.user.id,
      );
      const result = await createMarketingVideoEditProjectFromProductMedia(request, {
        actorId: session.user.id,
        sessionId: session.session.id,
        projectId: request.projectId,
      });
      return finishVideoCreation(
        result,
        request.projectId,
        session.user.id,
        "已复用审核通过的产品媒体，AI 剪辑初稿已进入后台队列。",
      );
    }

    if (sourceMode === "internet_search") {
      const request = createMarketingVideoFromInternetSchema.parse({
        ...fields,
        sourceMode,
        internetSearchQuery: text(formData, "internetSearchQuery"),
        internetMediaIds: jsonValue(formData, "internetMediaIds", []),
        rightsEvidenceRef: text(formData, "rightsEvidenceRef"),
      });
      await assertWorkspaceAggregateLink(
        request.projectId,
        request.productId,
        "marketing",
        "product",
        session.user.id,
      );
      const importedAssets = await importInternetVideoMedia(
        {
          projectId: request.projectId,
          productId: request.productId,
          query: request.internetSearchQuery,
          resultIds: request.internetMediaIds,
        },
        { actorId: session.user.id, sessionId: session.session.id, projectId: request.projectId },
      );
      const result = await createMarketingVideoEditProject(
        {
          ...fields,
          rightsEvidenceRef: importedAssets[0]?.rightsEvidenceRef,
        },
        { actorId: session.user.id, sessionId: session.session.id, projectId: request.projectId },
        importedAssets,
      );
      return finishVideoCreation(
        result,
        request.projectId,
        session.user.id,
        "互联网素材已私有导入；仅限测试预览，AI 剪辑初稿已进入后台队列。",
      );
    }

    const request = createMarketingVideoDraftFormSchema.parse({
      ...fields,
      rightsEvidenceRef: text(formData, "rightsEvidenceRef"),
    });
    await assertWorkspaceAggregateLink(
      request.projectId,
      request.productId,
      "marketing",
      "product",
      session.user.id,
    );
    const receiptIds = jsonValue(formData, "receiptIds", []);
    const uploadedAssets = await claimCompletedVideoUploads(
      receiptIds,
      { actorId: session.user.id, sessionId: session.session.id, projectId: request.projectId },
      request.rightsEvidenceRef,
    );
    const result = await createMarketingVideoEditProject(
      request,
      { actorId: session.user.id, sessionId: session.session.id, projectId: request.projectId },
      uploadedAssets,
    );
    return finishVideoCreation(
      result,
      request.projectId,
      session.user.id,
      "素材已保存，AI 剪辑初稿已进入后台队列。",
    );
  } catch (error) {
    return { status: "error", message: videoDraftFailureMessage(error, "create") };
  }
}

export async function searchInternetVideoMediaAction(
  input: unknown,
): Promise<InternetMediaSearchActionState> {
  try {
    const session = await requireVideoDraftWriter();
    const value = internetMediaSearchInputSchema.parse(input);
    await assertWorkspaceAggregateLink(
      value.projectId,
      value.productId,
      "marketing",
      "product",
      session.user.id,
    );
    const identity = {
      actorId: session.user.id,
      sessionId: session.session.id,
      projectId: value.projectId,
    };
    await assertCurrentVideoDraftWriter(identity, getDatabase());
    const results = await searchInternetVideoMedia(value.query);
    await assertCurrentVideoDraftWriter(identity, getDatabase());
    return {
      status: "success",
      message: results.length
        ? `找到 ${results.length} 个可导入图片。`
        : "没有找到可导入图片，请换一个检索词。",
      results,
    };
  } catch (error) {
    return {
      status: "error",
      message: videoDraftFailureMessage(error, "search"),
      results: [],
    };
  }
}

export async function generateMarketingVideoAiDraftAction(
  projectId: string,
  videoId: string,
): Promise<MarketingVideoActionState> {
  try {
    const session = await requireVideoDraftWriter();
    z.uuid().parse(projectId);
    z.uuid().parse(videoId);
    await assertMarketingVideoProjectLink(projectId, videoId, session.user.id);
    await startVideoJob("ai_draft", videoId, {
      actorId: session.user.id,
      sessionId: session.session.id,
      projectId,
    });
    revalidatePath(`/workspace/${projectId}`);
    refreshWorkspace();
    return { status: "success", message: "AI 初稿已进入后台队列，完成后会自动刷新。", videoId };
  } catch (error) {
    return { status: "error", message: videoDraftFailureMessage(error, "generate") };
  }
}

export async function saveMarketingVideoDraftAction(
  projectId: string,
  videoId: string,
  draft: MarketingVideoDraft,
): Promise<MarketingVideoActionState> {
  try {
    const session = await requireVideoDraftWriter();
    z.uuid().parse(projectId);
    z.uuid().parse(videoId);
    const value = marketingVideoDraftSchema.parse(draft);
    await assertMarketingVideoProjectLink(projectId, videoId, session.user.id);
    await updateMarketingVideoEditDraft(videoId, value, {
      actorId: session.user.id,
      sessionId: session.session.id,
      projectId,
    });
    revalidatePath(`/workspace/${projectId}`);
    refreshWorkspace();
    return { status: "success", message: "剪辑稿已保存。", videoId };
  } catch (error) {
    return { status: "error", message: videoDraftFailureMessage(error) };
  }
}

export async function renderMarketingVideoDraftAction(
  projectId: string,
  videoId: string,
  draft: MarketingVideoDraft,
): Promise<MarketingVideoActionState> {
  try {
    const session = await requireVideoDraftWriter();
    z.uuid().parse(projectId);
    z.uuid().parse(videoId);
    const value = marketingVideoDraftSchema.parse(draft);
    await assertMarketingVideoProjectLink(projectId, videoId, session.user.id);
    const job = await saveMarketingVideoRenderRequest(videoId, value, {
      actorId: session.user.id,
      sessionId: session.session.id,
      projectId,
    });
    try {
      await dispatchVideoJob(job, session.user.id);
    } catch {
      revalidatePath(`/workspace/${projectId}`);
      refreshWorkspace();
      return {
        status: "success",
        message: "剪辑稿与合成任务已保存，任务暂未启动。请稍后重试。",
        videoId,
      };
    }
    revalidatePath(`/workspace/${projectId}`);
    refreshWorkspace();
    return { status: "success", message: "私有预览已进入后台合成队列。", videoId };
  } catch (error) {
    return { status: "error", message: videoDraftFailureMessage(error, "render") };
  }
}

export async function reviewMarketingVideoAction(
  projectId: string,
  videoId: string,
  decision: "approved" | "rejected",
  evidenceRef: string,
  notes = "",
): Promise<MarketingVideoActionState> {
  try {
    const session = await authorizedActionSession("content:review");
    if (!session) throw new VideoReviewAccessError();
    z.uuid().parse(projectId);
    const review = videoReviewFormSchema.parse({ videoId, decision, evidenceRef, notes });
    await assertMarketingVideoProjectLink(projectId, videoId, session.user.id);
    await decideGuardedVideoReview(review, {
      actorId: session.user.id,
      sessionId: session.session.id,
      projectId,
    });
    revalidatePath(`/workspace/${projectId}`);
    refreshWorkspace();
    return {
      status: "success",
      message: decision === "approved" ? "成片已通过人工审核；不会自动发布。" : "成片已退回修改。",
      videoId,
    };
  } catch (error) {
    return { status: "error", message: videoReviewFailureMessage(error) };
  }
}
