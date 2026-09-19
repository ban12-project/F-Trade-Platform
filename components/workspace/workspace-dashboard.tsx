"use client";
import { ArrowRightIcon, CheckCircle2Icon } from "lucide-react";
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
import { NewWorkButton } from "./new-work";
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
  view = "actionable",
  basePath = "/workspace",
}: {
  projects: WorkspaceProjectSummary[];
  tasks: WorkspaceTaskSummary[];
  pipeline: WorkspacePipelineSummary[];
  inbound?: InboundRoutingSummary[];
  currentTime: number;
  view?: string;
  basePath?: string;
}) {
  const groups = [
    { id: "actionable", label: "我可处理", rows: tasks.filter(isActionableTask) },
    { id: "waiting", label: "等待他人", rows: tasks.filter((task) => task.state === "waiting") },
    {
      id: "processing",
      label: "系统处理中",
      rows: tasks.filter((task) => task.state === "processing"),
    },
    { id: "scheduled", label: "已安排", rows: tasks.filter((task) => task.state === "scheduled") },
  ];
  const selected = groups.find((group) => group.id === view) ?? groups[0]!;
  const pendingCount = groups[0]!.rows.length + inbound.length;
  return (
    <WorkspaceDirtyProvider>
      <main id="main-content" tabIndex={-1} className="workspace-page bg-muted/30">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-5 sm:p-6">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">今日任务</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {pendingCount
                  ? `${pendingCount} 项可以继续处理，按优先级从上往下开始。`
                  : "有新工作可直接开始；等待中的事项会随状态更新。"}
              </p>
            </div>
            <NewWorkButton />
          </header>
          <section id="my-tasks" aria-label="任务清单" className="min-w-0">
            <nav aria-label="任务状态" className="mb-3 flex flex-wrap gap-2">
              {groups.map((group) => (
                <Link
                  key={group.id}
                  href={group.id === "actionable" ? basePath : `${basePath}?view=${group.id}`}
                  aria-current={group.id === selected.id ? "page" : undefined}
                  className={buttonVariants({
                    variant: group.id === selected.id ? "secondary" : "ghost",
                    className: "min-h-11 gap-1.5",
                  })}
                >
                  {group.label}
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {group.rows.length + (group.id === "actionable" ? inbound.length : 0)}
                  </span>
                </Link>
              ))}
            </nav>
            <Card>
              <CardHeader className="pb-0">
                <CardTitle role="heading" aria-level={2}>
                  {selected.label}
                </CardTitle>
                <CardDescription>
                  {selected.id === "actionable"
                    ? "打开一项即可定位具体记录和下一动作。"
                    : "这些事项无需重复提交。状态变化后会重新归类。"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {selected.id === "actionable" ? (
                  <InboundRoutingList items={inbound} projects={projects} />
                ) : null}
                <TaskRows
                  tasks={selected.rows}
                  empty={
                    selected.id === "actionable" ? "当前没有需要你处理的任务" : "当前没有这类事项"
                  }
                />
                {!tasks.length && !inbound.length ? (
                  <div className="flex flex-wrap justify-center gap-2 pb-4">
                    <NewWorkButton intent="product">录入第一份产品资料</NewWorkButton>
                    <NewWorkButton intent="rfq" variant="outline">
                      记录客户询盘
                    </NewWorkButton>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </section>
          <section id="pipeline" className="flex flex-col gap-3" aria-label="项目概况">
            <div>
              <h2 className="text-base font-semibold">项目概况</h2>
              <p className="text-sm text-muted-foreground">
                项目用于组织资料和成员权限，具体工作从上方任务或固定栏目进入。
              </p>
            </div>
            {pipeline.length ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {pipeline.map((item) => (
                  <Card key={item.id} size="sm">
                    <CardHeader>
                      <CardTitle>
                        <Link
                          href={`/workspace/${item.id}`}
                          className="rounded underline-offset-4 hover:underline"
                        >
                          {item.title}
                        </Link>
                      </CardTitle>
                      <CardDescription>
                        {item.kind === "marketing" ? "营销项目" : "销售项目"} · {item.currentStage}{" "}
                        · {item.recordCount} 条记录
                      </CardDescription>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                开始第一项工作时，选择资料的归属项目。
              </p>
            )}
          </section>
        </div>
      </main>
    </WorkspaceDirtyProvider>
  );
}
