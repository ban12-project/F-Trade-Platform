"use client";

import { useCallback, useMemo, useState } from "react";
import { Background, Controls, MiniMap, ReactFlow, addEdge, applyNodeChanges, type Connection, type Edge, type Node, type NodeChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ClapperboardIcon, PlusIcon, SparklesIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { ReadyVideoProductSource, VideoWorkspaceEntry } from "@/lib/video/store";

const starterNodes: Node[] = [
  { id: "brief", position: { x: 0, y: 80 }, data: { label: "营销简报\n目标与受众" }, type: "input" },
  { id: "facts", position: { x: 280, y: 0 }, data: { label: "已验证事实\n只读证据引用" } },
  { id: "assets", position: { x: 280, y: 160 }, data: { label: "私有素材\n权利证据" } },
  { id: "generate", position: { x: 560, y: 80 }, data: { label: "生成视频\n模型与参数" }, type: "output" },
];
const starterEdges: Edge[] = [{ id: "brief-facts", source: "brief", target: "facts" }, { id: "facts-generate", source: "facts", target: "generate" }, { id: "assets-generate", source: "assets", target: "generate" }];

export function VideoCanvasWorkspace({ products, entries }: { products: ReadyVideoProductSource[]; entries: VideoWorkspaceEntry[] }) {
  const [nodes, setNodes] = useState(starterNodes);
  const [edges, setEdges] = useState(starterEdges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => nodes.find((node) => node.id === selectedId), [nodes, selectedId]);
  const addScene = () => setNodes((current) => [...current, { id: `scene-${crypto.randomUUID()}`, position: { x: 280 + current.length * 32, y: 300 }, data: { label: "镜头\n拖拽连接到生成节点" } }]);
  const connect = useCallback((connection: Connection) => setEdges((current) => addEdge(connection, current)), []);
  const changeNodes = useCallback((changes: NodeChange[]) => setNodes((current) => applyNodeChanges(changes, current)), []);

  return <main className="flex min-h-full flex-col gap-4 p-4 md:p-6 lg:p-8">
    <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div className="flex flex-col gap-2"><div className="flex flex-wrap gap-2"><Badge variant="secondary">视频无限画布</Badge><Badge variant="outline">创意审核为建议</Badge></div><h1 className="text-3xl font-semibold tracking-tight text-balance">用画布编排可追溯的视频创意</h1><p className="max-w-3xl text-muted-foreground">拖拽节点并连接简报、已验证事实、私有素材和生成参数。创意检查会给出建议；产品事实、报价、交期与正式发布仍需人工确认。</p></div><Button onClick={addScene}><PlusIcon data-icon="inline-start" />添加镜头</Button></header>
    <Alert><SparklesIcon /><AlertTitle>创意 gate 是建议，不是阻断</AlertTitle><AlertDescription>画布允许继续编辑和生成准备；未绑定证据的工程事实会被标出，不能作为正式产品、报价或发布依据。</AlertDescription></Alert>
    <div className="grid min-h-[620px] gap-4 xl:grid-cols-[1fr_20rem]"><Card className="min-h-[620px] overflow-hidden"><CardContent className="h-[620px] p-0"><ContextMenu><ContextMenuTrigger className="block h-full"><ReactFlow nodes={nodes} edges={edges} onNodesChange={changeNodes} onConnect={connect} onNodeClick={(_, node) => setSelectedId(node.id)} fitView><Background /><MiniMap /><Controls /></ReactFlow></ContextMenuTrigger><ContextMenuContent><ContextMenuGroup><ContextMenuItem onClick={addScene}>添加镜头节点</ContextMenuItem></ContextMenuGroup></ContextMenuContent></ContextMenu></CardContent></Card>
      <Card><CardHeader><CardTitle>节点检查器</CardTitle><CardDescription>{selected ? `正在编辑 ${String(selected.data.label).split("\n")[0]}` : "选择画布节点以查看其约束。"}</CardDescription></CardHeader><CardContent className="flex flex-col gap-4"><div className="flex flex-col gap-2"><Badge variant="outline">可用产品：{products.length}</Badge><Badge variant="outline">已有项目：{entries.length}</Badge></div><p className="text-sm text-muted-foreground">v1 将画布结构保存在浏览器会话中。提交生成前，服务端会重新校验产品证据、素材权利、模型配置和成本约束。</p>{products.length === 0 ? <Empty><EmptyHeader><EmptyMedia variant="icon"><ClapperboardIcon /></EmptyMedia><EmptyTitle>暂无已核验产品</EmptyTitle><EmptyDescription>请先完成产品事实确认。</EmptyDescription></EmptyHeader></Empty> : null}</CardContent></Card>
    </div>
  </main>;
}
