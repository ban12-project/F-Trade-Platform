import { connection } from "next/server";
import { Suspense } from "react";
import { WorkspaceDashboard } from "@/components/workspace/workspace-dashboard";
import { WorkspaceLoadingSkeleton } from "@/components/workspace/workspace-loading-skeleton";
import { requirePermission } from "@/lib/auth-guard";
import { hasPermission } from "@/lib/authz";
import { listUnassignedInboundConversations } from "@/lib/social/inbound-routing-store";
import {
  readWorkspaceProjectOverview,
  readWorkspaceProjects,
  readWorkspaceTasks,
} from "@/lib/workspace/read-model";

type Props = { searchParams: Promise<{ view?: string }> };
export const prefetch = "partial";
async function WorkspaceContent({ searchParams }: Props) {
  await connection();
  const session = await requirePermission("workspace:view");
  const [projects, tasks, overview, inbound] = await Promise.all([
    readWorkspaceProjects(session.user.id),
    readWorkspaceTasks(session.user.id),
    readWorkspaceProjectOverview(session.user.id),
    hasPermission(session.user.role, "sales:write")
      ? listUnassignedInboundConversations()
      : Promise.resolve([]),
  ]);
  return (
    <WorkspaceDashboard
      projects={projects}
      tasks={tasks}
      overview={overview}
      inbound={inbound}
      currentTime={Date.now()}
      view={(await searchParams).view}
    />
  );
}
export default function WorkspacePage(props: Props) {
  return (
    <Suspense fallback={<WorkspaceLoadingSkeleton />}>
      <WorkspaceContent {...props} />
    </Suspense>
  );
}
