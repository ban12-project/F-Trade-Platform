import { Suspense } from "react";
import { WorkspacePanelSkeleton } from "@/components/workspace/workspace-loading-skeleton";
import { WorkspaceSettingsPanel } from "@/components/workspace/workspace-settings-panel";
import { requirePermission } from "@/lib/auth-guard";
import { hasPermission } from "@/lib/authz";
import { readWorkspaceModelSettings } from "@/lib/workspace/read-model";
export const prefetch = "partial";
async function Settings() {
  const session = await requirePermission("workspace:view");
  const canManage = hasPermission(session.user.role, "settings:manage");
  return (
    <WorkspaceSettingsPanel
      settings={canManage ? await readWorkspaceModelSettings() : []}
      currentUser={session.user}
      canManage={canManage}
    />
  );
}
export default function Page() {
  return (
    <main id="main-content" className="mx-auto max-w-4xl p-4 sm:p-6">
      <h1 className="mb-6 text-2xl font-semibold">账号与工具</h1>
      <Suspense fallback={<WorkspacePanelSkeleton label="正在加载账号设置" />}>
        <Settings />
      </Suspense>
    </main>
  );
}
