import { notFound } from "next/navigation";

import { WorkspaceDashboard } from "@/components/workspace/workspace-dashboard";
import type { WorkspacePipelineSummary, WorkspaceProjectSummary, WorkspaceTaskSummary } from "@/lib/workspace/store";
import type { InboundRoutingSummary } from "@/lib/social/inbound-routing-store";

const projects: WorkspaceProjectSummary[] = [
  { id: "00000000-0000-4000-8000-000000000701", title: "Synthetic launch", kind: "marketing", status: "active", updatedAt: new Date("2026-09-01T00:00:00Z") },
  { id: "00000000-0000-4000-8000-000000000702", title: "Synthetic distributor", kind: "sales", status: "active", updatedAt: new Date("2026-09-02T00:00:00Z") },
];
const tasks: WorkspaceTaskSummary[] = [
  { id: "00000000-0000-4000-8000-000000000711", projectId: projects[0]!.id, projectTitle: projects[0]!.title, nodeKind: "publication", title: "批准内容等待发布", detail: "需要平台凭证", priority: "review", taskType: "publication", actionLabel: "确认发布结果", createdAt: new Date("2026-09-03T00:00:00Z") },
  { id: "00000000-0000-4000-8000-000000000712", projectId: projects[1]!.id, projectTitle: projects[1]!.title, nodeKind: "lead", title: "客户跟进到期", detail: "计划跟进已到期", priority: "complete", taskType: "follow_up", actionLabel: "继续跟进", createdAt: new Date("2026-09-03T00:00:00Z"), dueAt: new Date("2026-09-03T01:00:00Z") },
];
const pipeline: WorkspacePipelineSummary[] = [
  { ...projects[0]!, currentStage: "已有发布成果", nextAction: "查看成果与入站转化", recordCount: 4, publishedCount: 1, leadCount: 0, opportunityCount: 0 },
  { ...projects[1]!, currentStage: "跟进", nextAction: "执行下一次人工跟进", recordCount: 3, publishedCount: 0, leadCount: 1, opportunityCount: 0, relatedMarketingProjectTitle: projects[0]!.title },
];
const inbound: InboundRoutingSummary[] = [{ id: "synthetic-conversation-001", channelLabel: "facebook", shortReference: "A1B2C3D4", lastMessageAt: new Date("2026-09-03T02:00:00Z") }];

export default function WorkspaceDashboardTestingPage() {
  if (process.env.NEXT_ENABLE_TESTING_API !== "1") notFound();
  return <WorkspaceDashboard projects={projects} tasks={tasks} pipeline={pipeline} inbound={inbound} currentTime={new Date("2026-09-04T00:00:00Z").getTime()} />;
}
