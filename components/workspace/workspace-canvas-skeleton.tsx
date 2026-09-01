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

      <div className="absolute left-3 top-3 flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center gap-2 md:left-6 md:top-6">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
        {project ? <><Skeleton className="h-5 w-20 rounded-full" /><Skeleton className="h-5 w-24 rounded-full" /></> : null}
      </div>

      {project ? projectNodePlaceholders.map((position) => (
        <Skeleton key={position} className={cn("absolute hidden h-16 w-44 border md:block", position)} />
      )) : null}

      {!project ? (
        <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-lg border bg-background/90 p-1 md:right-6 md:top-6">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="size-7" />)}
        </div>
      ) : null}

      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1 rounded-xl border bg-background/95 p-1.5 shadow-lg md:bottom-6">
        {Array.from({ length: project ? 5 : 4 }).map((_, index) => <Skeleton key={index} className="h-8 w-16" />)}
      </div>
    </main>
  );
}
