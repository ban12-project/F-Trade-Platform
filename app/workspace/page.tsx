import { connection } from "next/server";
import { Suspense } from "react";
import { WorkspaceDashboard } from "@/components/workspace/workspace-dashboard";
import { WorkspaceLoadingSkeleton } from "@/components/workspace/workspace-loading-skeleton";
import { requirePermission } from "@/lib/auth-guard";
import { hasPermission } from "@/lib/authz";
import { listUnassignedInboundConversations } from "@/lib/social/inbound-routing-store";
import { readWorkspaceProjects, readWorkspaceTasks } from "@/lib/workspace/read-model";
import { listWorkspacePipeline } from "@/lib/workspace/store";

async function WorkspaceContent() {
  await connection();
  const session = await requirePermission("workspace:view");
  const [projects, tasks, pipeline, inbound] = await Promise.all([
    readWorkspaceProjects(session.user.id),
    readWorkspaceTasks(session.user.id),
    listWorkspacePipeline(session.user.id),
    hasPermission(session.user.role, "sales:write")
      ? listUnassignedInboundConversations()
      : Promise.resolve([]),
  ]);
  return (
    <WorkspaceDashboard
      projects={projects}
      tasks={tasks}
      pipeline={pipeline}
      inbound={inbound}
      currentTime={Date.now()}
    />
  );
}
export default function WorkspacePage() {
  return (
    <Suspense fallback={<WorkspaceLoadingSkeleton />}>
      <WorkspaceContent />
    </Suspense>
  );
}
