import { Skeleton } from "@/components/ui/skeleton";

export function WorkspaceLoadingSkeleton({ project = false }: { project?: boolean }) {
  return (
    <main
      className="fixed inset-0 overflow-y-auto bg-muted/30"
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
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-40 rounded-xl" />
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
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-28 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-80 rounded-xl" />
          <div className="grid gap-6 xl:grid-cols-2">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        </div>
      )}

      <div className="fixed bottom-3 left-1/2 flex -translate-x-1/2 gap-2 rounded-xl border bg-background/95 p-2 shadow-lg md:bottom-6">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-9 w-16" />
        ))}
      </div>
    </main>
  );
}
