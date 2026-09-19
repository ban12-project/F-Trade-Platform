import { Skeleton } from "@/components/ui/skeleton";
import { ProjectWorkspaceBody } from "./project-workspace";

export function WorkspaceLoadingSkeleton({ project = false }: { project?: boolean }) {
  const label = project ? "正在加载项目工作区" : "正在加载工作台";
  return (
    <>
      <p role="status" aria-label={label} className="sr-only">
        {label}
      </p>
      <main
        id="main-content"
        tabIndex={-1}
        className="workspace-page bg-muted/30"
        aria-busy="true"
        aria-label={project ? "项目工作区" : "工作台"}
      >
        <header className="sticky top-0 z-10 border-b bg-background/90">
          <div
            aria-hidden="true"
            className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6"
          >
            <div className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-32" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          </div>
        </header>
        <div aria-hidden="true">
          {project ? (
            <ProjectWorkspaceBody
              navigation={<ProjectStageNavigationSkeleton />}
              tasks={<ProjectTasksSkeleton />}
              details={<ProjectDetailsSkeleton />}
            />
          ) : (
            <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {["first", "second", "third", "fourth"].map((key) => (
                  <Skeleton key={key} className="h-28 rounded-xl" />
                ))}
              </div>
              <Skeleton className="h-80 rounded-xl" />
              <div className="grid gap-6 xl:grid-cols-2">
                <Skeleton className="h-64 rounded-xl" />
                <Skeleton className="h-64 rounded-xl" />
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

export function WorkspaceDockSkeleton() {
  return (
    <div
      aria-label="正在加载工作台操作"
      role="status"
      className="workspace-dock rounded-2xl border bg-background"
    >
      <span className="sr-only">正在加载工作台操作</span>
      {["projects", "create", "tasks", "tools"].map((key) => (
        <Skeleton key={key} aria-hidden="true" className="h-12 w-14 sm:h-11 sm:w-20" />
      ))}
    </div>
  );
}

export function WorkspacePanelSkeleton({ label = "正在加载当前步骤" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-4 p-4">
      <span className="sr-only">{label}</span>
      <Skeleton aria-hidden="true" className="h-8 w-40" />
      <Skeleton aria-hidden="true" className="h-48 w-full" />
    </div>
  );
}

export function ProjectTitleSkeleton() {
  return (
    <div role="status" aria-label="正在加载项目名称">
      <span className="sr-only">正在加载项目名称</span>
      <Skeleton aria-hidden="true" className="h-7 w-32" />
    </div>
  );
}

export function ProjectBadgesSkeleton() {
  return (
    <>
      <Skeleton aria-hidden="true" className="h-5 w-16 rounded-full" />
      <Skeleton aria-hidden="true" className="h-5 w-16 rounded-full" />
    </>
  );
}

export function ProjectStageNavigationSkeleton() {
  return (
    <div role="status" aria-label="正在加载项目阶段" className="flex min-w-max gap-2">
      <span className="sr-only">正在加载项目阶段</span>
      {["first", "second", "third", "fourth"].map((key) => (
        <Skeleton key={key} aria-hidden="true" className="h-14 w-40 rounded-xl" />
      ))}
    </div>
  );
}

export function ProjectTasksSkeleton() {
  return (
    <div role="status" aria-label="正在加载项目待办" className="space-y-5">
      <span className="sr-only">正在加载项目待办</span>
      <Skeleton aria-hidden="true" className="h-32 rounded-xl" />
      <Skeleton aria-hidden="true" className="h-72 rounded-xl" />
    </div>
  );
}

export function ProjectDetailsSkeleton() {
  return (
    <div role="status" aria-label="正在加载项目详情">
      <span className="sr-only">正在加载项目详情</span>
      <Skeleton aria-hidden="true" className="h-[32rem] rounded-xl" />
    </div>
  );
}
