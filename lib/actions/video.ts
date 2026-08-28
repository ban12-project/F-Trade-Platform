"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { videoProjectDraftFormSchema } from "@/lib/form-schemas";
import { createVideoProject } from "@/lib/video/store";

export type VideoActionState = { status: "idle" | "success" | "error"; message: string };
export const initialVideoActionState: VideoActionState = { status: "idle", message: "" };

export async function createVideoProjectAction(_previous: VideoActionState, formData: FormData): Promise<VideoActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") return { status: "error", message: "无权创建视频项目。" };
  const parsed = videoProjectDraftFormSchema.safeParse({ ...Object.fromEntries(formData), platforms: formData.getAll("platforms") });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "视频项目资料格式不正确。" };
  try {
    const result = await createVideoProject(parsed.data, session.user.id);
    revalidatePath("/console/video");
    return { status: "success", message: `视频项目已创建（${result.id.slice(0, 8)}），等待 Gate 01 人工审核。` };
  } catch (error) { return { status: "error", message: error instanceof Error ? error.message : "无法创建视频项目。" }; }
}
