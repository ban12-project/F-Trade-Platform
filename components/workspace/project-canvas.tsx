"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Background, Controls, MiniMap, ReactFlow, applyNodeChanges, type Node, type NodeChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeftIcon, SaveIcon, Settings2Icon } from "lucide-react";
import Link from "next/link";

import { saveWorkspaceCanvasAction } from "@/lib/actions/workspace";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { workspaceCanvasDocumentSchema, type WorkspaceCanvasDocument } from "@/lib/workspace/contracts";
import type { WorkspaceProjectDetail } from "@/lib/workspace/store";

type CanvasNode = Node<{ label: string; kind: string; aggregateId?: string }>;
const nodeTone: Record<string, string> = { product: "#0ea5e9", content: "#8b5cf6", video: "#ec4899", rfq: "#f59e0b", approval: "#10b981", quotation: "#64748b", delivery: "#14b8a6", note: "#94a3b8" };

function toNodes(document: WorkspaceCanvasDocument): CanvasNode[] { return document.nodes.map((node) => ({ id: node.id, position: node.position, data: { label: node.label, kind: node.kind, aggregateId: node.aggregateId }, draggable: !node.locked, deletable: false, style: { borderColor: nodeTone[node.kind] ?? "#64748b" } })); }
function toDocument(document: WorkspaceCanvasDocument, nodes: CanvasNode[]): WorkspaceCanvasDocument { return workspaceCanvasDocumentSchema.parse({ ...document, nodes: document.nodes.map((node) => ({ ...node, position: nodes.find((item) => item.id === node.id)?.position ?? node.position })) }); }
function statusLabel(state: "saved" | "saving" | "unsaved" | "conflict" | "error") { return ({ saved: "云端已保存", saving: "正在保存", unsaved: "尚未保存", conflict: "版本冲突", error: "保存失败" })[state]; }

function Inspector({ project, selected, onClose }: { project: WorkspaceProjectDetail; selected: CanvasNode | null; onClose: () => void }) {
  const body = selected ? <div className="flex flex-col gap-4"><div className="flex flex-wrap gap-2"><Badge variant="secondary">{selected.data.kind}</Badge>{selected.data.aggregateId ? <Badge variant="outline">已关联记录</Badge> : <Badge variant="outline">流程节点</Badge>}</div><div><h3 className="font-medium">{selected.data.label}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{selected.data.aggregateId ? "此节点仅引用受控业务记录；事实、审核与状态仍由原工作流维护。" : "这是项目模板中的固定流程步骤。"}</p></div><Alert><AlertTitle>受控操作</AlertTitle><AlertDescription>产品事实、报价、交期和发布不能通过拖动或连线直接更改。</AlertDescription></Alert></div> : <p className="text-sm leading-6 text-muted-foreground">选择一个节点以查看其上下文和可执行操作。</p>;
  return <><div className="hidden md:block"><aside className="fixed right-6 top-6 z-10 flex w-[min(26rem,calc(100vw-3rem))] max-h-[calc(100dvh-3rem)] flex-col overflow-hidden rounded-xl border bg-popover shadow-lg"><header className="shrink-0 border-b p-4"><h2 className="font-semibold">项目检查器</h2><p className="mt-1 text-sm text-muted-foreground">{project.title}</p></header><ScrollArea className="min-h-0 flex-1"><div className="p-4">{body}</div></ScrollArea><footer className="shrink-0 border-t p-4"><Button className="w-full" variant="outline"><Settings2Icon data-icon="inline-start" />项目设置</Button></footer></aside></div><Drawer open={Boolean(selected)} onOpenChange={(open) => { if (!open) onClose(); }} showSwipeHandle><DrawerContent className="md:hidden"><DrawerHeader><DrawerTitle>项目检查器</DrawerTitle><DrawerDescription>{selected?.data.label ?? "选择节点"}</DrawerDescription></DrawerHeader><ScrollArea className="min-h-0 flex-1"><div className="p-4">{body}</div></ScrollArea></DrawerContent></Drawer></>;
}

export function ProjectCanvas({ project }: { project: WorkspaceProjectDetail }) {
  const [document, setDocument] = useState(project.document); const [nodes, setNodes] = useState<CanvasNode[]>(() => toNodes(project.document));
  const [selectedId, setSelectedId] = useState<string | null>(null); const [revision, setRevision] = useState(project.revision); const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved" | "conflict" | "error">("saved"); const [notice, setNotice] = useState(""); const [pending, startTransition] = useTransition();
  const focusRef = useRef<HTMLDivElement>(null); const selected = useMemo(() => nodes.find((node) => node.id === selectedId) ?? null, [nodes, selectedId]);
  useEffect(() => { if (!selected) focusRef.current?.focus(); }, [selected]);
  function onNodesChange(changes: NodeChange[]) { const material = changes.filter((change) => change.type !== "select"); if (!material.length) return; setNodes((current) => applyNodeChanges(material, current) as CanvasNode[]); setSaveState("unsaved"); }
  function save() { const next = toDocument(document, nodes); setSaveState("saving"); startTransition(async () => { const result = await saveWorkspaceCanvasAction(project.id, { expectedRevision: revision, document: next }); setNotice(result.message); if (result.status === "success" && result.revision) { setDocument(next); setRevision(result.revision); setSaveState("saved"); } else setSaveState(result.status === "conflict" ? "conflict" : "error"); }); }
  return <main ref={focusRef} tabIndex={-1} id="main-content" className="fixed inset-0 overflow-hidden bg-muted outline-none" aria-label={`${project.title} 项目画布`}><ReactFlow className="bg-background" nodes={nodes} edges={document.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target }))} onNodesChange={onNodesChange} onNodeClick={(_, node) => setSelectedId(node.id)} onPaneClick={() => setSelectedId(null)} fitView nodesDraggable><Background /><Controls position="top-right" /><MiniMap className="hidden md:block" nodeColor={(node) => nodeTone[String(node.data?.kind)] ?? "#64748b"} position="bottom-left" /></ReactFlow>
    <header className="absolute left-3 top-3 z-10 flex max-w-[calc(100vw-6rem)] flex-wrap items-center gap-2 rounded-lg border bg-background/90 p-2 shadow-sm backdrop-blur md:left-6 md:top-6"><Button variant="ghost" size="icon" render={<Link href="/workspace" />} aria-label="返回项目列表"><ArrowLeftIcon /></Button><Badge variant="secondary">{project.kind === "marketing" ? "产品营销" : "销售机会"}</Badge><Badge variant="outline">{project.status === "active" ? "进行中" : "已归档"}</Badge><Badge variant={saveState === "saved" ? "secondary" : "outline"} aria-live="polite">{statusLabel(saveState)}</Badge><Badge variant="outline">人工审核受控</Badge><Button size="sm" variant="outline" disabled={pending || saveState === "saved"} onClick={save}><SaveIcon data-icon="inline-start" />保存</Button></header>
    {notice ? <Alert className="absolute bottom-4 left-3 z-10 w-[min(30rem,calc(100vw-1.5rem))] md:left-6"><AlertTitle>{saveState === "conflict" || saveState === "error" ? "需要处理" : "已更新"}</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert> : null}
    <Inspector project={project} selected={selected} onClose={() => setSelectedId(null)} />
  </main>;
}
