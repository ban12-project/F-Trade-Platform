"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import {
  createMarketingVideoDraftFormSchema,
  createMarketingVideoFromProductMediaSchema,
  type MarketingVideoDraft,
} from "@/lib/video/edit-contracts";
import { createMarketingVideoEditProjectFromProductMedia } from "@/lib/video/product-media-create";
import { attachVideoWorkflowRun, queueVideoProcessingJob, releaseVideoWorkflowStart, reserveVideoWorkflowStart } from "@/lib/video/processing-jobs";
import {
  assertMarketingVideoProjectLink,
  copyMarketingVideoDraftToProject,
  createMarketingVideoEditProject,
  decideVideoReview,
  updateMarketingVideoEditDraft,
} from "@/lib/video/store";
import { claimCompletedVideoUploads } from "@/lib/video/upload-receipts";
import { assertWorkspaceAggregateLink } from "@/lib/workspace/store";
import { start } from "workflow/api";
import { generateMarketingVideoAiDraftWorkflow, renderMarketingVideoPreviewWorkflow } from "@/workflows/marketing-video-processing";

export type MarketingVideoActionState = { status: "idle" | "success" | "error"; message: string; videoId?: string };
async function requireVideoWriter() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "video:write")) throw new Error("无权编辑营销视频。");
  return session;
}

async function startVideoJob(kind: "ai_draft" | "render", videoId: string, actorId: string) {
  const queued = await queueVideoProcessingJob(videoId, kind, actorId);
  if (queued.job.status === "queued") {
    const claimId = `starting:${randomUUID()}`;
    if (!await reserveVideoWorkflowStart(queued.job.id, claimId)) return queued.job;
    const workflow = kind === "ai_draft" ? generateMarketingVideoAiDraftWorkflow : renderMarketingVideoPreviewWorkflow;
    try {
      const run = await start(workflow, [{ jobId: queued.job.id, videoId, actorId }]);
      await attachVideoWorkflowRun(queued.job.id, claimId, run.runId);
    } catch (error) {
      await releaseVideoWorkflowStart(queued.job.id, claimId);
      throw error;
    }
  }
  return queued.job;
}

async function finishVideoCreation(result: { id: string }, projectId: string, actorId: string, message: string): Promise<MarketingVideoActionState> {
  await startVideoJob("ai_draft", result.id, actorId);
  revalidatePath(`/workspace/${projectId}`);
  return { status: "success", message, videoId: result.id };
}

export async function copyMarketingVideoDraftAction(projectIdInput: string, sourceVideoIdInput: string): Promise<MarketingVideoActionState> {
  try {
    const session = await requireVideoWriter();
    const { projectId, sourceVideoId } = z.object({ projectId: z.uuid(), sourceVideoId: z.uuid() }).parse({ projectId: projectIdInput, sourceVideoId: sourceVideoIdInput });
    const result = await copyMarketingVideoDraftToProject(sourceVideoId, projectId, session.user.id);
    revalidatePath(`/workspace/${projectId}`);
    return { status: "success", message: "已复制为当前项目的独立剪辑稿；预览和审核状态不会共享。", videoId: result.id };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "无法复制营销视频。" };
  }
}

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function jsonValue(formData: FormData, name: string, fallback: unknown) {
  const value = text(formData, name);
  return value ? JSON.parse(value) as unknown : fallback;
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

export async function createMarketingVideoDraftAction(_previous: MarketingVideoActionState, formData: FormData): Promise<MarketingVideoActionState> {
  try {
    const session = await requireVideoWriter();
    const fields = creationFields(formData);

    if (text(formData, "sourceMode") === "product_media") {
      const request = createMarketingVideoFromProductMediaSchema.parse({
        ...fields,
        sourceMode: "product_media",
        productMediaIds: jsonValue(formData, "productMediaIds", []),
        rightsEvidenceRef: text(formData, "rightsEvidenceRef"),
      });
      await assertWorkspaceAggregateLink(request.projectId, request.productId, "marketing", "product");
      const result = await createMarketingVideoEditProjectFromProductMedia(request, session.user.id);
      return finishVideoCreation(
        result,
        request.projectId,
        session.user.id,
        "已复用审核通过的产品媒体，AI 剪辑初稿已进入后台队列。",
      );
    }

    const request = createMarketingVideoDraftFormSchema.parse({
      ...fields,
      rightsEvidenceRef: text(formData, "rightsEvidenceRef"),
    });
    await assertWorkspaceAggregateLink(request.projectId, request.productId, "marketing", "product");
    const receiptIds = jsonValue(formData, "receiptIds", []);
    const uploadedAssets = await claimCompletedVideoUploads(
      receiptIds,
      session.user.id,
      request.projectId,
      request.rightsEvidenceRef,
    );
    const result = await createMarketingVideoEditProject(request, session.user.id, uploadedAssets);
    return finishVideoCreation(result, request.projectId, session.user.id, "素材已保存，AI 剪辑初稿已进入后台队列。");
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "无法创建营销视频剪辑稿。" };
  }
}

export async function generateMarketingVideoAiDraftAction(projectId: string, videoId: string): Promise<MarketingVideoActionState> {
  try {
    const session = await requireVideoWriter();
    await assertMarketingVideoProjectLink(projectId, videoId);
    await startVideoJob("ai_draft", videoId, session.user.id);
    revalidatePath(`/workspace/${projectId}`);
    return { status: "success", message: "AI 初稿已进入后台队列，完成后会自动刷新。", videoId };
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
  try {
    const session = await requireVideoWriter();
    await assertMarketingVideoProjectLink(projectId, videoId);
    await updateMarketingVideoEditDraft(videoId, draft, session.user.id);
    await startVideoJob("render", videoId, session.user.id);
    revalidatePath(`/workspace/${projectId}`);
    return { status: "success", message: "私有预览已进入后台合成队列。", videoId };
  } catch (error) {
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
