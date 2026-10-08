import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { hasPermission } from "@/lib/authz";
import type { DatabaseTransaction } from "@/lib/db/client";
import {
  session,
  user,
  workspaceProject,
  workspaceProjectItem,
  workspaceProjectMember,
} from "@/lib/db/schema";
import { assertWorkspaceProjectAccess } from "@/lib/workspace/access";
import { VIDEO_RETENTION_MESSAGE } from "./retention-policy";

const identitySchema = z
  .object({
    actorId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    projectId: z.uuid(),
  })
  .strict();
export type VideoReviewIdentity = z.infer<typeof identitySchema>;
export const VIDEO_REVIEW_ACCESS_MESSAGE =
  "无法确认当前登录或视频审核权限，审核决定未保存。请重新登录并确认项目权限后重试。";

export class VideoReviewAccessError extends Error {
  constructor() {
    super(VIDEO_REVIEW_ACCESS_MESSAGE);
    this.name = "VideoReviewAccessError";
  }
}

export function parseVideoReviewIdentity(input: unknown): VideoReviewIdentity {
  const parsed = identitySchema.safeParse(input);
  if (!parsed.success) throw new VideoReviewAccessError();
  return parsed.data;
}

/** Recheck after video/Gate/product/media waits and hold authorization to commit. */
export async function authorizeLockedVideoReview(
  tx: DatabaseTransaction,
  identity: VideoReviewIdentity,
  videoId: string,
) {
  try {
    await assertWorkspaceProjectAccess(identity.projectId, identity.actorId, "write", tx);
    const [project] = await tx
      .select({ kind: workspaceProject.kind })
      .from(workspaceProject)
      .where(eq(workspaceProject.id, identity.projectId));
    const [member] = await tx
      .select({ id: workspaceProjectMember.id })
      .from(workspaceProjectMember)
      .where(
        and(
          eq(workspaceProjectMember.projectId, identity.projectId),
          eq(workspaceProjectMember.userId, identity.actorId),
          inArray(workspaceProjectMember.role, ["owner", "editor"]),
        ),
      )
      .for("share");
    const [link] = await tx
      .select({ id: workspaceProjectItem.id })
      .from(workspaceProjectItem)
      .where(
        and(
          eq(workspaceProjectItem.projectId, identity.projectId),
          eq(workspaceProjectItem.aggregateId, videoId),
          eq(workspaceProjectItem.role, "marketing_video"),
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
    if (
      project?.kind !== "marketing" ||
      !member ||
      !link ||
      !actor ||
      actor.banned ||
      !hasPermission(actor.role, "content:review") ||
      actor.expiresAt <= new Date()
    )
      throw new VideoReviewAccessError();
    return actor.expiresAt;
  } catch {
    throw new VideoReviewAccessError();
  }
}

const reviewMessages = new Set([
  VIDEO_RETENTION_MESSAGE,
  "该视频计划当前不处于待确认状态。",
  "未找到待处理的视频事实确认请求。",
  "视频确认与另一项操作冲突，请刷新后重试。",
  "成片缺少真实媒体校验记录，必须重新合成后才能批准。",
  "部分证据不存在或无权用于当前项目。",
]);

/** Unknown database/source errors must not disclose private facts or references. */
export function videoReviewFailureMessage(error: unknown) {
  if (error instanceof VideoReviewAccessError) return VIDEO_REVIEW_ACCESS_MESSAGE;
  if (error instanceof Error && reviewMessages.has(error.message)) return error.message;
  return "无法完成视频审核，请刷新并确认来源、登录与项目权限后重试。";
}
