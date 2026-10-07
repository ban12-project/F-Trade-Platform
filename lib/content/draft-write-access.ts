import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { hasPermission } from "@/lib/authz";
import type { DatabaseTransaction } from "@/lib/db/client";
import { session, user, workspaceProject } from "@/lib/db/schema";
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

const draftMessages = new Set([
  "内容草稿只能关联到产品营销项目。",
  "只能使用当前营销项目中已核验的产品。",
  "只能引用已通过 Gate 01 的产品。",
  "只能引用匹配的已通过 Gate 01 产品。",
  "所选产品字段没有已核验的证据，不能用于内容。",
  "产品名称缺少已核验的证据，不能用于内容。",
]);

export function contentDraftFailureMessage(error: unknown) {
  if (error instanceof ContentDraftAccessError) return CONTENT_DRAFT_ACCESS_MESSAGE;
  if (error instanceof Error && draftMessages.has(error.message)) return error.message;
  if (error instanceof Error && error.message.startsWith("视觉说明不能声称或描绘工程事实："))
    return "视觉说明不能声称或描绘工程事实，请核对已授权素材。";
  return "无法创建内容草稿，请刷新并确认来源、登录与项目权限后重试。";
}
