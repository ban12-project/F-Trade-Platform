"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import { videoReviewFormSchema } from "@/lib/form-schemas";
import { decideVideoReview } from "@/lib/video/store";

export type VideoReviewActionState = { status: "idle" | "success" | "error"; message: string };
export async function decideVideoReviewAction(_previous: VideoReviewActionState, formData: FormData): Promise<VideoReviewActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "content:review")) return { status: "error", message: "无权确认视频计划。" };
  const parsed = videoReviewFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "视频确认资料无效。" };
  try {
    const result = await decideVideoReview(parsed.data, session.user.id);
    revalidatePath("/workspace");
    return { status: "success", message: result.state === "VIDEO_APPROVED" ? "视频计划已通过人工确认，尚未生成或发布。" : "视频计划已退回修订。" };
  } catch (error) { return { status: "error", message: error instanceof Error ? error.message : "无法确认视频计划。" }; }
}
