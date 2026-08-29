"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { videoProjectDraftFormSchema } from "@/lib/form-schemas";
import { createVideoProject } from "@/lib/video/store";
import { prepareUploadedVideoAssets } from "@/lib/video/uploaded-assets";

export type VideoActionState = { status: "idle" | "success" | "error"; message: string };
export const initialVideoActionState: VideoActionState = { status: "idle", message: "" };

export async function createVideoProjectAction(_previous: VideoActionState, formData: FormData): Promise<VideoActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") return { status: "error", message: "无权创建视频项目。" };
  const parsed = videoProjectDraftFormSchema.safeParse({ ...Object.fromEntries(formData), platforms: formData.getAll("platforms") });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "视频项目资料格式不正确。" };
  try {
    const files = formData.getAll("assets").filter((value): value is File => value instanceof File && value.size > 0);
    const uploadedAssets = await prepareUploadedVideoAssets(files, session.user.id, parsed.data.rightsEvidenceRef || "");
    const result = await createVideoProject(parsed.data, session.user.id, uploadedAssets);
    revalidatePath("/console/video");
    return { status: "success", message: `视频项目已创建（${result.id.slice(0, 8)}），创意检查仅作建议。` };
  } catch (error) { return { status: "error", message: error instanceof Error ? error.message : "无法创建视频项目。" }; }
}
