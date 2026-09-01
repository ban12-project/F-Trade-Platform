"use client";

import { Background, Controls, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import type { WorkspaceProjectSummary, WorkspaceTaskSummary } from "@/lib/workspace/store";
import { WorkspaceActionDock } from "./workspace-action-dock";
import { WorkspaceDirtyProvider } from "./dirty-state";

export function WorkspaceHub({ projects, tasks, settingsPanel }: { projects: WorkspaceProjectSummary[]; tasks: WorkspaceTaskSummary[]; settingsPanel?: ReactNode }) {
  return <WorkspaceDirtyProvider><main id="main-content" className="fixed inset-0 overflow-hidden bg-muted" aria-label="项目总画布"><ReactFlow className="bg-background" nodes={[]} edges={[]}><Background /><Controls position="top-right" /></ReactFlow>
    <header className="absolute left-3 top-3 z-10 flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center gap-2 md:left-6 md:top-6"><Badge variant="secondary">项目画布</Badge><Badge variant="outline">人工审核受控</Badge></header>
    <WorkspaceActionDock projects={projects} tasks={tasks} settingsPanel={settingsPanel} />
  </main></WorkspaceDirtyProvider>;
}
