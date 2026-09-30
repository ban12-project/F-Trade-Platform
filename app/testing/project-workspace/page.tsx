import { notFound } from "next/navigation";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { WorkspaceDirtyProvider } from "@/components/workspace/dirty-state";
import { ProjectMembersPanel } from "@/components/workspace/project-members-panel";
import { WorkspaceLink } from "@/components/workspace/workspace-link";
import type { WorkspaceProjectSummary } from "@/lib/workspace/types";

const project: WorkspaceProjectSummary = {
  id: "00000000-0000-4000-8000-000000000721",
  title: "Synthetic project workspace",
  kind: "marketing",
  status: "active",
  updatedAt: new Date("2026-09-01T00:00:00Z"),
};
async function ProjectWorkspaceFixture() {
  const membersPanel = (
    <ProjectMembersPanel
      projectId={project.id}
      currentUserId="synthetic-user-owner"
      members={[
        {
          userId: "synthetic-user-owner",
          name: "Synthetic Owner",
          email: "owner@example.test",
          role: "owner",
        },
        {
          userId: "synthetic-user-viewer",
          name: "Synthetic Viewer",
          email: "viewer@example.test",
          role: "viewer",
        },
      ]}
    />
  );
  return (
    <WorkspaceDirtyProvider>
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-4xl space-y-6 p-6">
        <WorkspaceLink
          href="/workspace/projects"
          className={buttonVariants({ variant: "ghost", className: "min-h-11" })}
        >
          返回项目管理
        </WorkspaceLink>
        <h1 className="text-2xl font-semibold">{project.title}</h1>
        <p>名称、成员与归档状态</p>
        {membersPanel}
      </main>
    </WorkspaceDirtyProvider>
  );
}

export default function ProjectWorkspaceTestingPage() {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <Suspense fallback={null}>
      <ProjectWorkspaceFixture />
    </Suspense>
  );
}
