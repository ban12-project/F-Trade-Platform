import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense } from "react";
import { z } from "zod";
import { ProjectMembersPanel } from "@/components/workspace/project-members-panel";
import { ProjectStagePanel } from "@/components/workspace/project-stage-panel";
import {
  ProjectStageDetails,
  ProjectStageNavigation,
  ProjectStageTasks,
  ProjectWorkspaceBadges,
  ProjectWorkspaceBody,
  ProjectWorkspaceFrame,
  ProjectWorkspaceTitle,
} from "@/components/workspace/project-workspace";
import {
  ProjectBadgesSkeleton,
  ProjectDetailsSkeleton,
  ProjectStageNavigationSkeleton,
  ProjectTasksSkeleton,
  ProjectTitleSkeleton,
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

// Adopt the reusable App Shell for this destination without changing other routes.
export const prefetch = "partial";

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
// Request-local only: every data slot verifies auth and membership through the same read.
const readProject = cache(async (params: Props["params"]) => {
  await connection();
  const [{ projectId }, session] = await Promise.all([params, requirePermission("workspace:view")]);
  const project = await readWorkspaceProject(projectId, session.user.id);
  if (!project) notFound();
  return { projectId, session, project };
});

const readStage = cache(async (params: Props["params"], searchParams: Props["searchParams"]) => {
  const [{ projectId, session, project }, query] = await Promise.all([
    readProject(params),
    searchParams,
  ]);
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
  return { projectId, session, project, selectedId, activeStage, stages, stage };
});

async function Title({ params }: Pick<Props, "params">) {
  const { project } = await readProject(params);
  return <ProjectWorkspaceTitle project={project} />;
}
async function Badges({ params }: Pick<Props, "params">) {
  const { project } = await readProject(params);
  return <ProjectWorkspaceBadges project={project} />;
}
async function ProjectMembers({ params }: Pick<Props, "params">) {
  const { projectId, session } = await readProject(params);
  return <Members projectId={projectId} actorId={session.user.id} />;
}
async function Navigation({ params, searchParams }: Props) {
  const { projectId, stages, activeStage } = await readStage(params, searchParams);
  return (
    <ProjectStageNavigation
      stages={stages}
      activeStage={activeStage}
      basePath={`/workspace/${projectId}`}
    />
  );
}
async function StageTasks({ params, searchParams }: Props) {
  const { projectId, session, activeStage, stage } = await readStage(params, searchParams);
  return (
    <Suspense
      key={`${projectId}:${activeStage}`}
      fallback={<WorkspacePanelSkeleton label={`正在加载${stage.label}待办`} />}
    >
      <Tasks projectId={projectId} actorId={session.user.id} stage={stage} />
    </Suspense>
  );
}
async function Details({ params, searchParams }: Props) {
  const { projectId, session, activeStage, stage, selectedId } = await readStage(
    params,
    searchParams,
  );
  return (
    <ProjectStageDetails
      stage={stage}
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
    <ProjectWorkspaceFrame
      title={
        <Suspense fallback={<ProjectTitleSkeleton />}>
          <Title params={props.params} />
        </Suspense>
      }
      badges={
        <Suspense fallback={<ProjectBadgesSkeleton />}>
          <Badges params={props.params} />
        </Suspense>
      }
      members={
        <Suspense fallback={<span className="text-sm text-muted-foreground">正在加载成员</span>}>
          <ProjectMembers params={props.params} />
        </Suspense>
      }
    >
      <ProjectWorkspaceBody
        navigation={
          <Suspense fallback={<ProjectStageNavigationSkeleton />}>
            <Navigation {...props} />
          </Suspense>
        }
        tasks={
          <Suspense fallback={<ProjectTasksSkeleton />}>
            <StageTasks {...props} />
          </Suspense>
        }
        details={
          <Suspense fallback={<ProjectDetailsSkeleton />}>
            <Details {...props} />
          </Suspense>
        }
      />
    </ProjectWorkspaceFrame>
  );
}
