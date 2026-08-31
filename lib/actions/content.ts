"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import { contentDraftFormSchema, contentReviewFormSchema } from "@/lib/form-schemas";
import { createContentDraft, decideContentReview, reviseContentDraft } from "@/lib/content/store";

export type ContentActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export const initialContentActionState: ContentActionState = { status: "idle", message: "" };

export async function createContentDraftAction(
  _previousState: ContentActionState,
  formData: FormData,
): Promise<ContentActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "content:write")) return { status: "error", message: "无权创建内容草稿。" };
  const parsed = contentDraftFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "内容资料格式不正确。" };
  try {
    const result = await createContentDraft(parsed.data, session.user.id);
    revalidatePath("/console/content");
    return { status: "success", message: `内容草稿已创建（${result.id.slice(0, 8)}），仍需 Gate 01 人工审核。` };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "无法创建内容草稿。" };
  }
}

export async function decideContentReviewAction(
  _previousState: ContentActionState,
  formData: FormData,
): Promise<ContentActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "content:review")) return { status: "error", message: "无权执行 Gate 01 内容审核。" };
  const parsed = contentReviewFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "审核资料格式不正确。" };
  try {
    const result = await decideContentReview(parsed.data, session.user.id);
    revalidatePath("/console/content");
    revalidatePath(`/console/content/${parsed.data.contentId}`);
    return { status: "success", message: result.state === "CONTENT_APPROVED" ? "Gate 01 已批准，内容等待官方渠道发布。" : "Gate 01 已退回，内容需要修订。" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "无法完成内容审核。" };
  }
}

export async function reviseContentDraftAction(
  _previousState: ContentActionState,
  formData: FormData,
): Promise<ContentActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "content:write")) return { status: "error", message: "无权修订内容草稿。" };
  const contentId = formData.get("contentId");
  const parsedContentId = contentReviewFormSchema.pick({ contentId: true }).safeParse({ contentId });
  if (!parsedContentId.success) return { status: "error", message: parsedContentId.error.issues[0]?.message ?? "内容记录标识无效。" };
  const parsed = contentDraftFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "内容资料格式不正确。" };
  try {
    await reviseContentDraft(parsedContentId.data.contentId, parsed.data, session.user.id);
    revalidatePath("/console/content");
    revalidatePath(`/console/content/${parsedContentId.data.contentId}`);
    revalidatePath(`/console/content/${parsedContentId.data.contentId}/revise`);
    return { status: "success", message: "内容修订已保存，并已重新提交 Gate 01 审核。" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "无法保存内容修订。" };
  }
}
