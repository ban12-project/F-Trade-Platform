import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const projectNodePlaceholders = [
  "left-[14%] top-[34%]",
  "left-[36%] top-[52%]",
  "left-[58%] top-[34%]",
  "left-[58%] top-[64%]",
] as const;

export function WorkspaceCanvasSkeleton({ project = false }: { project?: boolean }) {
  return (
    <main
      className="fixed inset-0 overflow-hidden bg-background"
      aria-busy="true"
      aria-label={project ? "正在加载项目画布" : "正在加载项目工作区"}
      role="status"
    >
      <div className="absolute inset-0 bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:16px_16px] opacity-60" aria-hidden="true" />

      <div className="absolute left-3 top-3 flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center gap-2 rounded-lg border bg-background/90 p-2 shadow-sm md:left-6 md:top-6">
        {project ? <Skeleton className="size-8" /> : null}
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-24" />
      </div>

      {project ? projectNodePlaceholders.map((position) => (
        <Skeleton key={position} className={cn("absolute hidden h-16 w-44 border md:block", position)} />
      )) : null}

      {!project ? (
        <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-lg border bg-background/90 p-1 md:right-6 md:top-6">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="size-7" />)}
        </div>
      ) : null}

      {project ? (
        <aside className="fixed right-6 top-6 hidden max-h-[calc(100dvh-3rem)] w-[min(26rem,calc(100vw-3rem))] flex-col overflow-hidden rounded-xl border bg-popover shadow-lg md:flex">
          <header className="flex shrink-0 flex-col gap-2 border-b p-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-44" />
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-24 w-full" />
          </div>
          <footer className="shrink-0 border-t p-4">
            <Skeleton className="h-8 w-full" />
          </footer>
        </aside>
      ) : null}
    </main>
  );
}
