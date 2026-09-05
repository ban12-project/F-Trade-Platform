import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProjectMembersPanel } from "@/components/workspace/project-members-panel";
import { type ProjectStage, ProjectWorkspace } from "@/components/workspace/project-workspace";
import type { WorkspaceProjectSummary, WorkspaceTaskSummary } from "@/lib/workspace/store";

const project: WorkspaceProjectSummary = {
  id: "00000000-0000-4000-8000-000000000721",
  title: "Synthetic project workspace",
  kind: "marketing",
  status: "active",
  updatedAt: new Date("2026-09-01T00:00:00Z"),
};
const stages: ProjectStage[] = [
  {
    id: "product",
    panelKind: "product",
    label: "产品事实",
    description: "导入、核验证据并完成 Gate 01。",
  },
  { id: "content", panelKind: "content", label: "内容", description: "从已核验事实创建营销内容。" },
  { id: "video", panelKind: "video", label: "视频", description: "在独立编辑器完成视频制作。" },
  {
    id: "publication",
    panelKind: "publication",
    label: "发布",
    description: "逐帖确认渠道与载荷，等待平台回执。",
  },
];
const tasks: WorkspaceTaskSummary[] = [
  {
    id: "00000000-0000-4000-8000-000000000722",
    projectId: project.id,
    projectTitle: project.title,
    nodeKind: "product",
    title: "核对产品事实",
    detail: "等待 Gate 01",
    priority: "review",
    taskType: "approval",
    actionLabel: "完成审核",
    createdAt: new Date("2026-09-03T00:00:00Z"),
  },
];

async function ProjectWorkspaceFixture({
  searchParams,
}: {
  searchParams: Promise<{ panel?: string }>;
}) {
  const query = await searchParams;
  const active = stages.some((stage) => stage.id === query.panel) ? query.panel! : "product";
  const stage = stages.find((item) => item.id === active)!;
  const panel = (
    <Card>
      <CardHeader>
        <CardTitle>{stage.label}记录</CardTitle>
        <CardDescription>合成测试详情面板</CardDescription>
      </CardHeader>
      <CardContent>人工操作保持可追溯。</CardContent>
    </Card>
  );
  const membersPanel = (
    <ProjectMembersPanel
      projectId={project.id}
      currentUserId="synthetic-user-owner"
      members={[
        {
          userId: "synthetic-user-owner",
          name: "Synthetic Owner",
          email: "owner@example.test",
          role: "owner",
        },
        {
          userId: "synthetic-user-viewer",
          name: "Synthetic Viewer",
          email: "viewer@example.test",
          role: "viewer",
        },
      ]}
    />
  );
  return (
    <ProjectWorkspace
      project={project}
      tasks={tasks}
      membersPanel={membersPanel}
      stages={stages}
      activeStage={active}
      panel={panel}
      basePath="/testing/project-workspace"
    />
  );
}

export default function ProjectWorkspaceTestingPage({
  searchParams,
}: {
  searchParams: Promise<{ panel?: string }>;
}) {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return (
    <Suspense fallback={null}>
      <ProjectWorkspaceFixture searchParams={searchParams} />
    </Suspense>
  );
}
