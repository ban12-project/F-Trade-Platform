"use client";

import {
  ArrowRightIcon,
  CheckCircle2Icon,
  Clock3Icon,
  GitBranchIcon,
  InboxIcon,
  ShieldCheckIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import type { InboundRoutingSummary } from "@/lib/social/inbound-routing-store";
import { workspaceTaskHref } from "@/lib/workspace/navigation";
import type {
  WorkspacePipelineSummary,
  WorkspaceProjectSummary,
  WorkspaceTaskSummary,
} from "@/lib/workspace/store";
import { WorkspaceDirtyProvider } from "./dirty-state";
import { InboundRoutingList } from "./inbound-routing-list";
import { WorkspaceLink as Link } from "./workspace-link";

function TaskRows({ tasks, empty }: { tasks: WorkspaceTaskSummary[]; empty: string }) {
  if (!tasks.length)
    return (
      <Empty className="border-0 py-8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CheckCircle2Icon />
          </EmptyMedia>
          <EmptyTitle>{empty}</EmptyTitle>
          <EmptyDescription>新的事项出现后会自动汇总到这里。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <div className="divide-y">
      {tasks.map((task) => (
        <Link
          key={`${task.taskType}-${task.id}`}
          href={workspaceTaskHref(task)}
          className="group flex min-h-16 items-center gap-3 px-1 py-3 outline-none transition-colors duration-[120ms] hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium">{task.title}</span>
              <Badge variant={task.priority === "review" ? "default" : "secondary"}>
                {task.actionLabel ?? (task.priority === "review" ? "审核" : "处理")}
              </Badge>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {task.projectTitle} · {task.detail}
            </p>
          </div>
          <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-[120ms] group-hover:translate-x-0.5" />
        </Link>
      ))}
    </div>
  );
}

export function WorkspaceDashboard({
  projects,
  tasks,
  pipeline,
  inbound = [],
  currentTime,
}: {
  projects: WorkspaceProjectSummary[];
  tasks: WorkspaceTaskSummary[];
  pipeline: WorkspacePipelineSummary[];
  inbound?: InboundRoutingSummary[];
  currentTime: number;
}) {
  const approvals = tasks.filter(
    (task) =>
      task.taskType === "approval" ||
      task.taskType === "publication" ||
      task.taskType === "opportunity",
  );
  const due = tasks.filter(
    (task) => task.taskType === "follow_up" && (!task.dueAt || task.dueAt.getTime() <= currentTime),
  );
  const opportunities = pipeline.reduce((count, item) => count + item.opportunityCount, 0);
  const pendingCount = tasks.length + inbound.length;
  return (
    <WorkspaceDirtyProvider>
      <main id="main-content" className="min-h-screen bg-muted/30 pb-24">
        <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <div>
              <p className="text-xs font-medium text-muted-foreground">F-Trade</p>
              <h1 className="text-xl font-semibold tracking-tight">工作台</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                先处理下一动作，再进入对应项目步骤。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{projects.length} 个项目</Badge>
              <Badge variant={pendingCount ? "default" : "outline"}>{pendingCount} 项待处理</Badge>
            </div>
          </div>
        </header>
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <nav aria-label="工作台栏目" className="sticky top-24 flex flex-col gap-1">
              <Button render={<a href="#my-tasks" />} variant="ghost" className="justify-start">
                <InboxIcon data-icon="inline-start" />
                我的待办
              </Button>
              <Button render={<a href="#approvals" />} variant="ghost" className="justify-start">
                <ShieldCheckIcon data-icon="inline-start" />
                待审批
              </Button>
              <Button render={<a href="#follow-ups" />} variant="ghost" className="justify-start">
                <Clock3Icon data-icon="inline-start" />
                到期跟进
              </Button>
              <Button render={<a href="#pipeline" />} variant="ghost" className="justify-start">
                <GitBranchIcon data-icon="inline-start" />
                项目 / 线索 Pipeline
              </Button>
            </nav>
          </aside>
          <div className="min-w-0 space-y-8">
            <section aria-label="工作台摘要" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["我的待办", pendingCount, "跨项目下一动作"],
                ["待审批", approvals.length, "人工 Gate 与发布"],
                ["到期跟进", due.length, "需要业务人员处理"],
                ["有效商机", opportunities, "已由人工确认"],
              ].map(([label, value, detail]) => (
                <Card key={String(label)} size="sm">
                  <CardHeader>
                    <CardDescription>{label}</CardDescription>
                    <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">{detail}</CardContent>
                </Card>
              ))}
            </section>
            <section id="my-tasks" className="scroll-mt-24">
              <Card>
                <CardHeader>
                  <CardTitle role="heading" aria-level={2}>
                    我的待办
                  </CardTitle>
                  <CardDescription>
                    先处理尚未归属项目的入站消息，再进入各项目的下一动作。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <InboundRoutingList items={inbound} projects={projects} />
                  <TaskRows
                    tasks={tasks.slice(0, 8)}
                    empty={inbound.length ? "没有其他项目待办" : "当前没有待办"}
                  />
                </CardContent>
              </Card>
            </section>
            <div className="grid gap-6 xl:grid-cols-2">
              <section id="approvals" className="scroll-mt-24">
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle role="heading" aria-level={2}>
                      待审批
                    </CardTitle>
                    <CardDescription>Gate 01、Gate 02、Gate 03 与逐帖发布确认。</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <TaskRows tasks={approvals.slice(0, 6)} empty="当前没有待审批事项" />
                  </CardContent>
                </Card>
              </section>
              <section id="follow-ups" className="scroll-mt-24">
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle role="heading" aria-level={2}>
                      到期跟进
                    </CardTitle>
                    <CardDescription>评分只决定建议优先级，不自动认定商机。</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <TaskRows tasks={due.slice(0, 6)} empty="当前没有到期跟进" />
                  </CardContent>
                </Card>
              </section>
            </div>
            <section id="pipeline" className="scroll-mt-24">
              <div className="mb-3">
                <h2 className="text-lg font-semibold tracking-tight">项目 / 线索 Pipeline</h2>
                <p className="text-sm text-muted-foreground">
                  选择项目后直接进入当前步骤；营销成果与销售线索的跨项目关系在此汇总。
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {pipeline.map((item) => (
                  <Link
                    key={item.id}
                    href={`/workspace/${item.id}`}
                    className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <Card className="h-full transition-[transform,box-shadow] duration-[120ms] hover:-translate-y-0.5 hover:shadow-md">
                      <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <CardTitle className="truncate">{item.title}</CardTitle>
                            <CardDescription>
                              {item.kind === "marketing" ? "营销项目" : "销售项目"} ·{" "}
                              {item.currentStage}
                            </CardDescription>
                          </div>
                          <Badge variant={item.status === "active" ? "secondary" : "outline"}>
                            {item.status === "active" ? "进行中" : "已归档"}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <p className="text-sm">
                          <span className="text-muted-foreground">下一动作：</span>
                          {item.nextAction}
                        </p>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <Badge variant="outline">{item.recordCount} 条记录</Badge>
                          {item.publishedCount ? (
                            <Badge variant="outline">{item.publishedCount} 项营销成果</Badge>
                          ) : null}
                          {item.leadCount ? (
                            <Badge variant="outline">{item.leadCount} 条线索</Badge>
                          ) : null}
                          {item.opportunityCount ? (
                            <Badge>{item.opportunityCount} 个有效商机</Badge>
                          ) : null}
                        </div>
                        {item.relatedMarketingProjectTitle ? (
                          <p className="rounded-lg bg-muted px-3 py-2 text-xs">
                            来源营销项目：{item.relatedMarketingProjectTitle}
                          </p>
                        ) : null}
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>
    </WorkspaceDirtyProvider>
  );
}
