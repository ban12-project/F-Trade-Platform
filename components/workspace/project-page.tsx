import "server-only";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { WorkspacePanelSkeleton } from "@/components/workspace/workspace-loading-skeleton";
import { requirePermission } from "@/lib/auth-guard";
import { listWorkspaceProjectMembers } from "@/lib/workspace/access";
import { readWorkspaceProject } from "@/lib/workspace/read-model";
import { ProjectMembersPanel } from "./project-members-panel";
import { ProjectNameForm } from "./project-name-form";
import { ProjectStatusControl } from "./project-status-control";
import { WorkspaceLink } from "./workspace-link";

export type ProjectPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
async function ProjectDetails({ params, searchParams }: ProjectPageProps) {
  await connection();
  const [{ projectId }, query, session] = await Promise.all([
    params,
    searchParams,
    requirePermission("workspace:view"),
  ]);
  if (!z.uuid().safeParse(projectId).success) notFound();
  const project = await readWorkspaceProject(projectId, session.user.id);
  if (!project) notFound();
  const legacy = ["panel", "item", "lead", "product", "rfq"].some(
    (key) => query[key] !== undefined,
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{project.title}</h2>
          <p className="text-sm text-muted-foreground">
            {project.kind === "marketing" ? "营销项目" : "销售项目"}
          </p>
        </div>
        <Badge variant="outline">{project.status === "active" ? "进行中" : "已归档"}</Badge>
      </div>
      {legacy ? (
        <Alert>
          <AlertTitle>旧阶段链接已停用</AlertTitle>
          <AlertDescription>
            请从资料库选择具体记录。此地址不会自动选择记录或开始新建。
          </AlertDescription>
        </Alert>
      ) : null}
      <nav aria-label="所属资料库" className="flex flex-wrap gap-2">
        {(project.kind === "marketing"
          ? [
              ["products", "产品资料"],
              ["content", "内容与发布"],
            ]
          : [
              ["customers", "客户与询盘"],
              ["products", "引用的产品"],
            ]
        ).map(([path, label]) => (
          <WorkspaceLink
            key={path}
            href={`/workspace/${path}?project=${projectId}`}
            className={buttonVariants({ variant: "outline", className: "min-h-11" })}
          >
            {label}
          </WorkspaceLink>
        ))}
      </nav>
      {project.memberRole === "owner" ? (
        <>
          <ProjectNameForm projectId={projectId} title={project.title} />
          <ProjectStatusControl projectId={projectId} status={project.status} />
        </>
      ) : null}
      <ProjectMembersPanel
        projectId={projectId}
        currentUserId={session.user.id}
        members={await listWorkspaceProjectMembers(projectId, session.user.id)}
      />
    </div>
  );
}
export function ProjectPage(props: ProjectPageProps) {
  return (
    <main id="main-content" tabIndex={-1} className="workspace-page bg-muted/30">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-5 sm:p-6">
        <header>
          <WorkspaceLink
            href="/workspace/projects"
            className={buttonVariants({ variant: "ghost" })}
          >
            返回项目管理
          </WorkspaceLink>
          <h1 className="mt-3 text-2xl font-semibold">项目管理</h1>
        </header>
        <Suspense fallback={<WorkspacePanelSkeleton label="正在加载项目管理" />}>
          <ProjectDetails {...props} />
        </Suspense>
      </div>
    </main>
  );
}
