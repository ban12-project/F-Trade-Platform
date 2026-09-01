"use server";

import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import { submitApprovedVideoJob, videoJobSubmissionSchema } from "@/lib/video/submission";
import { assertVideoGenerationEnabled } from "@/lib/video/mvp-policy";

export type VideoJobSubmissionActionState = {
  status: "idle" | "success" | "error";
  message: string;
  jobId?: string;
};

export const initialVideoJobSubmissionActionState: VideoJobSubmissionActionState = { status: "idle", message: "" };

function value(formData: FormData, name: string) {
  const item = formData.get(name);
  return typeof item === "string" ? item : "";
}

export async function submitApprovedVideoJobAction(
  _previousState: VideoJobSubmissionActionState,
  formData: FormData,
): Promise<VideoJobSubmissionActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "video:write")) return { status: "error", message: "无权提交视频生成任务。" };
  try { assertVideoGenerationEnabled(); } catch (error) { return { status: "error", message: error instanceof Error ? error.message : "视频生成能力当前未启用。" }; }
  const parsed = videoJobSubmissionSchema.safeParse({
    videoId: value(formData, "videoId"),
    provider: value(formData, "provider"),
    modelId: value(formData, "modelId"),
    requiredCapabilities: formData.getAll("requiredCapabilities").filter((item): item is string => typeof item === "string"),
    aspectRatio: value(formData, "aspectRatio"),
    durationSeconds: Number(value(formData, "durationSeconds")),
    resolution: value(formData, "resolution"),
    expectedCostCents: Number(value(formData, "expectedCostCents")),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "视频生成请求无效。" };
  try {
    const job = await submitApprovedVideoJob(parsed.data, session.user.id);
    return { status: "success", message: "视频生成任务已排队，仍需受控 worker 执行。", jobId: job.id };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "无法提交视频生成任务。" };
  }
}
