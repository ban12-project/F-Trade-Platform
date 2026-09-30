"use server";
import { after } from "next/server";
import { z } from "zod";
import { authorizedActionSession, refreshWorkspace } from "@/lib/action-boundary";
import {
  listFacebookMarketingProjects,
  listFacebookMediaOptions,
  submitFacebookMediaPublication,
} from "@/lib/social/facebook-media-store";

async function actor() {
  const current = await authorizedActionSession("content:review");
  if (!current?.user || current.user.id !== process.env.SOCIAL_FACEBOOK_OWNER_USER_ID)
    throw new Error("需要人工审核权限。");
  return current.user.id;
}
export async function facebookMediaOptionsAction(projectId: unknown, contentRef: unknown) {
  return listFacebookMediaOptions(
    z.uuid().parse(projectId),
    await actor(),
    undefined,
    z.uuid().parse(contentRef),
  );
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
    refreshWorkspace();
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
  return listFacebookMarketingProjects(actorId);
}
