"use client";

import { ArrowLeftIcon, ArrowRightIcon, FilmIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { workspaceTaskHref } from "@/lib/workspace/navigation";
import type { WorkspaceProjectSummary, WorkspaceTaskSummary } from "@/lib/workspace/store";
import { useWorkspaceDirtyState, WorkspaceDirtyProvider } from "./dirty-state";
import { WorkspaceLink } from "./workspace-link";

export type ProjectStage = { id: string; panelKind: string; label: string; description: string };

function shouldUseNativeNavigation(event: MouseEvent<HTMLElement>) {
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

function GuardedLink({
  href,
  children,
  className,
  current = false,
}: {
  href: string;
  children: ReactNode;
  className: string;
  current?: boolean;
}) {
  return (
    <WorkspaceLink href={href} aria-current={current ? "step" : undefined} className={className}>
      {children}
    </WorkspaceLink>
  );
}

export function VideoStageEntry({
  projectId,
  count,
  pendingReview,
}: {
  projectId: string;
  count: number;
  pendingReview: number;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>视频制作</CardTitle>
            <CardDescription>
              选择素材、生成 AI 剪辑初稿、预览、修改并提交成片审核。
            </CardDescription>
          </div>
          <FilmIcon className="size-5 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Badge variant="outline">{count} 个版本</Badge>
          {pendingReview ? <Badge>{pendingReview} 个待审核</Badge> : null}
        </div>
        <LinkButton href={`/workspace/${projectId}/video`} className="w-full">
          进入视频编辑器
          <ArrowRightIcon data-icon="inline-end" />
        </LinkButton>
      </CardContent>
    </Card>
  );
}

type ProjectWorkspaceProps = {
  project: WorkspaceProjectSummary;
  tasks?: WorkspaceTaskSummary[];
  tasksPanel?: ReactNode;
  membersPanel?: ReactNode;
  stages: ProjectStage[];
  activeStage: string;
  panel: ReactNode;
  basePath?: string;
};

type ProjectWorkspaceFrameProps = {
  title: ReactNode;
  badges: ReactNode;
  members?: ReactNode;
  children: ReactNode;
};

function ProjectWorkspaceFrameInner({
  title,
  badges,
  members,
  children,
}: ProjectWorkspaceFrameProps) {
  const router = useRouter();
  const { requestNavigation } = useWorkspaceDirtyState();
  function returnToWorkspace(event: MouseEvent<HTMLElement>) {
    if (shouldUseNativeNavigation(event)) return;
    event.preventDefault();
    requestNavigation(() => router.push("/workspace"));
  }
  return (
    <main id="main-content" className="min-h-screen bg-muted/30 pb-24">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[96rem] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <LinkButton
              href="/workspace"
              onClick={returnToWorkspace}
              size="icon"
              variant="ghost"
              aria-label="返回工作台"
              data-testid="project-back-link"
            >
              <ArrowLeftIcon />
            </LinkButton>
            <div className="min-w-0">
              {title}
              <div className="mt-1 flex flex-wrap gap-2">
                {badges}
                <Badge variant="outline">关键动作需人工确认</Badge>
              </div>
            </div>
          </div>
          {members ? <div className="flex items-center gap-2">{members}</div> : null}
        </div>
      </header>
      {children}
    </main>
  );
}

export function ProjectWorkspaceFrame(props: ProjectWorkspaceFrameProps) {
  return (
    <WorkspaceDirtyProvider>
      <ProjectWorkspaceFrameInner {...props} />
    </WorkspaceDirtyProvider>
  );
}

export function ProjectWorkspaceTitle({ project }: { project: WorkspaceProjectSummary }) {
  return <h1 className="truncate text-lg font-semibold tracking-tight">{project.title}</h1>;
}

export function ProjectWorkspaceBadges({ project }: { project: WorkspaceProjectSummary }) {
  return (
    <>
      <Badge variant="secondary">{project.kind === "marketing" ? "营销项目" : "销售项目"}</Badge>
      <Badge variant="outline">{project.status === "active" ? "进行中" : "已归档"}</Badge>
    </>
  );
}

export function ProjectWorkspaceBody({
  navigation,
  tasks,
  details,
}: {
  navigation: ReactNode;
  tasks: ReactNode;
  details: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[96rem] px-4 py-5 sm:px-6">
      <nav aria-label="项目阶段" className="overflow-x-auto pb-2">
        {navigation}
      </nav>
      <section
        aria-label="当前阶段"
        className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,34rem)]"
      >
        {tasks}
        {details}
      </section>
    </div>
  );
}

export function ProjectStageNavigation({
  stages,
  activeStage,
  basePath,
}: {
  stages: ProjectStage[];
  activeStage: string;
  basePath: string;
}) {
  return (
    <ol className="flex min-w-max items-stretch gap-1">
      {stages.map((item, index) => {
        const href = `${basePath}?panel=${item.id}`;
        return (
          <li key={item.id} className="flex items-center">
            <GuardedLink
              href={href}
              current={item.id === activeStage}
              className={`flex min-h-14 w-40 flex-col justify-center rounded-xl border px-3 outline-none transition-[background-color,border-color,transform] duration-[120ms] active:scale-[0.98] focus-visible:ring-3 focus-visible:ring-ring/50 ${item.id === activeStage ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            >
              <span className="text-xs opacity-75">步骤 {index + 1}</span>
              <span className="text-sm font-medium">{item.label}</span>
            </GuardedLink>
            {index < stages.length - 1 ? (
              <ArrowRightIcon className="mx-1 size-4 text-muted-foreground" aria-hidden="true" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function ProjectStageDetails({ stage, panel }: { stage: ProjectStage; panel: ReactNode }) {
  return (
    <aside aria-label={`${stage.label}详情与审批`} className="min-w-0">
      <Card className="overflow-hidden">
        <CardHeader className="border-b">
          <CardTitle role="heading" aria-level={2}>
            {stage.label}
          </CardTitle>
          <CardDescription>批准、发送、发布和业务认定都需要明确的人工操作。</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-17rem)] min-h-[32rem]">
            <div className="p-4 sm:p-5">{panel}</div>
          </ScrollArea>
        </CardContent>
      </Card>
    </aside>
  );
}

export function ProjectWorkspace({
  project,
  tasks = [],
  tasksPanel,
  membersPanel,
  stages,
  activeStage,
  panel,
  basePath = `/workspace/${project.id}`,
}: ProjectWorkspaceProps) {
  const stage = stages.find((item) => item.id === activeStage) ?? stages[0]!;
  return (
    <ProjectWorkspaceFrame
      title={<ProjectWorkspaceTitle project={project} />}
      badges={<ProjectWorkspaceBadges project={project} />}
      members={membersPanel}
    >
      <ProjectWorkspaceBody
        navigation={
          <ProjectStageNavigation stages={stages} activeStage={activeStage} basePath={basePath} />
        }
        tasks={
          tasksPanel ?? (
            <ProjectStageTasks
              projectId={project.id}
              tasks={tasks}
              stage={stage}
              basePath={basePath}
            />
          )
        }
        details={<ProjectStageDetails stage={stage} panel={panel} />}
      />
    </ProjectWorkspaceFrame>
  );
}

export function ProjectStageTasks({
  projectId,
  tasks,
  stage,
  basePath = `/workspace/${projectId}`,
}: {
  projectId: string;
  tasks: WorkspaceTaskSummary[];
  stage: ProjectStage;
  basePath?: string;
}) {
  const projectTasks = tasks.filter((task) => task.projectId === projectId);
  const stageTasks = projectTasks.filter(
    (task) =>
      task.nodeKind === stage.panelKind &&
      (stage.id === "opportunity"
        ? task.taskType === "opportunity"
        : stage.id === "follow-up"
          ? task.taskType === "follow_up"
          : true),
  );

  return (
    <div className="min-w-0 space-y-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardDescription>当前步骤</CardDescription>
              <CardTitle role="heading" aria-level={2} className="mt-1">
                {stage.label}
              </CardTitle>
              <p className="mt-2 text-sm text-muted-foreground">{stage.description}</p>
            </div>
            <Badge>{stageTasks.length ? `${stageTasks.length} 项待处理` : "当前无待办"}</Badge>
          </div>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            待处理事项
          </CardTitle>
          <CardDescription>
            先处理这里的下一动作；也可以在右侧新建或查看本步骤的业务记录。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stageTasks.length ? (
            <div className="divide-y">
              {stageTasks.map((task) => (
                <GuardedLink
                  key={`${task.taskType}-${task.id}`}
                  href={workspaceTaskHref(task, basePath)}
                  className="group flex min-h-16 items-center gap-3 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{task.title}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{task.detail}</p>
                  </div>
                  <Badge variant={task.priority === "review" ? "default" : "secondary"}>
                    {task.actionLabel ?? "打开"}
                  </Badge>
                  <ArrowRightIcon className="size-4 text-muted-foreground transition-transform duration-[120ms] group-hover:translate-x-0.5" />
                </GuardedLink>
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              本步骤暂无待处理事项，可在右侧创建或查看业务记录。
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
