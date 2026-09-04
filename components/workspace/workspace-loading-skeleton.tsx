import { Skeleton } from "@/components/ui/skeleton";

export function WorkspaceLoadingSkeleton({ project = false }: { project?: boolean }) {
  return (
    <main
      className="min-h-screen overflow-x-hidden bg-muted/30 pb-24"
      aria-busy="true"
      aria-label={project ? "正在加载项目工作区" : "正在加载工作台"}
      role="status"
    >
      <header className="sticky top-0 z-10 border-b bg-background/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
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

      {project ? (
        <div className="mx-auto max-w-[96rem] space-y-5 px-4 py-5 sm:px-6">
          <div className="flex min-w-max gap-2 overflow-hidden">
            {["first", "second", "third", "fourth"].map((key) => (
              <Skeleton key={key} className="h-14 w-40 rounded-xl" />
            ))}
          </div>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,34rem)]">
            <div className="space-y-5">
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-72 rounded-xl" />
            </div>
            <Skeleton className="h-[32rem] rounded-xl" />
          </div>
        </div>
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
    </main>
  );
}

export function WorkspaceDockSkeleton() {
  return (
    <div
      aria-label="正在加载工作台操作"
      role="status"
      className="fixed bottom-6 left-1/2 z-20 flex -translate-x-1/2 gap-2 rounded-2xl border bg-background p-2"
    >
      {["projects", "create", "tasks", "tools"].map((key) => (
        <Skeleton key={key} className="h-11 w-16" />
      ))}
    </div>
  );
}
export function WorkspacePanelSkeleton({ label = "正在加载当前步骤" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className="space-y-4 p-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
