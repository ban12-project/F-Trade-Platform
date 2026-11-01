"use server";
import { after } from "next/server";
import { authorizedActionSession, refreshWorkspace } from "@/lib/action-boundary";
import { socialHumanFailureMessage } from "@/lib/social/human-write-access";
import { publicationBatchSchema } from "@/lib/social/publication-batch-schema";
import { submitPublicationBatch } from "@/lib/social/publication-batch-store";
export async function submitPublicationBatchAction(input: unknown) {
  try {
    const value = publicationBatchSchema.parse(input);
    const current = await authorizedActionSession(
      value.content.format === "text" ? "content:write" : "content:review",
    );
    if (!current) return { ok: false as const, message: "登录已失效，请重新登录后继续。" };
    const results = await submitPublicationBatch(value, {
      actorId: current.user.id,
      sessionId: current.session.id,
      projectId: value.content.projectId,
    });
    try {
      after(async () => {
        const { deliverPublicationSandbox } = await import(
          "@/lib/browser-fleet/sandbox-workflow-delivery"
        );
        await Promise.allSettled(
          results.map((result) => deliverPublicationSandbox(result.publicationId)),
        );
      });
      refreshWorkspace();
    } catch {
      /* Committed jobs remain durable and are recovered by polling. */
    }
    return { ok: true as const, results };
  } catch (error) {
    return {
      ok: false as const,
      message: socialHumanFailureMessage(
        error,
        "本批发布未提交。内容或账号状态已变化，请查看账号状态后继续；已选内容和账号已保留。",
      ),
    };
  }
}
