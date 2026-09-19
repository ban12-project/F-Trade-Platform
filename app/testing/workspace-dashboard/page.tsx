import { notFound } from "next/navigation";
import { Suspense } from "react";
import { WorkspaceDashboard } from "@/components/workspace/workspace-dashboard";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import type { InboundRoutingSummary } from "@/lib/social/inbound-routing-store";
import type {
  WorkspacePipelineSummary,
  WorkspaceProjectSummary,
  WorkspaceTaskSummary,
} from "@/lib/workspace/store";

const projects: WorkspaceProjectSummary[] = [
  {
    id: "00000000-0000-4000-8000-000000000701",
    title: "Synthetic launch",
    kind: "marketing",
    status: "active",
    updatedAt: new Date("2026-09-01T00:00:00Z"),
  },
  {
    id: "00000000-0000-4000-8000-000000000702",
    title: "Synthetic distributor",
    kind: "sales",
    status: "active",
    updatedAt: new Date("2026-09-02T00:00:00Z"),
  },
];
const tasks: WorkspaceTaskSummary[] = [
  {
    id: "00000000-0000-4000-8000-000000000711",
    projectId: projects[0]!.id,
    projectTitle: projects[0]!.title,
    nodeKind: "publication",
    title: "批准内容等待发布",
    detail: "需要逐帖人工确认",
    priority: "review",
    taskType: "publication",
    actionLabel: "确认并提交发布",
    createdAt: new Date("2026-09-03T00:00:00Z"),
  },
  {
    id: "00000000-0000-4000-8000-000000000713",
    projectId: projects[0]!.id,
    projectTitle: projects[0]!.title,
    nodeKind: "video",
    title: "营销视频等待成片审核",
    detail: "打开对应剪辑版本并完成人工审核",
    priority: "review",
    taskType: "approval",
    actionLabel: "审核成片",
    createdAt: new Date("2026-09-03T00:30:00Z"),
  },
  {
    id: "00000000-0000-4000-8000-000000000712",
    projectId: projects[1]!.id,
    projectTitle: projects[1]!.title,
    nodeKind: "lead",
    title: "客户跟进到期",
    detail: "计划跟进已到期",
    priority: "complete",
    taskType: "follow_up",
    actionLabel: "继续跟进",
    createdAt: new Date("2026-09-03T00:00:00Z"),
    dueAt: new Date("2026-09-03T01:00:00Z"),
  },
];
for (const [id, state, title, detail] of [
  ["721", "waiting", "等待审核者核实产品", "等待有审核权限的项目编辑者"],
  ["722", "processing", "发布等待平台回执", "系统处理中，尚未确认发布成功"],
  ["723", "scheduled", "客户跟进已安排", "明天跟进，不计入今日待办"],
] as const) {
  tasks.push({
    id: `00000000-0000-4000-8000-000000000${id}`,
    projectId: projects[0]!.id,
    projectTitle: projects[0]!.title,
    nodeKind: "publication",
    title,
    detail,
    state,
    priority: "complete",
    actionLabel: "查看状态",
    taskType: "publication",
    createdAt: new Date("2026-09-03T00:00:00Z"),
  });
}
const pipeline: WorkspacePipelineSummary[] = [
  {
    ...projects[0]!,
    currentStage: "已有发布成果",
    nextAction: "查看成果与入站转化",
    recordCount: 4,
    publishedCount: 1,
    leadCount: 0,
    opportunityCount: 0,
  },
  {
    ...projects[1]!,
    currentStage: "跟进",
    nextAction: "执行下一次人工跟进",
    recordCount: 3,
    publishedCount: 0,
    leadCount: 1,
    opportunityCount: 0,
    relatedMarketingProjectTitle: projects[0]!.title,
  },
];
const inbound: InboundRoutingSummary[] = [
  {
    id: "synthetic-conversation-001",
    channelLabel: "facebook",
    shortReference: "A1B2C3D4",
    lastMessageAt: new Date("2026-09-03T02:00:00Z"),
  },
];

async function Content({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; empty?: string }>;
}) {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  const query = await searchParams;
  return (
    <WorkspaceShell projects={query.empty ? [] : projects}>
      <WorkspaceDashboard
        projects={query.empty ? [] : projects}
        tasks={query.empty ? [] : tasks}
        pipeline={query.empty ? [] : pipeline}
        inbound={query.empty ? [] : inbound}
        view={query.view}
        basePath="/testing/workspace-dashboard"
        currentTime={new Date("2026-09-04T00:00:00Z").getTime()}
      />
    </WorkspaceShell>
  );
}

export default function Page(props: { searchParams: Promise<{ view?: string; empty?: string }> }) {
  return (
    <Suspense>
      <Content {...props} />
    </Suspense>
  );
}
