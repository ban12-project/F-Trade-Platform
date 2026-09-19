import "server-only";
import { connection } from "next/server";
import { Suspense } from "react";
import { requirePermission } from "@/lib/auth-guard";
import type { WorkspaceCollection } from "@/lib/workspace/navigation";
import { readWorkspaceLibrary, readWorkspaceProjects } from "@/lib/workspace/read-model";
import { WorkspaceLibrary } from "./workspace-library";
import { WorkspacePanelSkeleton } from "./workspace-loading-skeleton";

const labels = {
  products: ["产品资料", "查找、核验和维护有来源的产品事实。"],
  content: ["内容与发布", "查看内容版本、审核状态和发布回执。"],
  customers: ["客户与询盘", "从客户线索、需求确认到人工报价与跟进。"],
};
export type LibraryPageProps = { searchParams: Promise<{ project?: string }> };
async function Records({
  collection,
  searchParams,
}: LibraryPageProps & { collection: WorkspaceCollection }) {
  await connection();
  const session = await requirePermission("workspace:view");
  const [projects, records, query] = await Promise.all([
    readWorkspaceProjects(session.user.id),
    readWorkspaceLibrary(session.user.id),
    searchParams,
  ]);
  return (
    <WorkspaceLibrary
      collection={collection}
      projects={projects}
      records={records}
      projectId={query.project}
    />
  );
}
export function WorkspaceLibraryPage({
  collection,
  ...props
}: LibraryPageProps & { collection: WorkspaceCollection }) {
  return (
    <main id="main-content" tabIndex={-1} className="workspace-page bg-muted/30">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-5 sm:p-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">{labels[collection][0]}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{labels[collection][1]}</p>
        </header>
        <Suspense fallback={<WorkspacePanelSkeleton label="正在加载可访问记录" />}>
          <Records collection={collection} {...props} />
        </Suspense>
      </div>
    </main>
  );
}
