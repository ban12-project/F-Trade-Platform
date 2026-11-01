import { listPublishingAccounts } from "@/lib/social/publishing-account-store";
import "server-only";
import { hasPermission } from "@/lib/authz";
import { listFacebookMediaOptions } from "@/lib/social/facebook-media-store";
import { FacebookMediaPanel } from "../facebook-media-panel";

export function FacebookPublicationPrerequisitesNotice() {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      请从已审核内容选择正文和素材，再选择发布账号。系统会检查登录、授权和发布条件；需要处理时会显示对应账号的入口。
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
