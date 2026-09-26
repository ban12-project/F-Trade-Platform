import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense } from "react";
import { z } from "zod";
import { ProjectMembersPanel } from "@/components/workspace/project-members-panel";
import { ProjectStagePanel } from "@/components/workspace/project-stage-panel";
import { ProjectStatusControl } from "@/components/workspace/project-status-control";
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
import { isWorkspaceRecordKind } from "@/lib/workspace/navigation";
import {
  readDefaultProjectStage,
  readLegacyLeadTaskType,
  readWorkspaceLibrary,
  readWorkspaceProject,
  readWorkspaceTasks,
} from "@/lib/workspace/read-model";
import { type ProjectStage, projectStages, requestedProjectStage } from "@/lib/workspace/stages";
import { RecordSelection } from "./record-selection";

export type ProjectPageProps = {
  params: Promise<{ projectId: string; kind?: string; recordId?: string }>;
  mode?: "record" | "create";
  searchParams: Promise<{
    panel?: string;
    item?: string;
    lead?: string;
    product?: string;
    rfq?: string;
  }>;
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
const readProject = cache(async (params: ProjectPageProps["params"]) => {
  await connection();
  const [{ projectId }, session] = await Promise.all([params, requirePermission("workspace:view")]);
  if (!z.uuid().safeParse(projectId).success) notFound();
  const project = await readWorkspaceProject(projectId, session.user.id);
  if (!project) notFound();
  return { projectId, session, project };
});

const readStage = cache(
  async (
    params: ProjectPageProps["params"],
    searchParams: ProjectPageProps["searchParams"],
    mode?: ProjectPageProps["mode"],
  ) => {
    let [{ projectId, session, project }, query] = await Promise.all([
      readProject(params),
      searchParams,
    ]);
    const route = await params;
    if (mode && (!route.kind || !isWorkspaceRecordKind(route.kind))) notFound();
    if (mode === "create" && !["product", "content", "rfq", "quotation"].includes(route.kind ?? ""))
      notFound();
    // The path is authoritative on a record route. Conflicting queries must not silently select another record.
    const routeQuery = mode
      ? { ...query, panel: route.kind, item: mode === "record" ? route.recordId : undefined }
      : query;
    const invalidSelection =
      [query.item, query.lead, query.product, query.rfq].filter((value) => value !== undefined)
        .length > 1 ||
      Object.entries(query).some(
        ([key, value]) =>
          ["item", "lead", "product", "rfq"].includes(key) &&
          value !== undefined &&
          !z.uuid().safeParse(value).success,
      ) ||
      (mode === "record" && !z.uuid().safeParse(route.recordId).success) ||
      (mode !== undefined && query.item !== undefined && query.item !== routeQuery.item) ||
      (mode === "record" &&
        [query.lead, query.product, query.rfq].some((value) => value !== undefined)) ||
      (query.product !== undefined && routeQuery.panel !== "content") ||
      (query.rfq !== undefined && routeQuery.panel !== "quotation") ||
      (query.lead !== undefined && routeQuery.panel !== "rfq");
    query = routeQuery;
    let selectedId = z.uuid().safeParse(query.item).success ? query.item : undefined;
    let selectedLeadId = z.uuid().safeParse(query.lead).success ? query.lead : undefined;
    const selectedProductId = z.uuid().safeParse(query.product).success ? query.product : undefined;
    const selectedRfqId = z.uuid().safeParse(query.rfq).success ? query.rfq : undefined;
    const legacyTaskType =
      project.kind === "sales" && query.panel === "lead" && selectedId
        ? await readLegacyLeadTaskType(session.user.id, projectId, selectedId)
        : undefined;
    if (legacyTaskType === "rfq" && mode !== "record") {
      selectedLeadId = selectedId;
      selectedId = undefined;
    }
    const referenceProduct =
      mode === "record" && query.panel === "product" && project.kind === "sales";
    if (mode && !referenceProduct && !requestedProjectStage(project.kind, query.panel)) notFound();
    const activeStage =
      (referenceProduct ? "product" : undefined) ??
      requestedProjectStage(
        project.kind,
        query.panel,
        mode === "record" && legacyTaskType === "rfq" ? undefined : legacyTaskType,
      ) ??
      (await readDefaultProjectStage(project, session.user.id));
    const stages = referenceProduct
      ? [
          ...projectStages(project.kind),
          {
            id: "product",
            panelKind: "product",
            label: "引用的产品",
            description: "查看已核验的产品来源。",
            href: selectedId
              ? `/workspace/${projectId}/records/product/${selectedId}`
              : `/workspace/products?project=${projectId}`,
          },
        ]
      : projectStages(project.kind);
    const stage = stages.find((candidate) => candidate.id === activeStage);
    if (!stage) notFound();
    return {
      projectId,
      session,
      project,
      selectedId,
      selectedLeadId,
      selectedProductId,
      selectedRfqId,
      activeStage,
      stages,
      stage,
      invalidSelection,
      recordOwned:
        !selectedId ||
        (await readWorkspaceLibrary(session.user.id)).some(
          (row) => row.projectId === projectId && row.id === selectedId && row.relation === "owned",
        ),
    };
  },
);

async function Title({ params }: Pick<ProjectPageProps, "params">) {
  const { project } = await readProject(params);
  return <ProjectWorkspaceTitle project={project} />;
}
async function Badges({ params }: Pick<ProjectPageProps, "params">) {
  const { project } = await readProject(params);
  return <ProjectWorkspaceBadges project={project} />;
}
async function ProjectMembers({ params }: Pick<ProjectPageProps, "params">) {
  const { projectId, project, session } = await readProject(params);
  return (
    <>
      {project.memberRole === "owner" ? (
        <ProjectStatusControl projectId={projectId} status={project.status} />
      ) : null}
      <Members projectId={projectId} actorId={session.user.id} />
    </>
  );
}
async function Navigation({ params, searchParams, mode }: ProjectPageProps) {
  const { projectId, stages, activeStage } = await readStage(params, searchParams, mode);
  return (
    <ProjectStageNavigation
      stages={stages}
      activeStage={activeStage}
      basePath={`/workspace/${projectId}`}
    />
  );
}
async function StageTasks({ params, searchParams, mode }: ProjectPageProps) {
  const { projectId, session, activeStage, stage } = await readStage(params, searchParams, mode);
  return (
    <Suspense
      key={`${projectId}:${activeStage}`}
      fallback={<WorkspacePanelSkeleton label={`正在加载${stage.label}待办`} />}
    >
      <Tasks projectId={projectId} actorId={session.user.id} stage={stage} />
    </Suspense>
  );
}
async function Details({ params, searchParams, mode }: ProjectPageProps) {
  const {
    projectId,
    session,
    project,
    activeStage,
    stage,
    selectedId,
    selectedLeadId,
    selectedProductId,
    selectedRfqId,
    invalidSelection,
    recordOwned,
  } = await readStage(params, searchParams, mode);
  return (
    <ProjectStageDetails
      stage={stage}
      panel={
        <Suspense
          key={`${projectId}:${activeStage}:${selectedId ?? ""}:${selectedLeadId ?? ""}:${selectedProductId ?? ""}:${selectedRfqId ?? ""}`}
          fallback={<WorkspacePanelSkeleton label={`正在加载${stage.label}详情`} />}
        >
          {invalidSelection ? (
            <RecordSelection
              projectId={projectId}
              stage={stage.id}
              selectedId="invalid"
              found={false}
            >
              {null}
            </RecordSelection>
          ) : (
            <ProjectStagePanel
              projectId={projectId}
              actorId={session.user.id}
              role={session.user.role}
              stage={activeStage}
              mode={mode}
              selectedId={selectedId}
              selectedLeadId={selectedLeadId}
              selectedProductId={selectedProductId}
              selectedRfqId={selectedRfqId}
              canWrite={
                recordOwned && project.memberRole !== "viewer" && project.status === "active"
              }
            />
          )}
        </Suspense>
      }
    />
  );
}

export function ProjectPage(props: ProjectPageProps) {
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
