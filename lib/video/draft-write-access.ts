import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { hasPermission } from "@/lib/authz";
import type { Database, DatabaseTransaction } from "@/lib/db/client";
import {
  session,
  user,
  workspaceProject,
  workspaceProjectItem,
  workspaceProjectMember,
} from "@/lib/db/schema";
import { assertWorkspaceProjectAccess } from "@/lib/workspace/access";

const identitySchema = z
  .object({
    actorId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    projectId: z.uuid(),
  })
  .strict();
export type VideoDraftIdentity = z.infer<typeof identitySchema>;
export const VIDEO_DRAFT_ACCESS_MESSAGE =
  "无法确认当前登录或视频编辑权限，本次请求未提交。请重新登录并确认项目权限后重试。";
export class VideoDraftAccessError extends Error {
  constructor() {
    super(VIDEO_DRAFT_ACCESS_MESSAGE);
    this.name = "VideoDraftAccessError";
  }
}
export function parseVideoDraftIdentity(input: unknown): VideoDraftIdentity {
  const parsed = identitySchema.safeParse(input);
  if (!parsed.success) throw new VideoDraftAccessError();
  return parsed.data;
}

/** Call after source waits; reserve current writer until transaction commit. */
export async function authorizeLockedVideoDraft(
  tx: DatabaseTransaction,
  identity: VideoDraftIdentity,
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
    const [actor] = await tx
      .select({ role: user.role, banned: user.banned, expiresAt: session.expiresAt })
      .from(user)
      .innerJoin(session, eq(session.userId, user.id))
      .where(and(eq(user.id, identity.actorId), eq(session.id, identity.sessionId)))
      .for("share");
    if (
      project?.kind !== "marketing" ||
      !member ||
      !actor ||
      actor.banned ||
      !hasPermission(actor.role, "video:write") ||
      actor.expiresAt <= new Date()
    )
      throw new VideoDraftAccessError();
    return actor.expiresAt;
  } catch {
    throw new VideoDraftAccessError();
  }
}

export async function authorizeOwnedVideoDraft(
  tx: DatabaseTransaction,
  identity: VideoDraftIdentity,
  videoId: string,
) {
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
  if (!link) throw new VideoDraftAccessError();
  return authorizeLockedVideoDraft(tx, identity);
}

/** Copy sources are readable by viewers; membership must survive all source waits. */
export async function authorizeReadableVideoDraftSource(
  tx: DatabaseTransaction,
  identity: VideoDraftIdentity,
  sourceProjectId: string,
) {
  const [member] = await tx
    .select({ id: workspaceProjectMember.id })
    .from(workspaceProjectMember)
    .where(
      and(
        eq(workspaceProjectMember.projectId, sourceProjectId),
        eq(workspaceProjectMember.userId, identity.actorId),
        inArray(workspaceProjectMember.role, ["owner", "editor", "viewer"]),
      ),
    )
    .for("share");
  if (!member) throw new VideoDraftAccessError();
}

export async function assertCurrentVideoDraftWriter(
  identityInput: VideoDraftIdentity,
  database: Database,
) {
  const identity = parseVideoDraftIdentity(identityInput);
  await database.transaction(async (tx) => {
    await authorizeLockedVideoDraft(tx, identity);
  });
}

const messages = new Set([
  "当前视频状态不能提交处理任务。",
  "只能使用当前营销项目中已关联的产品。",
  "只能从已通过 Gate 01 的产品创建营销视频。",
  "所选互联网素材已不可用，请重新检索。",
  "互联网素材服务暂时不可用，请稍后重试。",
  "请上传至少一个营销素材。",
  "部分上传回执不存在或不属于当前项目。",
  "上传回执已过期，请重新上传素材。",
  "素材上传状态已发生变化。",
  "视频只能复制到产品营销项目。",
  "该视频已经属于当前项目。",
  "源视频不存在或没有明确归属。",
  "只能复制 MVP1 营销剪辑项目。",
  "源视频引用的产品已不再可用于新草稿。",
  "当前视频状态不能修改剪辑稿。",
  "剪辑稿引用了不属于当前视频的素材。",
  "剪辑稿引用了未经核验的产品事实。",
]);
export function videoDraftFailureMessage(
  error: unknown,
  operation: "save" | "copy" | "render" | "create" | "generate" | "search" | "upload" = "save",
) {
  if (error instanceof VideoDraftAccessError) return VIDEO_DRAFT_ACCESS_MESSAGE;
  if (error instanceof Error && messages.has(error.message)) return error.message;
  const action = {
    copy: "复制营销视频",
    render: "合成营销视频",
    save: "保存剪辑稿",
    create: "创建营销视频",
    generate: "生成 AI 剪辑初稿",
    search: "检索互联网素材",
    upload: "认领营销素材",
  }[operation];
  return `无法${action}，请刷新并确认来源、登录与项目权限后重试。`;
}
