import "server-only";
import { Suspense } from "react";
import { requirePermission } from "@/lib/auth-guard";
import { hasPermission } from "@/lib/authz";
import {
  readWorkspaceModelSettings,
  readWorkspaceProjects,
  readWorkspaceTasks,
} from "@/lib/workspace/read-model";
import { WorkspaceActionDock } from "./workspace-action-dock";
import { WorkspacePanelSkeleton } from "./workspace-loading-skeleton";
import { WorkspaceSettingsPanel } from "./workspace-settings-panel";

async function Settings({ session }: { session: Awaited<ReturnType<typeof requirePermission>> }) {
  const settings = await readWorkspaceModelSettings();
  return (
    <WorkspaceSettingsPanel
      settings={settings}
      currentUser={session.user}
      canManage={hasPermission(session.user.role, "settings:manage")}
    />
  );
}
export async function WorkspaceDockData() {
  const session = await requirePermission("workspace:view");
  const [projects, tasks] = await Promise.all([
    readWorkspaceProjects(session.user.id),
    readWorkspaceTasks(session.user.id),
  ]);
  return (
    <WorkspaceActionDock
      projects={projects}
      tasks={tasks}
      settingsPanel={
        <Suspense fallback={<WorkspacePanelSkeleton label="正在加载账号与工具" />}>
          <Settings session={session} />
        </Suspense>
      }
    />
  );
}
