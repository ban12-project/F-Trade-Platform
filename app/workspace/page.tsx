import { Suspense } from "react";
import { connection } from "next/server";

import { WorkspaceLoadingSkeleton } from "@/components/workspace/workspace-loading-skeleton";
import { WorkspaceDashboard } from "@/components/workspace/workspace-dashboard";
import { WorkspaceSettingsPanel } from "@/components/workspace/workspace-settings-panel";
import { listStoredProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";
import { requirePermission } from "@/lib/auth-guard";
import { hasPermission } from "@/lib/authz";
import { listUnassignedInboundConversations } from "@/lib/social/inbound-routing-store";
import { listWorkspacePipeline, listWorkspaceProjects, listWorkspaceTasks } from "@/lib/workspace/store";

async function WorkspaceContent() {
  await connection();
  const session = await requirePermission("workspace:view");
  const canRouteInbound = hasPermission(session.user.role, "sales:write");
  const [projects, tasks, pipeline, inbound, settings] = await Promise.all([
    listWorkspaceProjects(session.user.id),
    listWorkspaceTasks(session.user.id),
    listWorkspacePipeline(session.user.id),
    canRouteInbound ? listUnassignedInboundConversations() : Promise.resolve([]),
    listStoredProductAgentModelSettings(),
  ]);
  const settingsPanel = <WorkspaceSettingsPanel settings={settings} currentUser={session.user} canManage={hasPermission(session.user.role, "settings:manage")} />;
  return <WorkspaceDashboard projects={projects} tasks={tasks} pipeline={pipeline} inbound={inbound} currentTime={Date.now()} settingsPanel={settingsPanel} />;
}

export default function WorkspacePage() {
  return <Suspense fallback={<WorkspaceLoadingSkeleton />}><WorkspaceContent /></Suspense>;
}
