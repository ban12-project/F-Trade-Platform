import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { hasPermission } from "@/lib/authz";
import type { DatabaseTransaction } from "@/lib/db/client";
import { session, user, workspaceProject, workspaceProjectItem } from "@/lib/db/schema";
import { assertWorkspaceProjectAccess } from "@/lib/workspace/access";

const identitySchema = z
  .object({
    actorId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    projectId: z.uuid(),
  })
  .strict();
export type ContentReviewIdentity = z.infer<typeof identitySchema>;
export const CONTENT_REVIEW_ACCESS_MESSAGE =
  "无法确认当前登录或 Gate 01 内容审核权限，审核决定未保存。请重新登录并确认项目权限后重试。";

export class ContentReviewAccessError extends Error {
  constructor() {
    super(CONTENT_REVIEW_ACCESS_MESSAGE);
    this.name = "ContentReviewAccessError";
  }
}

export function parseContentReviewIdentity(input: unknown): ContentReviewIdentity {
  const parsed = identitySchema.safeParse(input);
  if (!parsed.success) throw new ContentReviewAccessError();
  return parsed.data;
}

/** Called after the review's business locks; holds authorization until commit. */
export async function authorizeLockedContentReview(
  tx: DatabaseTransaction,
  identity: ContentReviewIdentity,
  contentId: string,
) {
  try {
    await assertWorkspaceProjectAccess(identity.projectId, identity.actorId, "write", tx);
    const [project] = await tx
      .select({ kind: workspaceProject.kind })
      .from(workspaceProject)
      .where(eq(workspaceProject.id, identity.projectId));
    const [link] = await tx
      .select({ id: workspaceProjectItem.id })
      .from(workspaceProjectItem)
      .where(
        and(
          eq(workspaceProjectItem.projectId, identity.projectId),
          eq(workspaceProjectItem.aggregateId, contentId),
          eq(workspaceProjectItem.role, "marketing_content"),
          eq(workspaceProjectItem.relation, "owned"),
        ),
      )
      .for("share");
    const [actor] = await tx
      .select({ role: user.role, banned: user.banned, expiresAt: session.expiresAt })
      .from(user)
      .innerJoin(session, eq(session.userId, user.id))
      .where(and(eq(user.id, identity.actorId), eq(session.id, identity.sessionId)))
      .for("share");
    // Time is evaluated after project/content/Gate and authorization lock waits.
    if (
      project?.kind !== "marketing" ||
      !link ||
      !actor ||
      actor.banned ||
      !hasPermission(actor.role, "content:review") ||
      actor.expiresAt <= new Date()
    )
      throw new ContentReviewAccessError();
    return actor.expiresAt;
  } catch {
    throw new ContentReviewAccessError();
  }
}

const reviewMessages = new Set([
  "内容已更新，请刷新后重新审核当前版本。",
  "该内容当前不处于待审核状态。",
  "未找到待处理的 Gate 01 内容审核请求。",
  "审核请求已更新，请刷新后重新审核。",
  "内容审核与另一项操作冲突，请刷新后重试。",
  "部分证据不存在或无权用于当前项目。",
]);

/** Display controlled guidance, never database details or raw content values. */
export function contentReviewFailureMessage(error: unknown) {
  if (error instanceof ContentReviewAccessError) return CONTENT_REVIEW_ACCESS_MESSAGE;
  if (error instanceof Error && reviewMessages.has(error.message)) return error.message;
  return "无法完成内容审核，请刷新并确认来源、登录与项目权限后重试。";
}
