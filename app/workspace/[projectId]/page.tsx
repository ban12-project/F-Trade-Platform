import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { ProjectMembersPanel } from "@/components/workspace/project-members-panel";
import { ProjectStagePanel } from "@/components/workspace/project-stage-panel";
import { ProjectStageTasks, ProjectWorkspace } from "@/components/workspace/project-workspace";
import {
  WorkspaceLoadingSkeleton,
  WorkspacePanelSkeleton,
} from "@/components/workspace/workspace-loading-skeleton";
import { requirePermission } from "@/lib/auth-guard";
import { listWorkspaceProjectMembers } from "@/lib/workspace/access";
import {
  readDefaultProjectStage,
  readWorkspaceProject,
  readWorkspaceTasks,
} from "@/lib/workspace/read-model";
import { type ProjectStage, projectStages, requestedProjectStage } from "@/lib/workspace/stages";

type Props = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ panel?: string; item?: string }>;
};
async function Members({ projectId, actorId }: { projectId: string; actorId: string }) {
  return (
    <ProjectMembersPanel
      projectId={projectId}
      currentUserId={actorId}
      members={await listWorkspaceProjectMembers(projectId, actorId)}
    />
  );
}
async function Tasks({
  projectId,
  actorId,
  stage,
}: {
  projectId: string;
  actorId: string;
  stage: ProjectStage;
}) {
  return (
    <ProjectStageTasks
      projectId={projectId}
      stage={stage}
      tasks={await readWorkspaceTasks(actorId, projectId)}
    />
  );
}
async function ProjectContent({ params, searchParams }: Props) {
  await connection();
  const [{ projectId }, query, session] = await Promise.all([
    params,
    searchParams,
    requirePermission("workspace:view"),
  ]);
  const project = await readWorkspaceProject(projectId, session.user.id);
  if (!project) notFound();
  const selectedId = z.uuid().safeParse(query.item).success ? query.item : undefined;
  const legacyTask =
    project.kind === "sales" && query.panel === "lead" && selectedId
      ? (await readWorkspaceTasks(session.user.id, projectId)).find(
          (task) => task.id === selectedId,
        )
      : undefined;
  const activeStage =
    requestedProjectStage(project.kind, query.panel, legacyTask?.taskType) ??
    (await readDefaultProjectStage(project, session.user.id));
  const stages = projectStages(project.kind);
  const stage = stages.find((candidate) => candidate.id === activeStage);
  if (!stage) notFound();
  return (
    <ProjectWorkspace
      project={project}
      stages={stages}
      activeStage={activeStage}
      membersPanel={
        <Suspense fallback={<span className="text-sm text-muted-foreground">正在加载成员</span>}>
          <Members projectId={projectId} actorId={session.user.id} />
        </Suspense>
      }
      tasksPanel={
        <Suspense
          key={`${projectId}:${activeStage}`}
          fallback={<WorkspacePanelSkeleton label={`正在加载${stage.label}待办`} />}
        >
          <Tasks projectId={projectId} actorId={session.user.id} stage={stage} />
        </Suspense>
      }
      panel={
        <Suspense
          key={`${projectId}:${activeStage}:${selectedId ?? ""}`}
          fallback={<WorkspacePanelSkeleton label={`正在加载${stage.label}详情`} />}
        >
          <ProjectStagePanel
            projectId={projectId}
            actorId={session.user.id}
            role={session.user.role}
            stage={activeStage}
            selectedId={selectedId}
          />
        </Suspense>
      }
    />
  );
}
export default function ProjectPage(props: Props) {
  return (
    <Suspense fallback={<WorkspaceLoadingSkeleton project />}>
      <ProjectContent {...props} />
    </Suspense>
  );
}
