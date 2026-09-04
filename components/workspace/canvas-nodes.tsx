"use client";

import { memo } from "react";
import { Handle, Panel, Position, useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { ArrowRightIcon, CheckCircle2Icon, MinusIcon, PlusIcon, ScanIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type WorkflowCanvasNode = Node<{
  label: string;
  kind: string;
  selected?: boolean;
  arranging: boolean;
  onOpen: (id: string, kind: string) => void;
  onMove: (id: string, deltaX: number, deltaY: number) => void;
}>;

export const workflowNodeTone: Record<string, string> = {
  product: "border-sky-500/50",
  content: "border-violet-500/50",
  video: "border-pink-500/50",
  publication: "border-cyan-500/50",
  rfq: "border-amber-500/50",
  approval: "border-emerald-500/50",
  quotation: "border-slate-500/50",
  lead: "border-indigo-500/50",
  delivery: "border-teal-500/50",
  note: "border-border",
};

function WorkflowNodeView({ id, data, selected }: NodeProps<WorkflowCanvasNode>) {
  return (
    <>
      <Handle type="target" position={Position.Left} className="opacity-40" />
      <button
        type="button"
        className={cn(
          "flex min-h-16 w-44 flex-col items-start justify-center gap-1 rounded-xl border-2 bg-card px-4 py-3 text-left text-card-foreground shadow-sm outline-none transition-[transform,box-shadow,border-color] duration-[120ms] ease-[var(--ease-out)] active:scale-[0.98] focus-visible:ring-3 focus-visible:ring-ring/50",
          !data.arranging && "nodrag",
          workflowNodeTone[data.kind],
          selected && "shadow-md ring-2 ring-ring/30",
        )}
        aria-label={`${data.label}，打开流程面板`}
        onClick={(event) => {
          event.stopPropagation();
          data.onOpen(id, data.kind);
        }}
        onKeyDown={(event) => {
          if (!data.arranging || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          const step = event.shiftKey ? 1 : 8;
          data.onMove(id, event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0);
        }}
      >
        <span className="text-sm font-semibold">{data.label}</span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          打开流程 <ArrowRightIcon aria-hidden="true" />
        </span>
      </button>
      <Handle type="source" position={Position.Right} className="opacity-40" />
    </>
  );
}

export const WorkflowNode = memo(WorkflowNodeView);

export type ProjectSummaryCanvasNode = Node<{
  title: string;
  kind: "marketing" | "sales";
  status: "active" | "archived";
  taskCount: number;
  nextAction?: string;
  onOpen: (id: string) => void;
}>;

function ProjectSummaryNodeView({ id, data }: NodeProps<ProjectSummaryCanvasNode>) {
  return (
    <button
      type="button"
      className="nodrag flex min-h-24 w-56 flex-col items-start gap-2 rounded-2xl border bg-card p-4 text-left text-card-foreground shadow-sm outline-none transition-[transform,box-shadow] duration-[120ms] ease-[var(--ease-out)] active:scale-[0.98] focus-visible:ring-3 focus-visible:ring-ring/50"
      aria-label={`${data.title}，${data.taskCount ? `${data.taskCount} 项待办` : "没有待办"}`}
      onClick={() => data.onOpen(id)}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <Badge variant="secondary">{data.kind === "marketing" ? "产品营销" : "销售机会"}</Badge>
        {data.taskCount ? <Badge>{data.taskCount} 项待办</Badge> : <CheckCircle2Icon aria-label="没有待办" className="text-muted-foreground" />}
      </span>
      <span className="max-w-full truncate text-base font-semibold">{data.title}</span>
      <span className="max-w-full truncate text-xs text-muted-foreground">{data.nextAction ?? (data.status === "active" ? "打开项目画布" : "查看已归档项目")}</span>
    </button>
  );
}

export const ProjectSummaryNode = memo(ProjectSummaryNodeView);

export function CanvasControls() {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  return <Panel position="top-right" className="react-flow__controls" role="group" aria-label="画布缩放">
    <button type="button" className="react-flow__controls-button" aria-label="放大画布" onClick={() => zoomIn()}><PlusIcon /></button>
    <button type="button" className="react-flow__controls-button" aria-label="缩小画布" onClick={() => zoomOut()}><MinusIcon /></button>
    <button type="button" className="react-flow__controls-button" aria-label="查看全局" onClick={() => fitView({ minZoom: 0.75, maxZoom: 1 })}><ScanIcon /></button>
  </Panel>;
}
