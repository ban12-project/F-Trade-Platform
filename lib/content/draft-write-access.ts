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

const identitySchema = z
  .object({
    actorId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    projectId: z.uuid(),
  })
  .strict();
export type ContentDraftIdentity = z.infer<typeof identitySchema>;
export const CONTENT_DRAFT_ACCESS_MESSAGE =
  "无法确认当前登录或内容编辑权限，草稿未保存。请重新登录并确认项目权限后重试。";

export class ContentDraftAccessError extends Error {
  constructor() {
    super(CONTENT_DRAFT_ACCESS_MESSAGE);
    this.name = "ContentDraftAccessError";
  }
}

export function parseContentDraftIdentity(input: unknown): ContentDraftIdentity {
  const parsed = identitySchema.safeParse(input);
  if (!parsed.success) throw new ContentDraftAccessError();
  return parsed.data;
}

/** After source locks, reserve current project and login authorization until commit. */
export async function authorizeLockedContentDraft(
  tx: DatabaseTransaction,
  identity: ContentDraftIdentity,
) {
  try {
    await assertWorkspaceProjectAccess(identity.projectId, identity.actorId, "write", tx);
    const [project] = await tx
      .select({ kind: workspaceProject.kind })
      .from(workspaceProject)
      .where(eq(workspaceProject.id, identity.projectId));
    const [actor] = await tx
      .select({ role: user.role, banned: user.banned, expiresAt: session.expiresAt })
      .from(user)
      .innerJoin(session, eq(session.userId, user.id))
      .where(and(eq(user.id, identity.actorId), eq(session.id, identity.sessionId)))
      .for("share");
    if (
      project?.kind !== "marketing" ||
      !actor ||
      actor.banned ||
      !hasPermission(actor.role, "content:write") ||
      actor.expiresAt <= new Date()
    )
      throw new ContentDraftAccessError();
  } catch {
    throw new ContentDraftAccessError();
  }
}

/** Revisions must target the content owned by the current identity's project. */
export async function authorizeOwnedContentDraft(
  tx: DatabaseTransaction,
  identity: ContentDraftIdentity,
  contentId: string,
) {
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
  if (!link) throw new ContentDraftAccessError();
  await authorizeLockedContentDraft(tx, identity);
}

/** A copy also reserves current readable source membership after its source locks. */
export async function authorizeReadableContentDraftSource(
  tx: DatabaseTransaction,
  identity: ContentDraftIdentity,
  sourceProjectId: string,
) {
  const [membership] = await tx
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
  if (!membership) throw new ContentDraftAccessError();
}

const draftMessages = new Set([
  "内容草稿只能关联到产品营销项目。",
  "只能使用当前营销项目中已核验的产品。",
  "只能引用已通过 Gate 01 的产品。",
  "只能引用匹配的已通过 Gate 01 产品。",
  "所选产品字段没有已核验的证据，不能用于内容。",
  "产品名称缺少已核验的证据，不能用于内容。",
  "内容只能复制到产品营销项目。",
  "该内容已经属于当前项目。",
  "源内容不存在或没有明确归属。",
  "源内容引用的产品已不再可用于新草稿。",
  "该内容当前不处于待修订状态。",
  "修订不能改写内容所引用的产品。请另建内容草稿。",
  "引用产品不再处于 Product Ready，不能重新送审。",
  "内容修订与另一项操作冲突，请刷新后重试。",
]);

export function contentDraftFailureMessage(
  error: unknown,
  operation: "create" | "revise" | "copy" = "create",
) {
  if (error instanceof ContentDraftAccessError) return CONTENT_DRAFT_ACCESS_MESSAGE;
  if (error instanceof Error && draftMessages.has(error.message)) return error.message;
  if (error instanceof Error && error.message.startsWith("视觉说明不能声称或描绘工程事实："))
    return "视觉说明不能声称或描绘工程事实，请核对已授权素材。";
  const action =
    operation === "revise"
      ? "保存内容修订"
      : operation === "copy"
        ? "复制内容草稿"
        : "创建内容草稿";
  return `无法${action}，请刷新并确认来源、登录与项目权限后重试。`;
}
