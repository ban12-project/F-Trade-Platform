import "server-only";
import { hasPermission } from "@/lib/authz";
import {
  listFacebookMediaOptions,
  resolveFacebookMediaSubmissionScope,
} from "@/lib/social/facebook-media-store";
import { FacebookMediaPanel } from "../facebook-media-panel";
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
  try {
    const scope = await resolveFacebookMediaSubmissionScope(actorId);
    return (
      <FacebookMediaPanel
        key={
          scope.channelRef +
          ":" +
          scope.accountRef +
          ":" +
          options.map((option) => option.previewDigest).join(":")
        }
        projectId={projectId}
        contentRef={contentRef}
        options={options}
        channelRef={scope.channelRef}
        accountRef={scope.accountRef}
      />
    );
  } catch {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        素材发布等待有效的账户与渠道连接。请在渠道设置核对状态。
      </p>
    );
  }
}
