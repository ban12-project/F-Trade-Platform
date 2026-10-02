"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "../auth";
import { hasPermission } from "../authz";
import {
  reconcileUnknownTextPublication,
  reconcileUnknownVideoPublication,
} from "../social/publication-reconciliation";
import {
  publicationReconciliationSchema,
  videoPublicationReconciliationSchema,
} from "../social/publication-reconciliation-schema";

export async function reconcilePublicationAction(input: unknown) {
  const current = await auth.api.getSession({ headers: await headers() });
  if (!current?.user || !hasPermission(current.user.role, "content:review"))
    return { ok: false as const, message: "需要登录并具有人工审核权限。" };
  const parsed = publicationReconciliationSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, message: "请核对帖子链接、依据编号和确认选项。" };
  try {
    await reconcileUnknownTextPublication(parsed.data, current.user.id);
    revalidatePath(`/workspace/${parsed.data.projectId}`);
    revalidatePath("/workspace");
    return {
      ok: true as const,
      message: "已记录人工确认。原回执已保留，渠道仍暂停；不会重新发布。",
    };
  } catch {
    return {
      ok: false as const,
      message: "核对未保存。请检查节点归属、项目权限、原任务是否停止及内容是否变化。",
    };
  }
}

export async function reconcileVideoPublicationAction(input: unknown) {
  const current = await auth.api.getSession({ headers: await headers() });
  if (!current?.user || !hasPermission(current.user.role, "content:review"))
    return { ok: false as const, message: "需要登录并具有人工审核权限。" };
  const parsed = videoPublicationReconciliationSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, message: "请核对 Reel 链接、依据编号和确认选项。" };
  try {
    await reconcileUnknownVideoPublication(parsed.data, current.user.id);
    revalidatePath(`/workspace/${parsed.data.projectId}`);
    revalidatePath("/workspace");
    return {
      ok: true as const,
      message: "已记录人工确认。原 unknown 回执和渠道暂停状态已保留；不会重新发布。",
    };
  } catch {
    return {
      ok: false as const,
      message: "核对未保存。请检查节点归属、项目权限、原任务是否停止及视频是否变化。",
    };
  }
}
