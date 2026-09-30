import { connection } from "next/server";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkspaceLink } from "@/components/workspace/workspace-link";
import { WorkspacePanelSkeleton } from "@/components/workspace/workspace-loading-skeleton";
import { requirePermission } from "@/lib/auth-guard";
import { readWorkspaceProjectOverview } from "@/lib/workspace/read-model";
export const prefetch = "partial";
async function Projects() {
  await connection();
  const session = await requirePermission("workspace:view");
  const projects = await readWorkspaceProjectOverview(session.user.id);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {projects.map((project) => (
        <Card key={project.id}>
          <CardHeader>
            <CardTitle>
              <WorkspaceLink
                href={`/workspace/${project.id}`}
                className="underline-offset-4 hover:underline"
              >
                {project.title}
              </WorkspaceLink>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Badge variant="outline">{project.statusLabel}</Badge>
            <p className="text-sm text-muted-foreground">
              {project.recordCount} 条记录 · {project.taskCount} 项待办
            </p>
          </CardContent>
        </Card>
      ))}
      {projects.length === 0 ? <p>暂无可访问项目。开始新工作时可明确选择创建项目。</p> : null}
    </div>
  );
}
export default function Page() {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold">项目管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          管理名称、成员和归档状态。业务记录从资料库或任务打开。
        </p>
      </header>
      <Suspense fallback={<WorkspacePanelSkeleton label="正在加载项目" />}>
        <Projects />
      </Suspense>
    </main>
  );
}
