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
export type ProductReviewIdentity = z.infer<typeof identitySchema>;
export const PRODUCT_REVIEW_ACCESS_MESSAGE =
  "无法确认当前登录或 Gate 01 审核权限，审核决定未保存。请重新登录并确认项目权限后重试。";

export class ProductReviewAccessError extends Error {
  constructor() {
    super(PRODUCT_REVIEW_ACCESS_MESSAGE);
    this.name = "ProductReviewAccessError";
  }
}

export function parseProductReviewIdentity(input: unknown): ProductReviewIdentity {
  const parsed = identitySchema.safeParse(input);
  if (!parsed.success) throw new ProductReviewAccessError();
  return parsed.data;
}

/** Called after the review's business locks; holds authorization until commit. */
export async function authorizeLockedProductReview(
  tx: DatabaseTransaction,
  identity: ProductReviewIdentity,
  productId: string,
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
          eq(workspaceProjectItem.aggregateId, productId),
          eq(workspaceProjectItem.role, "product_source"),
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
    // Time is evaluated after project/product/Gate and authorization lock waits.
    if (
      project?.kind !== "marketing" ||
      !link ||
      !actor ||
      actor.banned ||
      !hasPermission(actor.role, "product:review") ||
      actor.expiresAt <= new Date()
    )
      throw new ProductReviewAccessError();
    return actor.expiresAt;
  } catch {
    throw new ProductReviewAccessError();
  }
}

const reviewMessages = new Set([
  "资料仍在生成中，可先核对字段；生成结束后才能提交审核决定。",
  "产品草稿不存在。",
  "产品资料已更新，请刷新并重新审核当前版本。",
  "该产品当前不处于待审核状态。",
  "未找到待处理的 Gate 01 审核请求。",
  "审核请求已变更，请刷新并重新审核当前版本。",
  "请先核对原始产品图片，并明确确认与当前产品一致。无法确认时请退回。",
  "产品审核与另一项操作冲突，请刷新后重试。",
]);

/** Display controlled guidance, never database details or raw product values. */
export function productReviewFailureMessage(error: unknown) {
  if (error instanceof ProductReviewAccessError) return PRODUCT_REVIEW_ACCESS_MESSAGE;
  if (error instanceof Error && reviewMessages.has(error.message)) return error.message;
  if (error instanceof Error && error.message.startsWith("Product cannot be Ready:"))
    return "产品事实或逐字段证据尚未完整核验，请补齐资料后重新审核。";
  return "无法完成 Gate 01 审核，请刷新并确认来源、登录与项目权限后重试。";
}
