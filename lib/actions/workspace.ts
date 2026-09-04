"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import { createWorkspaceProjectSchema, saveWorkspaceCanvasSchema, type WorkspaceCanvasDocument } from "@/lib/workspace/contracts";
import { WorkspaceCanvasRevisionConflictError, createWorkspaceProject, linkReadyProductToSalesProject, saveWorkspaceCanvas } from "@/lib/workspace/store";
import { upsertWorkspaceProjectMember, workspaceMemberFormSchema } from "@/lib/workspace/access";

export type WorkspaceActionState = { status: "idle" | "success" | "error" | "conflict"; message: string; projectId?: string; revision?: number };

async function requireWorkspaceUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !hasPermission(session.user.role, "workspace:view")) throw new Error("无权访问项目工作区。");
  return session;
}

export async function createWorkspaceProjectAction(_previous: WorkspaceActionState, formData: FormData): Promise<WorkspaceActionState> {
  try {
    const session = await requireWorkspaceUser();
    const parsed = createWorkspaceProjectSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "项目资料无效。" };
    const project = await createWorkspaceProject(parsed.data, session.user.id);
    revalidatePath("/workspace");
    return { status: "success", message: "项目已创建。", projectId: project.id, revision: project.revision };
  } catch (error) { return { status: "error", message: error instanceof Error ? error.message : "无法创建项目。" }; }
}

export async function saveWorkspaceCanvasAction(projectId: string, input: { expectedRevision: number; document: WorkspaceCanvasDocument }): Promise<WorkspaceActionState> {
  try {
    const session = await requireWorkspaceUser();
    const parsed = saveWorkspaceCanvasSchema.safeParse(input);
    if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "画布数据无效。" };
    const project = await saveWorkspaceCanvas(projectId, parsed.data, session.user.id);
    revalidatePath(`/workspace/${projectId}`);
    return { status: "success", message: "项目画布已保存。", revision: project.revision };
  } catch (error) {
    if (error instanceof WorkspaceCanvasRevisionConflictError) return { status: "conflict", message: error.message };
    return { status: "error", message: error instanceof Error ? error.message : "无法保存项目画布。" };
  }
}

export async function linkReadyProductToSalesProjectAction(projectIdInput: string, productIdInput: string): Promise<WorkspaceActionState> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session || !hasPermission(session.user.role, "sales:write")) throw new Error("无权为销售项目引用产品。");
    const projectId = z.uuid("项目标识无效。").parse(projectIdInput);
    const productId = z.uuid("产品记录标识无效。").parse(productIdInput);
    await linkReadyProductToSalesProject(projectId, productId, session.user.id);
    revalidatePath(`/workspace/${projectId}`);
    return { status: "success", message: "已引用 Product Ready，不会复制或改写产品事实。", projectId };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "无法引用产品。" };
  }
}

export async function upsertWorkspaceProjectMemberAction(_previous: WorkspaceActionState, formData: FormData): Promise<WorkspaceActionState> {
  try {
    const session = await requireWorkspaceUser();
    const parsed = workspaceMemberFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "成员资料无效。" };
    await upsertWorkspaceProjectMember(parsed.data, session.user.id);
    revalidatePath(`/workspace/${parsed.data.projectId}`);
    return { status: "success", message: "项目成员角色已保存。", projectId: parsed.data.projectId };
  } catch (error) { return { status: "error", message: error instanceof Error ? error.message : "无法保存项目成员。" }; }
}
