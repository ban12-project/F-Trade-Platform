"use server";
import { and, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/db/client";
import { workspaceProject, workspaceProjectMember } from "@/lib/db/schema";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import { listFacebookMediaOptions, submitFacebookMediaPublication } from "@/lib/social/facebook-media-store";
async function actor() {
  const current = await auth.api.getSession({ headers: await headers() });
  if (!current?.user || !hasPermission(current.user.role, "content:review")) throw new Error("需要人工审核权限。");
  return current.user.id;
}
export async function facebookMediaOptionsAction(projectId: unknown) {
  return listFacebookMediaOptions(z.uuid().parse(projectId), await actor());
}
export async function submitFacebookMediaAction(input: unknown) {
  const actorId = await actor();
  try { return { ok: true as const, ...await submitFacebookMediaPublication(input, actorId) }; }
  catch { return { ok: false as const, message: "发布未提交。请检查素材权利、Gate 01、项目权限、私有文件和渠道状态。" }; }
}

export async function facebookMarketingProjectsAction() {
  const actorId = await actor();
  return getDatabase().select({ id: workspaceProject.id, title: workspaceProject.title }).from(workspaceProject)
    .innerJoin(workspaceProjectMember, eq(workspaceProjectMember.projectId, workspaceProject.id))
    .where(and(eq(workspaceProjectMember.userId, actorId), eq(workspaceProject.kind, "marketing"), eq(workspaceProject.status, "active")));
}
