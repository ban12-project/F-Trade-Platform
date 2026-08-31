"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import { videoProjectDraftFormSchema } from "@/lib/form-schemas";
import { prepareUploadedVideoAssets } from "@/lib/video/uploaded-assets";
import { saveVideoCanvasSchema, videoCanvasDocumentSchema, type VideoCanvasDocument } from "@/lib/video/canvas-contracts";
import { VideoCanvasRevisionConflictError, saveVideoCanvasDocument } from "@/lib/video/canvas-store";
import { createVideoProject, createVideoProjectFromCanvas } from "@/lib/video/store";

export type VideoActionState = { status: "idle" | "success" | "error"; message: string };
export const initialVideoActionState: VideoActionState = { status: "idle", message: "" };

export async function createVideoProjectAction(_previous: VideoActionState, formData: FormData): Promise<VideoActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "video:write")) return { status: "error", message: "无权创建视频项目。" };
  const parsed = videoProjectDraftFormSchema.safeParse({ ...Object.fromEntries(formData), platforms: formData.getAll("platforms") });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "视频项目资料格式不正确。" };
  try {
    const files = formData.getAll("assets").filter((value): value is File => value instanceof File && value.size > 0);
    const uploadedAssets = await prepareUploadedVideoAssets(files, session.user.id, parsed.data.rightsEvidenceRef || "");
    const result = await createVideoProject(parsed.data, session.user.id, uploadedAssets);
    revalidatePath("/console/video");
    revalidatePath("/studio");
    return { status: "success", message: `视频项目已创建（${result.id.slice(0, 8)}），等待 Gate 01 人工审核。` };
  } catch (error) { return { status: "error", message: error instanceof Error ? error.message : "无法创建视频项目。" }; }
}

export type SaveVideoCanvasActionState = { status: "success" | "error" | "conflict"; message: string; revision?: number };

export async function saveVideoCanvasAction(input: { expectedRevision: number; document: VideoCanvasDocument }): Promise<SaveVideoCanvasActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "video:write")) return { status: "error", message: "无权保存画布。" };
  const parsed = saveVideoCanvasSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "画布数据格式不正确。" };
  try {
    const result = await saveVideoCanvasDocument(parsed.data, session.user.id);
    revalidatePath("/studio");
    return { status: "success", message: "云端草稿已保存。", revision: result.revision };
  } catch (error) {
    if (error instanceof VideoCanvasRevisionConflictError) return { status: "conflict", message: error.message };
    return { status: "error", message: error instanceof Error ? error.message : "无法保存画布。" };
  }
}

export async function createVideoProjectFromCanvasAction(document: VideoCanvasDocument): Promise<VideoActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "video:write")) return { status: "error", message: "无权创建视频项目。" };
  const parsed = videoCanvasDocumentSchema.safeParse(document);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "画布数据格式不正确。" };
  try {
    const result = await createVideoProjectFromCanvas(parsed.data, session.user.id);
    revalidatePath("/studio");
    return { status: "success", message: `视频项目已创建（${result.id.slice(0, 8)}），等待 Gate 01 人工审核。` };
  } catch (error) { return { status: "error", message: error instanceof Error ? error.message : "无法从画布创建视频项目。" }; }
}
