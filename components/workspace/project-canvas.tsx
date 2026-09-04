"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { Background, MiniMap, ReactFlow, applyNodeChanges, type Node, type NodeChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeftIcon, LayoutDashboardIcon, RotateCcwIcon, SaveIcon, XIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { saveWorkspaceCanvasAction } from "@/lib/actions/workspace";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useIsMobile } from "@/hooks/use-mobile";
import { workspaceCanvasDocumentSchema, type WorkspaceCanvasDocument } from "@/lib/workspace/contracts";
import type { WorkspaceProjectDetail, WorkspaceProjectSummary, WorkspaceTaskSummary } from "@/lib/workspace/store";
import { MarketingVideoPanel } from "@/components/workspace/marketing-video-panel";
import type { MarketingVideoCopyCandidate, MarketingVideoEditorEntry, ReadyVideoProductSource } from "@/lib/video/store";
import { CanvasControls, WorkflowNode, type WorkflowCanvasNode } from "./canvas-nodes";
import { WorkspaceActionDock } from "./workspace-action-dock";
import { WorkspaceDirtyProvider, useWorkspaceDirty, useWorkspaceDirtyState } from "./dirty-state";

type CanvasNode = Node<{ label: string; kind: string }>;
const nodeTypes = { workflow: WorkflowNode };

function toNodes(document: WorkspaceCanvasDocument): CanvasNode[] {
  return document.nodes.map((node) => ({ id: node.id, position: node.position, width: 176, height: 76, data: { label: node.label, kind: node.kind }, deletable: false }));
}

function toDocument(document: WorkspaceCanvasDocument, nodes: CanvasNode[]): WorkspaceCanvasDocument {
  return workspaceCanvasDocumentSchema.parse({ ...document, nodes: document.nodes.map((node) => ({ ...node, position: nodes.find((item) => item.id === node.id)?.position ?? node.position })) });
}

function statusLabel(state: "saved" | "saving" | "unsaved" | "conflict" | "error") {
  return ({ saved: "云端已保存", saving: "正在保存", unsaved: "布局未保存", conflict: "版本冲突", error: "保存失败" })[state];
}

export type ProjectCanvasVideoData = { products: ReadyVideoProductSource[]; entries: MarketingVideoEditorEntry[]; copyCandidates: MarketingVideoCopyCandidate[]; canReview: boolean; selectedId?: string };
export type ProjectCanvasPanels = Partial<Record<"product" | "content" | "video" | "publication" | "rfq" | "quotation" | "lead" | "delivery" | "approval", ReactNode>>;

function Inspector({ project, selected, onClose, videoEditor, panels, onDirtyChange }: { project: WorkspaceProjectDetail; selected: CanvasNode | null; onClose: () => void; videoEditor?: ProjectCanvasVideoData; panels?: ProjectCanvasPanels; onDirtyChange: (dirty: boolean) => void }) {
  const isMobile = useIsMobile();
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (selected && !isMobile) titleRef.current?.focus(); }, [isMobile, selected]);
  const body = selected?.data.kind === "video" && videoEditor
    ? <MarketingVideoPanel projectId={project.id} {...videoEditor} onDirtyChange={onDirtyChange} />
    : selected && panels?.[selected.data.kind as keyof ProjectCanvasPanels]
      ? panels[selected.data.kind as keyof ProjectCanvasPanels]
      : selected ? <div className="flex flex-col gap-4"><div className="flex flex-wrap gap-2"><Badge variant="secondary">{selected.data.kind}</Badge><Badge variant="outline">流程入口</Badge></div><div><h3 className="font-medium">{selected.data.label}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">固定节点只表达业务入口，项目记录由受控的项目归属关系管理。</p></div><Alert><AlertTitle>受控操作</AlertTitle><AlertDescription>产品事实、报价、交期和发布不能通过拖动或连线直接更改。</AlertDescription></Alert></div> : null;
  if (isMobile) return <Drawer open={Boolean(selected)} onOpenChange={(open) => { if (!open) onClose(); }} showSwipeHandle><DrawerContent><DrawerHeader className="relative pr-14 text-left"><DrawerTitle>{selected?.data.label ?? "项目检查器"}</DrawerTitle><DrawerDescription>{project.title}</DrawerDescription><Button type="button" size="icon" variant="ghost" className="absolute right-3 top-2" aria-label="关闭项目面板" onClick={onClose}><XIcon /></Button></DrawerHeader><ScrollArea className="min-h-0 flex-1"><div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">{body}</div></ScrollArea></DrawerContent></Drawer>;
  if (!selected) return null;
  return <aside className="absolute bottom-24 right-3 top-20 z-10 hidden w-[min(28rem,calc(100vw-3rem))] flex-col overflow-hidden rounded-2xl border bg-popover/95 shadow-lg backdrop-blur-xl md:flex" aria-label={`${selected.data.label}项目面板`}><header className="relative shrink-0 p-4 pr-14"><h2 ref={titleRef} tabIndex={-1} className="font-semibold outline-none">{selected.data.label}</h2><p className="mt-1 text-sm text-muted-foreground">{project.title}</p><Button type="button" size="icon" variant="ghost" className="absolute right-3 top-3" aria-label="关闭项目面板" onClick={onClose}><XIcon /></Button></header><ScrollArea className="min-h-0 flex-1 border-t"><div className="p-4">{body}</div></ScrollArea></aside>;
}

type ProjectCanvasProps = { project: WorkspaceProjectDetail; projects: WorkspaceProjectSummary[]; tasks: WorkspaceTaskSummary[]; settingsPanel?: ReactNode; videoEditor?: ProjectCanvasVideoData; panels?: ProjectCanvasPanels; readOnly?: boolean };

function ProjectCanvasInner({ project, projects, tasks, settingsPanel, videoEditor, panels, readOnly = false }: ProjectCanvasProps) {
  const router = useRouter(); const pathname = usePathname(); const searchParams = useSearchParams();
  const { requestNavigation } = useWorkspaceDirtyState();
  const [interactive, setInteractive] = useState(false);
  const [document, setDocument] = useState(project.document); const [nodes, setNodes] = useState<CanvasNode[]>(() => toNodes(project.document));
  const [arranging, setArranging] = useState(false);
  const panel = searchParams.get("panel");
  const selectedId = nodes.find((node) => node.data.kind === panel)?.id ?? null;
  const [panelDirty, setPanelDirty] = useState(false); const [revision, setRevision] = useState(project.revision); const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved" | "conflict" | "error">("saved"); const [notice, setNotice] = useState(""); const [pending, startTransition] = useTransition();
  useWorkspaceDirty("canvas-layout", saveState === "unsaved" || saveState === "conflict" || saveState === "error");
  useWorkspaceDirty("active-panel", panelDirty);
  useEffect(() => setInteractive(true), []);
  const triggerRef = useRef<HTMLElement | null>(null);
  const selected = useMemo(() => nodes.find((node) => node.id === selectedId) ?? null, [nodes, selectedId]);
  const setPanel = useCallback((kind: string | null, nodeId?: string) => {
    if (kind === panel) return;
    requestNavigation(() => {
      if (nodeId) triggerRef.current = window.document.querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"] button`);
      const params = new URLSearchParams(searchParams.toString());
      if (kind) params.set("panel", kind); else params.delete("panel");
      router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
      setPanelDirty(false);
      if (!kind) requestAnimationFrame(() => triggerRef.current?.focus());
    });
  }, [panel, pathname, requestNavigation, router, searchParams]);
  const moveNode = useCallback((id: string, deltaX: number, deltaY: number) => {
    setNodes((current) => current.map((node) => node.id === id ? { ...node, position: { x: node.position.x + deltaX, y: node.position.y + deltaY } } : node));
    setSaveState("unsaved");
  }, []);
  useEffect(() => {
    if (!selectedId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setPanel(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedId, setPanel]);
  const canArrange = arranging && !readOnly;
  const renderedNodes = useMemo(() => nodes.map((node) => ({ ...node, type: "workflow", draggable: canArrange, data: { ...node.data, arranging: canArrange, onOpen: (id: string, kind: string) => setPanel(kind, id), onMove: moveNode } })) as WorkflowCanvasNode[], [canArrange, moveNode, nodes, setPanel]);
  function onNodesChange(changes: NodeChange[]) { if (!canArrange) return; const material = changes.filter((change) => change.type === "position" && Boolean(change.position) && change.dragging === true); if (!material.length) return; setNodes((current) => applyNodeChanges(material, current) as CanvasNode[]); setSaveState("unsaved"); }
  function cancelArrange() { setNodes(toNodes(document)); setSaveState("saved"); setNotice("已恢复上次保存的布局。"); setArranging(false); }
  function save() { const next = toDocument(document, nodes); setSaveState("saving"); startTransition(async () => { const result = await saveWorkspaceCanvasAction(project.id, { expectedRevision: revision, document: next }); setNotice(result.message); if (result.status === "success" && result.revision) { setDocument(next); setRevision(result.revision); setSaveState("saved"); setArranging(false); } else setSaveState(result.status === "conflict" ? "conflict" : "error"); }); }
  return <main id="main-content" className="fixed inset-0 overflow-hidden bg-muted" aria-label={`${project.title} 项目画布`}><ReactFlow className={`bg-background transition-opacity duration-[120ms] ${interactive ? "opacity-100" : "pointer-events-none opacity-0"}`} nodes={renderedNodes} nodeTypes={nodeTypes} edges={document.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target }))} onNodesChange={onNodesChange} onNodeClick={(_event, node) => setPanel(node.data.kind, node.id)} onPaneClick={() => setPanel(null)} minZoom={0.75} maxZoom={1.5} defaultViewport={{ x: 32, y: 200, zoom: 1 }} autoPanOnNodeFocus={false} nodesDraggable={canArrange} nodesFocusable={false} nodesConnectable={false} elementsSelectable><Background /><CanvasControls />{interactive ? <MiniMap className="hidden md:block" nodeColor={() => "#64748b"} position="bottom-left" /> : null}</ReactFlow>
    {!interactive ? <div className="absolute inset-0 z-30 bg-background" aria-hidden="true" /> : null}
    <header className="absolute left-3 top-3 z-10 flex max-w-[calc(100vw-4.5rem)] flex-wrap items-center gap-2 rounded-xl border bg-background/90 p-2 shadow-sm backdrop-blur-xl md:left-6 md:top-6">{readOnly ? <LinkButton href={`/workspace/${project.id}`} size="sm" variant="ghost"><ArrowLeftIcon data-icon="inline-start" />返回项目工作区</LinkButton> : null}<span className="max-w-56 truncate px-1 text-sm font-semibold">{project.title}</span><Badge variant="secondary">{project.kind === "marketing" ? "产品营销" : "销售机会"}</Badge><Badge variant="outline">{project.status === "active" ? "进行中" : "已归档"}</Badge><Badge variant={saveState === "saved" ? "secondary" : "outline"} aria-live="polite">{readOnly ? "只读流程概览" : statusLabel(saveState)}</Badge><Badge variant="outline">人工审核受控</Badge>{!readOnly ? <Button type="button" size="sm" variant={arranging ? "secondary" : "ghost"} onClick={() => setArranging(true)}><LayoutDashboardIcon data-icon="inline-start" />整理画布</Button> : null}{!readOnly && arranging && saveState !== "saved" ? <><Button type="button" size="sm" variant="ghost" onClick={cancelArrange}><RotateCcwIcon data-icon="inline-start" />取消</Button><Button type="button" size="sm" onClick={save} disabled={pending}><SaveIcon data-icon="inline-start" />{pending ? "保存中" : "保存布局"}</Button></> : null}</header>
    {notice ? <Alert className="absolute bottom-24 left-3 z-10 w-[min(30rem,calc(100vw-1.5rem))] bg-background/95 md:left-6"><AlertTitle>{saveState === "conflict" || saveState === "error" ? "需要处理" : "布局已更新"}</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert> : null}
    <WorkspaceActionDock projects={projects} tasks={tasks} settingsPanel={settingsPanel} activeProjectId={project.id} />
    <Inspector project={project} selected={selected} onClose={() => setPanel(null)} videoEditor={videoEditor} panels={panels} onDirtyChange={setPanelDirty} />
  </main>;
}

export function ProjectCanvas(props: ProjectCanvasProps) {
  return <WorkspaceDirtyProvider><ProjectCanvasInner {...props} /></WorkspaceDirtyProvider>;
}
