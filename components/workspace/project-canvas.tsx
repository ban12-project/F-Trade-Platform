"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { Background, Controls, MiniMap, ReactFlow, applyNodeChanges, type Node, type NodeChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { saveWorkspaceCanvasAction } from "@/lib/actions/workspace";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useIsMobile } from "@/hooks/use-mobile";
import { workspaceCanvasDocumentSchema, type WorkspaceCanvasDocument } from "@/lib/workspace/contracts";
import type { WorkspaceProjectDetail, WorkspaceProjectSummary, WorkspaceTaskSummary } from "@/lib/workspace/store";
import { MarketingVideoPanel } from "@/components/workspace/marketing-video-panel";
import type { MarketingVideoCopyCandidate, MarketingVideoEditorEntry, ReadyVideoProductSource } from "@/lib/video/store";
import { WorkspaceActionDock } from "./workspace-action-dock";
import { WorkspaceDirtyProvider, useWorkspaceDirty, useWorkspaceDirtyState } from "./dirty-state";

type CanvasNode = Node<{ label: string; kind: string }>;
const nodeTone: Record<string, string> = { product: "#0ea5e9", content: "#8b5cf6", video: "#ec4899", rfq: "#f59e0b", approval: "#10b981", quotation: "#64748b", delivery: "#14b8a6", note: "#94a3b8" };

function toNodes(document: WorkspaceCanvasDocument): CanvasNode[] { return document.nodes.map((node) => ({ id: node.id, position: node.position, data: { label: node.kind === "video" ? "营销视频" : node.label, kind: node.kind }, draggable: !node.locked, deletable: false, style: { borderColor: nodeTone[node.kind] ?? "#64748b" } })); }
function toDocument(document: WorkspaceCanvasDocument, nodes: CanvasNode[]): WorkspaceCanvasDocument { return workspaceCanvasDocumentSchema.parse({ ...document, nodes: document.nodes.map((node) => ({ ...node, position: nodes.find((item) => item.id === node.id)?.position ?? node.position })) }); }
function statusLabel(state: "saved" | "saving" | "unsaved" | "conflict" | "error") { return ({ saved: "云端已保存", saving: "正在保存", unsaved: "尚未保存", conflict: "版本冲突", error: "保存失败" })[state]; }

export type ProjectCanvasVideoData = { products: ReadyVideoProductSource[]; entries: MarketingVideoEditorEntry[]; copyCandidates: MarketingVideoCopyCandidate[]; canReview: boolean; selectedId?: string };
export type ProjectCanvasPanels = Partial<Record<"product" | "content" | "rfq" | "quotation" | "delivery" | "approval", ReactNode>>;

function Inspector({ project, selected, onClose, videoEditor, panels, onDirtyChange }: { project: WorkspaceProjectDetail; selected: CanvasNode | null; onClose: () => void; videoEditor?: ProjectCanvasVideoData; panels?: ProjectCanvasPanels; onDirtyChange: (dirty: boolean) => void }) {
  const isMobile = useIsMobile();
  const body = selected?.data.kind === "video" && videoEditor
    ? <MarketingVideoPanel projectId={project.id} {...videoEditor} onDirtyChange={onDirtyChange} />
    : selected && panels?.[selected.data.kind as keyof ProjectCanvasPanels]
      ? panels[selected.data.kind as keyof ProjectCanvasPanels]
    : selected ? <div className="flex flex-col gap-4"><div className="flex flex-wrap gap-2"><Badge variant="secondary">{selected.data.kind}</Badge><Badge variant="outline">流程入口</Badge></div><div><h3 className="font-medium">{selected.data.label}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">固定节点只表达业务入口，项目记录由受控的项目归属关系管理。</p></div><Alert><AlertTitle>受控操作</AlertTitle><AlertDescription>产品事实、报价、交期和发布不能通过拖动或连线直接更改。</AlertDescription></Alert></div> : <p className="text-sm leading-6 text-muted-foreground">选择一个节点以查看其上下文和可执行操作。</p>;
  if (isMobile) return <Drawer open={Boolean(selected)} onOpenChange={(open) => { if (!open) onClose(); }} showSwipeHandle><DrawerContent><DrawerHeader><DrawerTitle>项目检查器</DrawerTitle><DrawerDescription>{selected?.data.label ?? "选择节点"}</DrawerDescription></DrawerHeader><ScrollArea className="min-h-0 flex-1"><div className="p-4">{body}</div></ScrollArea></DrawerContent></Drawer>;
  if (!selected) return null;
  return <aside className="fixed right-6 top-6 z-10 hidden w-[min(28rem,calc(100vw-3rem))] max-h-[calc(100dvh-3rem)] flex-col overflow-hidden rounded-xl border bg-popover shadow-lg md:flex"><header className="shrink-0 border-b p-4"><h2 className="font-semibold">{selected.data.label}</h2><p className="mt-1 text-sm text-muted-foreground">{project.title}</p></header><ScrollArea className="min-h-0 flex-1"><div className="p-4">{body}</div></ScrollArea></aside>;
}

type ProjectCanvasProps = { project: WorkspaceProjectDetail; projects: WorkspaceProjectSummary[]; tasks: WorkspaceTaskSummary[]; settingsPanel?: ReactNode; videoEditor?: ProjectCanvasVideoData; panels?: ProjectCanvasPanels };

function ProjectCanvasInner({ project, projects, tasks, settingsPanel, videoEditor, panels }: ProjectCanvasProps) {
  const router = useRouter(); const pathname = usePathname(); const searchParams = useSearchParams();
  const { confirmNavigation } = useWorkspaceDirtyState();
  const [document, setDocument] = useState(project.document); const [nodes, setNodes] = useState<CanvasNode[]>(() => toNodes(project.document));
  const panel = searchParams.get("panel");
  const selectedId = nodes.find((node) => node.data.kind === panel)?.id ?? null;
  const [panelDirty, setPanelDirty] = useState(false); const [revision, setRevision] = useState(project.revision); const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved" | "conflict" | "error">("saved"); const [notice, setNotice] = useState(""); const [pending, startTransition] = useTransition();
  useWorkspaceDirty("canvas-layout", saveState === "unsaved" || saveState === "conflict" || saveState === "error");
  useWorkspaceDirty("active-panel", panelDirty);
  const focusRef = useRef<HTMLDivElement>(null); const selected = useMemo(() => nodes.find((node) => node.id === selectedId) ?? null, [nodes, selectedId]);
  useEffect(() => { if (!selected) focusRef.current?.focus(); }, [selected]);
  function onNodesChange(changes: NodeChange[]) { const material = changes.filter((change) => change.type === "position" && Boolean(change.position)); if (!material.length) return; setNodes((current) => applyNodeChanges(material, current) as CanvasNode[]); setSaveState("unsaved"); }
  function setPanel(kind: string | null) { if (kind === panel) return; if (!confirmNavigation()) return; const params = new URLSearchParams(searchParams.toString()); if (kind) params.set("panel", kind); else params.delete("panel"); router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false }); setPanelDirty(false); }
  function save() { const next = toDocument(document, nodes); setSaveState("saving"); startTransition(async () => { const result = await saveWorkspaceCanvasAction(project.id, { expectedRevision: revision, document: next }); setNotice(result.message); if (result.status === "success" && result.revision) { setDocument(next); setRevision(result.revision); setSaveState("saved"); } else setSaveState(result.status === "conflict" ? "conflict" : "error"); }); }
  return <main ref={focusRef} tabIndex={-1} id="main-content" className="fixed inset-0 overflow-hidden bg-muted outline-none" aria-label={`${project.title} 项目画布`}><ReactFlow className="bg-background" nodes={nodes} edges={document.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target }))} onNodesChange={onNodesChange} onNodeClick={(_, node) => setPanel(String(node.data.kind))} onPaneClick={() => setPanel(null)} fitView nodesDraggable><Background /><Controls position="top-right" /><MiniMap className="hidden md:block" nodeColor={(node) => nodeTone[String(node.data?.kind)] ?? "#64748b"} position="bottom-left" /></ReactFlow>
    <header className="absolute left-3 top-3 z-10 flex max-w-[calc(100vw-6rem)] flex-wrap items-center gap-2 md:left-6 md:top-6"><Badge variant="secondary">{project.kind === "marketing" ? "产品营销" : "销售机会"}</Badge><Badge variant="outline">{project.status === "active" ? "进行中" : "已归档"}</Badge><Badge variant={saveState === "saved" ? "secondary" : "outline"} aria-live="polite">{statusLabel(saveState)}</Badge><Badge variant="outline">人工审核受控</Badge></header>
    {notice ? <Alert className="absolute bottom-4 left-3 z-10 w-[min(30rem,calc(100vw-1.5rem))] md:left-6"><AlertTitle>{saveState === "conflict" || saveState === "error" ? "需要处理" : "已更新"}</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert> : null}
    <WorkspaceActionDock projects={projects} tasks={tasks} settingsPanel={settingsPanel} activeProjectId={project.id} onSave={save} saveDisabled={saveState === "saved"} savePending={pending || saveState === "saving"} />
    <Inspector project={project} selected={selected} onClose={() => setPanel(null)} videoEditor={videoEditor} panels={panels} onDirtyChange={setPanelDirty} />
  </main>;
}

export function ProjectCanvas(props: ProjectCanvasProps) {
  return <WorkspaceDirtyProvider><ProjectCanvasInner {...props} /></WorkspaceDirtyProvider>;
}
