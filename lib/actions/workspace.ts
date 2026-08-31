"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import { createWorkspaceProjectSchema, saveWorkspaceCanvasSchema, type WorkspaceCanvasDocument } from "@/lib/workspace/contracts";
import { WorkspaceCanvasRevisionConflictError, createWorkspaceProject, saveWorkspaceCanvas } from "@/lib/workspace/store";

export type WorkspaceActionState = { status: "idle" | "success" | "error" | "conflict"; message: string; projectId?: string; revision?: number };
export const initialWorkspaceActionState: WorkspaceActionState = { status: "idle", message: "" };

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
