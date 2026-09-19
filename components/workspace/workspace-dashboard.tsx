"use client";

import {
  ArrowRightIcon,
  CheckCircle2Icon,
  Clock3Icon,
  GitBranchIcon,
  InboxIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
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
import { isActionableTask, taskStateLabel } from "@/lib/workspace/task-model";
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
              {task.state ? <Badge variant="outline">{taskStateLabel(task)}</Badge> : null}
            </div>
            <p className="mt-1 break-words text-sm text-muted-foreground">
              {task.projectTitle} · {task.detail}
            </p>
          </div>
          <ArrowRightIcon className="workspace-task-arrow size-4 shrink-0 text-muted-foreground transition-transform duration-[120ms] group-hover:translate-x-0.5" />
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
  const actionable = tasks.filter(isActionableTask);
  const waiting = tasks.filter((task) => task.state === "waiting");
  const processing = tasks.filter((task) => task.state === "processing");
  const scheduled = tasks.filter((task) => task.state === "scheduled");
  const approvals = actionable.filter(
    (task) =>
      task.taskType === "approval" ||
      task.taskType === "publication" ||
      task.taskType === "opportunity",
  );
  const due = actionable.filter(
    (task) => task.taskType === "follow_up" && (!task.dueAt || task.dueAt.getTime() <= currentTime),
  );
  const opportunities = pipeline.reduce((count, item) => count + item.opportunityCount, 0);
  const pendingCount = actionable.length + inbound.length;
  return (
    <WorkspaceDirtyProvider>
      <main id="main-content" tabIndex={-1} className="workspace-page bg-muted/30">
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
          <aside className="min-w-0">
            <nav
              aria-label="工作台栏目"
              className="flex flex-wrap gap-1 lg:sticky lg:top-24 lg:flex-col"
            >
              <a
                href="#my-tasks"
                className={buttonVariants({ variant: "ghost", className: "justify-start" })}
              >
                <InboxIcon data-icon="inline-start" />
                我的待办
              </a>
              <a
                href="#approvals"
                className={buttonVariants({ variant: "ghost", className: "justify-start" })}
              >
                <ShieldCheckIcon data-icon="inline-start" />
                待审批
              </a>
              <a
                href="#follow-ups"
                className={buttonVariants({ variant: "ghost", className: "justify-start" })}
              >
                <Clock3Icon data-icon="inline-start" />
                到期跟进
              </a>
              <a
                href="#pipeline"
                className={buttonVariants({ variant: "ghost", className: "justify-start" })}
              >
                <GitBranchIcon data-icon="inline-start" />
                项目 / 线索 Pipeline
              </a>
            </nav>
          </aside>
          <div className="min-w-0 space-y-8">
            <section aria-label="工作台摘要" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["我的待办", pendingCount, "当前有权限处理的事项"],
                ["待审批", approvals.length, "可由我审核或确认"],
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
            <section id="my-tasks" tabIndex={-1} className="scroll-mt-24">
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
                    tasks={actionable}
                    empty={inbound.length ? "没有其他项目待办" : "当前没有待办"}
                  />
                </CardContent>
              </Card>
            </section>
            {[
              { id: "waiting", label: "等待他人", tasks: waiting },
              { id: "processing", label: "系统处理中", tasks: processing },
              { id: "scheduled", label: "已安排的跟进", tasks: scheduled },
            ]
              .filter((group) => group.tasks.length)
              .map((group) => (
                <section key={group.id} id={group.id} className="scroll-mt-24">
                  <Card>
                    <CardHeader>
                      <CardTitle role="heading" aria-level={2}>
                        {group.label}
                      </CardTitle>
                      <CardDescription>
                        这些事项不计入我的待办，状态变化后会重新归类。
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <TaskRows tasks={group.tasks} empty="暂无记录" />
                    </CardContent>
                  </Card>
                </section>
              ))}
            <div className="grid gap-6 xl:grid-cols-2">
              <section id="approvals" tabIndex={-1} className="scroll-mt-24">
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle role="heading" aria-level={2}>
                      待审批
                    </CardTitle>
                    <CardDescription>Gate 01、Gate 02、Gate 03 与逐帖发布确认。</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <TaskRows tasks={approvals} empty="当前没有待审批事项" />
                  </CardContent>
                </Card>
              </section>
              <section id="follow-ups" tabIndex={-1} className="scroll-mt-24">
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle role="heading" aria-level={2}>
                      到期跟进
                    </CardTitle>
                    <CardDescription>评分只决定建议优先级，不自动认定商机。</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <TaskRows tasks={due} empty="当前没有到期跟进" />
                  </CardContent>
                </Card>
              </section>
            </div>
            <section id="pipeline" tabIndex={-1} className="scroll-mt-24">
              <div className="mb-3">
                <h2 className="text-lg font-semibold tracking-tight">项目 / 线索 Pipeline</h2>
                <p className="text-sm text-muted-foreground">
                  选择项目后直接进入当前步骤；营销成果与销售线索的跨项目关系在此汇总。
                </p>
              </div>
              {!pipeline.length ? (
                <Empty className="rounded-xl border bg-background">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <GitBranchIcon />
                    </EmptyMedia>
                    <EmptyTitle>还没有项目</EmptyTitle>
                    <EmptyDescription>
                      使用底部“新建项目”开始；创建后会引导你完成第一项业务步骤。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2">
                {pipeline.map((item) => (
                  <div key={item.id}>
                    <Card className="workspace-pipeline-card h-full transition-[transform,box-shadow] duration-[120ms] hover:-translate-y-0.5 hover:shadow-md">
                      <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Link
                              href={`/workspace/${item.id}`}
                              className="rounded outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                            >
                              <CardTitle className="truncate">{item.title}</CardTitle>
                            </Link>
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
                        <Link
                          href={item.nextActionHref ?? `/workspace/${item.id}`}
                          className="block rounded text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          <span className="text-muted-foreground">下一动作：</span>
                          {item.nextAction}
                        </Link>
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
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </main>
    </WorkspaceDirtyProvider>
  );
}
