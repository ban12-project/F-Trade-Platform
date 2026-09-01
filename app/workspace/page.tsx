import { Suspense } from "react";
import { connection } from "next/server";

import { WorkspaceCanvasSkeleton } from "@/components/workspace/workspace-canvas-skeleton";
import { WorkspaceHub } from "@/components/workspace/workspace-hub";
import { WorkspaceSettingsPanel } from "@/components/workspace/workspace-settings-panel";
import { listStoredProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";
import { requirePermission } from "@/lib/auth-guard";
import { hasPermission } from "@/lib/authz";
import { listWorkspaceProjects, listWorkspaceTasks } from "@/lib/workspace/store";

async function WorkspaceContent() {
  await connection();
  const [session, projects, tasks, settings] = await Promise.all([requirePermission("workspace:view"), listWorkspaceProjects(), listWorkspaceTasks(), listStoredProductAgentModelSettings()]);
  return <WorkspaceHub projects={projects} tasks={tasks} settingsPanel={<WorkspaceSettingsPanel settings={settings} canManage={hasPermission(session.user.role, "settings:manage")} />} />;
}

export default function WorkspacePage() { return <Suspense fallback={<WorkspaceCanvasSkeleton />}><WorkspaceContent /></Suspense>; }
