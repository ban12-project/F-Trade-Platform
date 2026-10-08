import { and, eq } from "drizzle-orm";
import { hasPermission } from "@/lib/authz";
import type { DatabaseTransaction } from "@/lib/db/client";
import { user, workspaceProjectItem } from "@/lib/db/schema";
import {
  authorizeLockedVideoDraft,
  parseVideoDraftIdentity,
  VideoDraftAccessError,
  type VideoDraftIdentity,
} from "@/lib/video/draft-write-access";
export type ProductMediaIdentity = VideoDraftIdentity;
export const parseProductMediaIdentity = parseVideoDraftIdentity;
/** ProductMedia is mutable only from its current linked marketing project. */
export async function authorizeProductMediaWrite(
  tx: DatabaseTransaction,
  identity: ProductMediaIdentity,
  productId: string,
  review = false,
) {
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
  if (!link) throw new VideoDraftAccessError();
  const expiresAt = await authorizeLockedVideoDraft(tx, identity);
  const [actor] = await tx
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, identity.actorId));
  if (!actor || !hasPermission(actor.role, review ? "product:review" : "product:write"))
    throw new VideoDraftAccessError();
  return expiresAt;
}
const messages = new Set([
  "部分证据不存在或无权用于当前项目。",
  "当前素材审核状态不允许该决定。",
  "撤销已批准素材时必须填写原因。",
  "只能为当前 ProductReady 产品登记可复用媒体。",
  "产品已不再处于 ProductReady，不能批准其媒体。",
  "产品媒体不存在。",
]);
export function productMediaFailureMessage(error: unknown) {
  if (error instanceof VideoDraftAccessError)
    return "无法确认当前登录或产品媒体权限，本次请求未提交。请重新登录并确认项目权限后重试。";
  if (error instanceof Error && messages.has(error.message)) return error.message;
  return "无法保存产品媒体，请刷新并确认资料、登录与项目权限后重试。";
}
