"use server";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import { getDatabase } from "@/lib/db/client";
import { workspaceProject, workspaceProjectMember } from "@/lib/db/schema";
import {
  listFacebookMediaOptions,
  submitFacebookMediaPublication,
} from "@/lib/social/facebook-media-store";

async function actor() {
  const current = await auth.api.getSession({ headers: await headers() });
  if (
    !current?.user ||
    !hasPermission(current.user.role, "content:review") ||
    current.user.id !== process.env.SOCIAL_FACEBOOK_OWNER_USER_ID
  )
    throw new Error("需要人工审核权限。");
  return current.user.id;
}
export async function facebookMediaOptionsAction(projectId: unknown) {
  return listFacebookMediaOptions(z.uuid().parse(projectId), await actor());
}
export async function submitFacebookMediaAction(input: unknown) {
  const actorId = await actor();
  try {
    const saved = await submitFacebookMediaPublication(input, actorId);
    after(async () => {
      try {
        const { deliverPublicationSandbox } = await import(
          "@/lib/browser-fleet/sandbox-workflow-delivery"
        );
        await deliverPublicationSandbox(saved.publicationId);
      } catch {
        // The committed job is recovered by the authenticated dispatch cron.
      }
    });
    return { ok: true as const, ...saved };
  } catch {
    return {
      ok: false as const,
      message: "发布未提交。请检查素材权利、Gate 01、项目权限、私有文件和渠道状态。",
    };
  }
}

export async function facebookMarketingProjectsAction() {
  const actorId = await actor();
  return getDatabase()
    .select({ id: workspaceProject.id, title: workspaceProject.title })
    .from(workspaceProject)
    .innerJoin(workspaceProjectMember, eq(workspaceProjectMember.projectId, workspaceProject.id))
    .where(
      and(
        eq(workspaceProjectMember.userId, actorId),
        eq(workspaceProject.kind, "marketing"),
        eq(workspaceProject.status, "active"),
      ),
    );
}
