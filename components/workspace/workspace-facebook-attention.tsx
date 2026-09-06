import { requirePermission } from "@/lib/auth-guard";
import { hasPermission } from "@/lib/authz";
import { FacebookAttentionNotice } from "./facebook-attention-notice";
export async function WorkspaceFacebookAttention() {
  const current = await requirePermission("workspace:view");
  if (
    current.user.id !== process.env.SOCIAL_FACEBOOK_OWNER_USER_ID ||
    !hasPermission(current.user.role, "settings:manage")
  )
    return null;
  return <FacebookAttentionNotice />;
}
