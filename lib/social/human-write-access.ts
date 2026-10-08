import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { hasPermission, type Permission } from "@/lib/authz";
import type { DatabaseTransaction } from "@/lib/db/client";
import {
  session,
  user,
  workspaceProject,
  workspaceProjectItem,
  workspaceProjectMember,
} from "@/lib/db/schema";

const actorSchema = z
  .object({ actorId: z.string().trim().min(1), sessionId: z.string().trim().min(1) })
  .strict();
const projectSchema = actorSchema.extend({ projectId: z.uuid() }).strict();
export type SocialActorIdentity = z.infer<typeof actorSchema>;
export type SocialProjectIdentity = z.infer<typeof projectSchema>;
export const SOCIAL_HUMAN_ACCESS_MESSAGE =
  "无法确认当前登录或操作权限，本次请求未提交。请重新登录并确认项目权限后重试。";
export class SocialHumanAccessError extends Error {
  constructor() {
    super(SOCIAL_HUMAN_ACCESS_MESSAGE);
    this.name = "SocialHumanAccessError";
  }
}
export function parseSocialActorIdentity(input: unknown): SocialActorIdentity {
  const value = actorSchema.safeParse(input);
  if (!value.success) throw new SocialHumanAccessError();
  return value.data;
}
export function parseSocialProjectIdentity(
  input: unknown,
  projectId: string,
): SocialProjectIdentity {
  const value = projectSchema.safeParse(input);
  if (!value.success || value.data.projectId !== projectId) throw new SocialHumanAccessError();
  return value.data;
}

export function assertSocialAuthorizationAlive(expiresAt: Date) {
  if (expiresAt <= new Date()) throw new SocialHumanAccessError();
}

/** After business/source waits, reserve the current actor and matching session through commit. */
export async function authorizeSocialActor(
  tx: DatabaseTransaction,
  identity: SocialActorIdentity,
  permissions: readonly Permission[],
  configuredOwner = false,
) {
  const [actor] = await tx
    .select({ role: user.role, banned: user.banned, expiresAt: session.expiresAt })
    .from(user)
    .innerJoin(session, eq(session.userId, user.id))
    .where(and(eq(user.id, identity.actorId), eq(session.id, identity.sessionId)))
    .for("share");
  if (
    !actor ||
    actor.banned ||
    permissions.some((permission) => !hasPermission(actor.role, permission)) ||
    (configuredOwner && identity.actorId !== process.env.SOCIAL_FACEBOOK_OWNER_USER_ID)
  )
    throw new SocialHumanAccessError();
  assertSocialAuthorizationAlive(actor.expiresAt);
  return actor.expiresAt;
}

/** Receipts can attest past effects on archived projects; new publication requires an active project. */
export async function authorizeSocialProject(
  tx: DatabaseTransaction,
  identity: SocialProjectIdentity,
  access: "write" | "receipt",
  contentRef?: string,
  format?: "text" | "image" | "video",
) {
  const [project] = await tx
    .select({ kind: workspaceProject.kind, status: workspaceProject.status })
    .from(workspaceProject)
    .where(eq(workspaceProject.id, identity.projectId))
    .for("share");
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
  if (
    project?.kind !== "marketing" ||
    (access === "write" && project.status !== "active") ||
    !member
  )
    throw new SocialHumanAccessError();
  if (contentRef) {
    const [link] = await tx
      .select({ id: workspaceProjectItem.id })
      .from(workspaceProjectItem)
      .where(
        and(
          eq(workspaceProjectItem.projectId, identity.projectId),
          eq(workspaceProjectItem.aggregateId, contentRef),
          eq(
            workspaceProjectItem.role,
            format === "video" ? "marketing_video" : "marketing_content",
          ),
          eq(workspaceProjectItem.relation, "owned"),
        ),
      )
      .for("share");
    if (!link) throw new SocialHumanAccessError();
  }
}

const safeMessages = new Set([
  "图片和视频请在素材发布区域核对素材与目标账户后提交。",
  "内容已更新，请刷新页面、核对新预览后重新确认。",
  "项目已归档，请重开后再发起发布。",
  "渠道未启用或已暂停，不能提交发布。",
  "只有 Gate 01 已批准内容或视频可以发布。",
  "缺少当前 Gate 01 批准记录。",
  "入站消息不存在或已过期。",
  "该入站消息已完成分流，请刷新工作台。",
  "项目已归档，请重开后再写入业务资料。",
  "你没有该项目的编辑权限。",
  "该操作只能在销售机会项目中执行。",
  "只有跟进中的线索可以发送回复。",
  "该线索没有可发送的渠道会话，请先关联入站消息。",
  "该线索未关联授权可见的渠道会话。",
  "渠道未启用或已暂停，不能发送回复。",
  "没有仍在保留期内的入站消息，不能发送回复。",
  "已超过渠道回复窗口；当前 MVP 禁止发送，需人工升级处理。",
  "自由文本不能包含交期承诺；请选择交期场景，由系统插入有效的 Gate 03 结果。",
  "该场景必须先完成 Gate 03 交期确认。",
  "Gate 03 尚未批准或已经失效，不能生成交期回复。",
  "Gate 03 与当前 RFQ 不匹配，不能用于回复。",
  "Gate 03 交期确认已过期，请重新申请确认。",
]);
export function socialHumanFailureMessage(error: unknown, fallback: string) {
  if (error instanceof SocialHumanAccessError) return SOCIAL_HUMAN_ACCESS_MESSAGE;
  return error instanceof Error && safeMessages.has(error.message) ? error.message : fallback;
}
