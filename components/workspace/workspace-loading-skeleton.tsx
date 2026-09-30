import { Skeleton } from "@/components/ui/skeleton";

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
            <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
              <Skeleton className="h-10 w-48" />
              <Skeleton className="h-80 rounded-xl" />
            </div>
          ) : (
            <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
              <div className="flex flex-wrap gap-2">
                {["actionable", "waiting", "processing", "scheduled"].map((key) => (
                  <Skeleton key={key} className="h-9 w-24 rounded-lg" />
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

export function WorkspacePanelSkeleton({ label = "正在加载当前步骤" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-4 p-4">
      <span className="sr-only">{label}</span>
      <Skeleton aria-hidden="true" className="h-8 w-40" />
      <Skeleton aria-hidden="true" className="h-48 w-full" />
    </div>
  );
}
