"use server";
import { after } from "next/server";
import { z } from "zod";
import { authorizedActionSession, refreshWorkspace } from "@/lib/action-boundary";
import { getDatabase } from "@/lib/db/client";
import { facebookMediaSubmitFormSchema } from "@/lib/social/facebook-account-forms";
import {
  listFacebookMarketingProjects,
  listFacebookMediaOptions,
  submitFacebookMediaPublication,
} from "@/lib/social/facebook-media-store";
import { SocialHumanAccessError, socialHumanFailureMessage } from "@/lib/social/human-write-access";
import { assertPublicPublishingAccountReady } from "@/lib/social/publishing-account-store";

async function actor() {
  const current = await authorizedActionSession("content:review");
  if (!current?.user || current.user.id !== process.env.SOCIAL_FACEBOOK_OWNER_USER_ID)
    throw new SocialHumanAccessError();
  return current;
}
export async function facebookMediaOptionsAction(projectId: unknown, contentRef: unknown) {
  return listFacebookMediaOptions(
    z.uuid().parse(projectId),
    (await actor()).user.id,
    undefined,
    z.uuid().parse(contentRef),
  );
}
export async function submitFacebookMediaAction(input: unknown) {
  try {
    const current = await actor();
    const parsed = facebookMediaSubmitFormSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, message: "请核对发布项目和素材参数。" };
    await assertPublicPublishingAccountReady(getDatabase(), parsed.data, current.user.id);
    const saved = await submitFacebookMediaPublication(parsed.data, {
      actorId: current.user.id,
      sessionId: current.session.id,
      projectId: parsed.data.projectId,
    });
    try {
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
    } catch {
      /* The committed job is recovered by authenticated dispatch. */
    }
    try {
      refreshWorkspace();
    } catch {
      /* Preserve the committed publication identity. */
    }
    return { ok: true as const, publicationId: saved.publicationId };
  } catch (error) {
    return {
      ok: false as const,
      message: socialHumanFailureMessage(
        error,
        "发布未提交。请检查素材授权、内容审核结果、项目权限、文件和渠道状态。",
      ),
    };
  }
}

export async function facebookMarketingProjectsAction() {
  const actorId = (await actor()).user.id;
  return listFacebookMarketingProjects(actorId);
}
