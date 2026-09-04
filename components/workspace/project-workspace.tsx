"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftIcon, ArrowRightIcon, FilmIcon, GitBranchIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { WorkspaceProjectDetail, WorkspaceProjectSummary, WorkspaceTaskSummary } from "@/lib/workspace/store";
import { WorkspaceActionDock } from "./workspace-action-dock";
import { WorkspaceDirtyProvider } from "./dirty-state";

export type ProjectStage = { id: string; panelKind: string; label: string; description: string };

export function VideoStageEntry({ projectId, count, pendingReview }: { projectId: string; count: number; pendingReview: number }) {
  return <Card><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>视频制作</CardTitle><CardDescription>素材、预览、时间线、版本和提审在独立编辑器中完成。</CardDescription></div><FilmIcon className="size-5 text-muted-foreground" /></div></CardHeader><CardContent className="space-y-4"><div className="flex gap-2"><Badge variant="outline">{count} 个版本</Badge>{pendingReview ? <Badge>{pendingReview} 个待审核</Badge> : null}</div><LinkButton href={`/workspace/${projectId}/video`} className="w-full">打开视频编辑器<ArrowRightIcon data-icon="inline-end" /></LinkButton></CardContent></Card>;
}

export function ProjectWorkspace({ project, projects, tasks, settingsPanel, membersPanel, stages, activeStage, panel, basePath = `/workspace/${project.id}` }: { project: WorkspaceProjectDetail; projects: WorkspaceProjectSummary[]; tasks: WorkspaceTaskSummary[]; settingsPanel?: ReactNode; membersPanel?: ReactNode; stages: ProjectStage[]; activeStage: string; panel: ReactNode; basePath?: string }) {
  const projectTasks = tasks.filter((task) => task.projectId === project.id);
  const stage = stages.find((item) => item.id === activeStage) ?? stages[0]!;
  const stageTasks = projectTasks.filter((task) => task.nodeKind === stage.panelKind && (stage.id === "opportunity" ? task.taskType === "opportunity" : stage.id === "follow-up" ? task.taskType === "follow_up" : true));
  return <WorkspaceDirtyProvider><main id="main-content" className="min-h-screen bg-muted/30 pb-24">
    <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur-xl"><div className="mx-auto flex max-w-[96rem] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6"><div className="flex min-w-0 items-center gap-3"><LinkButton href="/workspace" size="icon" variant="ghost" aria-label="返回全局工作台"><ArrowLeftIcon /></LinkButton><div className="min-w-0"><h1 className="truncate text-lg font-semibold tracking-tight">{project.title}</h1><div className="mt-1 flex flex-wrap gap-2"><Badge variant="secondary">{project.kind === "marketing" ? "营销项目" : "销售项目"}</Badge><Badge variant="outline">{project.status === "active" ? "进行中" : "已归档"}</Badge><Badge variant="outline">人工 Gate 受控</Badge></div></div></div><div className="flex items-center gap-2">{membersPanel}<LinkButton href={`/workspace/${project.id}`} variant="outline" className="min-h-11"><GitBranchIcon data-icon="inline-start" />项目画布</LinkButton></div></div></header>
    <div className="mx-auto max-w-[96rem] px-4 py-5 sm:px-6">
      <nav aria-label="项目阶段" className="overflow-x-auto pb-2"><ol className="flex min-w-max items-stretch gap-1">{stages.map((item, index) => <li key={item.id} className="flex items-center"><Link href={`${basePath}?panel=${item.id}&view=records`} aria-current={item.id === activeStage ? "step" : undefined} className={`flex min-h-14 w-40 flex-col justify-center rounded-xl border px-3 outline-none transition-[background-color,border-color,transform] duration-[120ms] active:scale-[0.98] focus-visible:ring-3 focus-visible:ring-ring/50 ${item.id === activeStage ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}><span className="text-xs opacity-75">阶段 {index + 1}</span><span className="text-sm font-medium">{item.label}</span></Link>{index < stages.length - 1 ? <ArrowRightIcon className="mx-1 size-4 text-muted-foreground" aria-hidden="true" /> : null}</li>)}</ol></nav>
      <section aria-label="当前阶段" className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,34rem)]">
        <div className="min-w-0 space-y-5"><Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardDescription>当前阶段</CardDescription><CardTitle role="heading" aria-level={2} className="mt-1">{stage.label}</CardTitle><p className="mt-2 text-sm text-muted-foreground">{stage.description}</p></div><Badge>{stageTasks.length ? `${stageTasks.length} 项待办` : "当前无待办"}</Badge></div></CardHeader></Card><Card><CardHeader><CardTitle role="heading" aria-level={2}>业务记录与下一动作</CardTitle><CardDescription>选择记录后，右侧显示详情、表单或人工审批。</CardDescription></CardHeader><CardContent>{stageTasks.length ? <div className="divide-y">{stageTasks.map((task) => <Link key={`${task.taskType}-${task.id}`} href={`${basePath}?panel=${task.nodeKind}&view=records&item=${task.id}`} className="group flex min-h-16 items-center gap-3 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{task.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{task.detail}</p></div><Badge variant={task.priority === "review" ? "default" : "secondary"}>{task.actionLabel ?? "打开"}</Badge><ArrowRightIcon className="size-4 text-muted-foreground transition-transform duration-[120ms] group-hover:translate-x-0.5" /></Link>)}</div> : <p className="py-8 text-center text-sm text-muted-foreground">本阶段暂无待办，可在右侧创建或查看业务记录。</p>}</CardContent></Card></div>
        <aside aria-label={`${stage.label}详情与审批`} className="min-w-0"><Card className="overflow-hidden"><CardHeader className="border-b"><CardTitle role="heading" aria-level={2}>{stage.label}详情</CardTitle><CardDescription>任何批准、发送、发布和业务认定都需要明确的人工作用。</CardDescription></CardHeader><CardContent className="p-0"><ScrollArea className="h-[calc(100vh-17rem)] min-h-[32rem]"><div className="p-4 sm:p-5">{panel}</div></ScrollArea></CardContent></Card></aside>
      </section>
    </div>
    <WorkspaceActionDock projects={projects} tasks={tasks} settingsPanel={settingsPanel} activeProjectId={project.id} />
  </main></WorkspaceDirtyProvider>;
}
