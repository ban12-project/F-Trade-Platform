import { Suspense } from "react";
import { connection } from "next/server";

import { WorkspaceCanvasSkeleton } from "@/components/workspace/workspace-canvas-skeleton";
import { WorkspaceDashboard } from "@/components/workspace/workspace-dashboard";
import { WorkspaceHub } from "@/components/workspace/workspace-hub";
import { WorkspaceSettingsPanel } from "@/components/workspace/workspace-settings-panel";
import { listStoredProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";
import { requirePermission } from "@/lib/auth-guard";
import { hasPermission } from "@/lib/authz";
import { listUnassignedInboundConversations } from "@/lib/social/inbound-routing-store";
import { listWorkspacePipeline, listWorkspaceProjects, listWorkspaceTasks } from "@/lib/workspace/store";

async function WorkspaceContent({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await connection();
  const session = await requirePermission("workspace:view");
  const canRouteInbound = hasPermission(session.user.role, "sales:write");
  const [query, projects, tasks, pipeline, inbound, settings] = await Promise.all([searchParams, listWorkspaceProjects(session.user.id), listWorkspaceTasks(session.user.id), listWorkspacePipeline(session.user.id), canRouteInbound ? listUnassignedInboundConversations() : Promise.resolve([]), listStoredProductAgentModelSettings()]);
  const settingsPanel = <WorkspaceSettingsPanel settings={settings} currentUser={session.user} canManage={hasPermission(session.user.role, "settings:manage")} />;
  return query.view === "flow" ? <WorkspaceHub projects={projects} tasks={tasks} settingsPanel={settingsPanel} /> : <WorkspaceDashboard projects={projects} tasks={tasks} pipeline={pipeline} inbound={inbound} currentTime={Date.now()} settingsPanel={settingsPanel} />;
}

export default function WorkspacePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) { return <Suspense fallback={<WorkspaceCanvasSkeleton />}><WorkspaceContent searchParams={searchParams} /></Suspense>; }
