import "server-only";
import { requirePermission } from "@/lib/auth-guard";
import { hasPermission } from "@/lib/authz";
import { readWorkspaceProjects } from "@/lib/workspace/read-model";
import { NewWorkProjects } from "./new-work";
import { WorkspaceNavigation } from "./workspace-navigation";
export async function WorkspaceNavigationData() {
  const session = await requirePermission("workspace:view");
  const projects = await readWorkspaceProjects(session.user.id);
  return (
    <>
      <NewWorkProjects projects={projects} />
      <WorkspaceNavigation
        projects={projects}
        canManage={hasPermission(session.user.role, "settings:manage")}
      />
    </>
  );
}
