import { listPublishingAccounts } from "@/lib/social/publishing-account-store";
import "server-only";
import { hasPermission } from "@/lib/authz";
import { listFacebookMediaOptions } from "@/lib/social/facebook-media-store";
import { FacebookMediaPanel } from "../facebook-media-panel";

export function FacebookPublicationPrerequisitesNotice() {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      素材发布需要唯一的有效账户绑定、已启用的渠道、就绪的发布执行器和有效的发布页面审核。请在渠道设置逐项核对。
    </p>
  );
}
export async function FacebookPublication({
  projectId,
  contentRef,
  actorId,
  role,
  canWrite,
}: {
  projectId: string;
  contentRef: string;
  actorId: string;
  role?: string | null;
  canWrite: boolean;
}) {
  if (
    !canWrite ||
    !hasPermission(role, "content:review") ||
    actorId !== process.env.SOCIAL_FACEBOOK_OWNER_USER_ID
  )
    return null;
  const options = await listFacebookMediaOptions(projectId, actorId, undefined, contentRef);
  if (!options.length) return null;
  const accounts = await listPublishingAccounts(undefined, actorId);
  return (
    <FacebookMediaPanel
      projectId={projectId}
      contentRef={contentRef}
      options={options}
      channelRef={accounts[0]?.channelRef ?? ""}
      accountRef={accounts[0]?.accountRef ?? ""}
      accounts={accounts}
    />
  );
}
