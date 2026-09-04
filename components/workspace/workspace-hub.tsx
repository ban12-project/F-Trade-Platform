"use client";

import { useMemo, type ReactNode } from "react";
import { Background, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FolderPlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { WorkspaceProjectSummary, WorkspaceTaskSummary } from "@/lib/workspace/store";
import { CanvasControls, ProjectSummaryNode, type ProjectSummaryCanvasNode } from "./canvas-nodes";
import { WorkspaceActionDock } from "./workspace-action-dock";
import { WorkspaceDirtyProvider } from "./dirty-state";

const nodeTypes = { projectSummary: ProjectSummaryNode };

export function WorkspaceHub({ projects, tasks, settingsPanel }: { projects: WorkspaceProjectSummary[]; tasks: WorkspaceTaskSummary[]; settingsPanel?: ReactNode }) {
  const router = useRouter();
  const nodes = useMemo(() => projects.map((project, index) => {
    const projectTasks = tasks.filter((task) => task.projectId === project.id);
    const node: ProjectSummaryCanvasNode = {
      id: project.id,
      type: "projectSummary",
      position: { x: 40 + (index % 3) * 300, y: 60 + Math.floor(index / 3) * 180 },
      data: {
        title: project.title,
        kind: project.kind,
        status: project.status,
        taskCount: projectTasks.length,
        nextAction: projectTasks[0]?.actionLabel ?? projectTasks[0]?.detail,
        onOpen: (id) => router.push(`/workspace/${id}`),
      },
      deletable: false,
      draggable: false,
      width: 224,
      height: 96,
    };
    return node;
  }), [projects, router, tasks]);
  return <WorkspaceDirtyProvider><main id="main-content" className="fixed inset-0 overflow-hidden bg-muted" aria-label="项目总画布"><ReactFlow className="bg-background" nodes={nodes} nodeTypes={nodeTypes} edges={[]} minZoom={0.75} maxZoom={1.5} defaultViewport={{ x: 24, y: 104, zoom: 1 }} nodesDraggable={false} nodesConnectable={false}><Background /><CanvasControls /></ReactFlow>
    <header className="absolute left-3 top-3 z-10 flex max-w-[calc(100vw-4.5rem)] flex-wrap items-center gap-2 rounded-xl border bg-background/90 p-2 shadow-sm backdrop-blur-xl md:left-6 md:top-6"><span className="px-1 text-sm font-semibold">项目总画布</span><Badge variant="secondary">{projects.length} 个项目</Badge><Badge variant="outline">{tasks.length} 项待办</Badge><Badge variant="outline">人工审核受控</Badge></header>
    {!projects.length ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6"><Empty className="pointer-events-auto max-w-sm rounded-2xl border bg-background/95 shadow-sm"><EmptyHeader><EmptyMedia variant="icon"><FolderPlusIcon /></EmptyMedia><EmptyTitle>从一张项目画布开始</EmptyTitle><EmptyDescription>使用底部“新建项目”创建产品营销或销售机会项目。</EmptyDescription></EmptyHeader></Empty></div> : null}
    <WorkspaceActionDock projects={projects} tasks={tasks} settingsPanel={settingsPanel} />
  </main></WorkspaceDirtyProvider>;
}
