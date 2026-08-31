"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ClapperboardIcon, CopyIcon, DownloadIcon, PlusIcon, Redo2Icon, SaveIcon, SparklesIcon, Trash2Icon, Undo2Icon, UploadIcon, WorkflowIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createVideoProjectFromCanvasAction, saveVideoCanvasAction, type VideoActionState } from "@/lib/actions/video";
import { videoCanvasAssetBindingSchema, videoCanvasBriefSchema, videoCanvasFactBindingSchema, videoCanvasPlatformSchema, videoCanvasSceneSchema, type VideoCanvasAssetBinding, type VideoCanvasBrief, type VideoCanvasDocument, type VideoCanvasFactBinding, type VideoCanvasScene } from "@/lib/video/canvas-contracts";
import type { ReadyVideoProductSource, VideoWorkspaceEntry } from "@/lib/video/store";

import { PrivateVideoPreview } from "./private-video-preview";

const starterNodes: Node[] = [
  { id: "brief", position: { x: 0, y: 80 }, data: { label: "营销简报\n目标与受众" }, type: "studio", deletable: false },
  { id: "facts", position: { x: 280, y: 0 }, data: { label: "已验证事实\n只读证据引用" }, type: "studio", deletable: false },
  { id: "assets", position: { x: 280, y: 160 }, data: { label: "私有素材\n权利证据" }, type: "studio", deletable: false },
  { id: "generate", position: { x: 560, y: 80 }, data: { label: "生成视频\n模型与参数" }, type: "studio", deletable: false },
];

const starterEdges: Edge[] = [
  { id: "brief-facts", source: "brief", target: "facts", deletable: false },
  { id: "facts-generate", source: "facts", target: "generate", deletable: false },
  { id: "assets-generate", source: "assets", target: "generate", deletable: false },
];

type CanvasGraph = { nodes: Node[]; edges: Edge[]; factBinding?: VideoCanvasFactBinding; brief?: VideoCanvasBrief; assetBinding?: VideoCanvasAssetBinding; platforms?: z.infer<typeof videoCanvasPlatformSchema>[]; scenes?: Record<string, VideoCanvasScene> };
const initialGraph: CanvasGraph = { nodes: starterNodes, edges: starterEdges };
const requiredNodeIds = new Set(starterNodes.map((node) => node.id));
const starterNodeById = new Map(starterNodes.map((node) => [node.id, node]));
const requiredEdgeIds = new Set(starterEdges.map((edge) => edge.id));
const starterEdgeById = new Map(starterEdges.map((edge) => [edge.id, edge]));
const studioStorageKey = "f-trade:video-studio:canvas-v1";
const persistedGraphSchema = z.object({
  nodes: z.array(z.object({
    id: z.string().min(1),
    position: z.object({ x: z.number(), y: z.number() }),
    data: z.object({ label: z.string() }).passthrough(),
  }).passthrough()),
  edges: z.array(z.object({ id: z.string().min(1), source: z.string().min(1), target: z.string().min(1) }).passthrough()),
  factBinding: videoCanvasFactBindingSchema.optional(),
  brief: videoCanvasBriefSchema.optional(),
  assetBinding: videoCanvasAssetBindingSchema.optional(),
  platforms: z.array(videoCanvasPlatformSchema).min(1).max(5).optional(),
  scenes: z.record(z.string().min(1), videoCanvasSceneSchema).optional(),
});

const nodeEditorSchema = z.object({
  title: z.string().trim().min(1, "请输入节点名称。").max(60, "节点名称不能超过 60 个字符。"),
  detail: z.string().trim().min(1, "请输入节点说明。").max(160, "节点说明不能超过 160 个字符。"),
});
const briefEditorSchema = videoCanvasBriefSchema;
const assetEditorSchema = videoCanvasAssetBindingSchema;
const sceneEditorSchema = videoCanvasSceneSchema;
const generationEditorSchema = z.object({ platforms: z.array(videoCanvasPlatformSchema).min(1, "至少选择一个目标平台。") });
const canvasPlatforms = [{ value: "youtube", label: "YouTube" }, { value: "tiktok", label: "TikTok" }, { value: "instagram", label: "Instagram" }, { value: "facebook", label: "Facebook" }, { value: "x", label: "X" }] as const;

function nodeLabel(node: Node | undefined) {
  const [title = "", detail = ""] = String(node?.data.label ?? "").split("\n", 2);
  return { title, detail };
}

function StudioCanvasNode({ id, data, selected }: NodeProps) {
  const [title, detail] = String((data as { label?: unknown }).label ?? "").split("\n", 2);
  const kind = id === "brief" ? "brief" : id === "facts" ? "facts" : id === "assets" ? "assets" : id === "generate" ? "generate" : "scene";
  const tone = {
    brief: "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-50",
    facts: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-50",
    assets: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50",
    generate: "border-violet-300 bg-violet-50 text-violet-950 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-50",
    scene: "border-border bg-card text-card-foreground",
  }[kind];
  return <div className={`min-w-48 rounded-lg border p-3 shadow-sm transition-shadow ${tone} ${selected ? "ring-2 ring-ring ring-offset-2" : ""}`}>
    {id !== "brief" ? <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-foreground" /> : null}
    <p className="text-sm font-semibold leading-none">{title}</p>
    <p className="mt-1 max-w-48 text-xs leading-snug opacity-75">{detail || "未填写说明"}</p>
    {id !== "generate" ? <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-foreground" /> : null}
  </div>;
}

const studioNodeTypes = { studio: StudioCanvasNode };

function miniMapNodeColor(node: Node) {
  if (node.id === "brief") return "#0ea5e9";
  if (node.id === "facts") return "#10b981";
  if (node.id === "assets") return "#f59e0b";
  if (node.id === "generate") return "#8b5cf6";
  return "#64748b";
}

function hasDirectedPath(startId: string, targetId: string, edges: readonly Edge[]) {
  const visited = new Set<string>();
  const pending = [startId];
  while (pending.length) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    if (current === targetId) return true;
    visited.add(current);
    for (const edge of edges) if (edge.source === current) pending.push(edge.target);
  }
  return false;
}

function isConnectionValid(connection: Pick<Edge, "source" | "target">, edges: readonly Edge[]) {
  const { source, target } = connection;
  if (!source || !target || source === target) return false;
  if (source === "generate" || target === "brief") return false;
  if (edges.some((edge) => edge.source === source && edge.target === target)) return false;
  return !hasDirectedPath(target, source, edges);
}

function sanitizeGraph(value: unknown): CanvasGraph | null {
  const parsed = persistedGraphSchema.safeParse(value);
  if (!parsed.success) return null;
  const ids = new Set<string>();
  const nodes: Node[] = [];
  for (const node of parsed.data.nodes) {
    if (ids.has(node.id)) return null;
    ids.add(node.id);
    const starter = starterNodeById.get(node.id);
    nodes.push({
      id: node.id,
      type: "studio",
      position: node.position,
      deletable: starter ? false : typeof node.deletable === "boolean" ? node.deletable : undefined,
      data: { label: node.data.label },
    });
  }
  if (![...requiredNodeIds].every((id) => ids.has(id))) return null;
  const edges: Edge[] = [];
  for (const edge of parsed.data.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || !isConnectionValid(edge, edges)) return null;
    const starter = starterEdgeById.get(edge.id);
    if (starter && (edge.source !== starter.source || edge.target !== starter.target)) return null;
    edges.push({ id: edge.id, source: edge.source, target: edge.target, deletable: starter ? false : undefined });
  }
  if (![...requiredEdgeIds].every((id) => edges.some((edge) => edge.id === id))) return null;
  return { nodes, edges, factBinding: parsed.data.factBinding, brief: parsed.data.brief, assetBinding: parsed.data.assetBinding, platforms: parsed.data.platforms, scenes: parsed.data.scenes };
}

function documentFromGraph(graph: CanvasGraph): VideoCanvasDocument {
  return {
    version: 1,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: "studio",
      position: node.position,
      ...(typeof node.deletable === "boolean" ? { deletable: node.deletable } : {}),
      data: { label: String(node.data.label ?? "") },
    })),
    edges: graph.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
    ...(graph.factBinding ? { factBinding: graph.factBinding } : {}),
    ...(graph.brief ? { brief: graph.brief } : {}),
    ...(graph.assetBinding ? { assetBinding: graph.assetBinding } : {}),
    ...(graph.platforms?.length ? { platforms: graph.platforms } : {}),
    ...(graph.scenes ? { scenes: graph.scenes } : {}),
  };
}

export function VideoStudioCanvas({ products, entries, initialCanvas }: {
  products: ReadyVideoProductSource[];
  entries: VideoWorkspaceEntry[];
  initialCanvas: { document: VideoCanvasDocument; revision: number } | null;
}) {
  const [graph, setGraph] = useState<CanvasGraph>(initialGraph);
  const [pastGraphs, setPastGraphs] = useState<CanvasGraph[]>([]);
  const [futureGraphs, setFutureGraphs] = useState<CanvasGraph[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [storageState, setStorageState] = useState<"loading" | "saved" | "unavailable">("loading");
  const [cloudFeedback, setCloudFeedback] = useState<"idle" | "saving" | "conflict" | "error">("idle");
  const [serverRevision, setServerRevision] = useState(initialCanvas?.revision ?? 0);
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(() => {
    const restored = initialCanvas ? sanitizeGraph(initialCanvas.document) : null;
    return restored ? JSON.stringify(documentFromGraph(restored)) : null;
  });
  const [snapshotState, setSnapshotState] = useState<"idle" | "imported" | "invalid">("idle");
  const [hydrated, setHydrated] = useState(false);
  const [layoutPending, setLayoutPending] = useState(false);
  const [savePending, startSaveTransition] = useTransition();
  const snapshotInputRef = useRef<HTMLInputElement>(null);
  const { nodes, edges } = graph;
  const currentDocument = useMemo(() => documentFromGraph(graph), [graph]);
  const currentFingerprint = useMemo(() => JSON.stringify(currentDocument), [currentDocument]);
  const cloudState = cloudFeedback === "saving" ? "saving" : cloudFeedback === "conflict" ? "conflict" : cloudFeedback === "error" ? "error" : serverRevision > 0 && savedFingerprint === currentFingerprint ? "saved" : "unsaved";
  const selected = useMemo(() => nodes.find((node) => node.id === selectedId), [nodes, selectedId]);
  const selectedEdge = useMemo(() => edges.find((edge) => edge.id === selectedEdgeId), [edges, selectedEdgeId]);
  const selectedNodeIsReadOnly = selected?.id === "facts" || selected?.id === "assets" || selected?.id === "generate";
  const boundProduct = useMemo(() => products.find((product) => product.id === graph.factBinding?.productId), [graph.factBinding?.productId, products]);
  const advisoryIssues = useMemo(() => {
    const scenes = nodes.filter((node) => node.id.startsWith("scene-"));
    if (!scenes.length) return ["尚未添加镜头节点。"];
    return scenes.flatMap((scene) => hasDirectedPath(scene.id, "generate", edges) ? [] : [`${nodeLabel(scene).title || "镜头"} 尚未连接到生成节点。`]);
  }, [edges, nodes]);
  const projectIssues = useMemo(() => {
    const issues: string[] = [];
    if (!graph.brief) issues.push("填写营销简报");
    if (!graph.factBinding) issues.push("选择已验证事实");
    if (!graph.assetBinding) issues.push("填写素材与权利证据引用");
    if (!graph.platforms?.length) issues.push("选择目标平台");
    const scenes = nodes.filter((node) => node.id.startsWith("scene-"));
    if (!scenes.length) issues.push("添加至少一个镜头");
    for (const scene of scenes) {
      if (!graph.scenes?.[scene.id]) issues.push(`填写 ${nodeLabel(scene).title || "镜头"} 的说明与时长`);
      else if (!hasDirectedPath(scene.id, "generate", edges)) issues.push(`将 ${nodeLabel(scene).title || "镜头"} 连接到生成节点`);
    }
    return issues;
  }, [edges, graph.assetBinding, graph.brief, graph.factBinding, graph.platforms, graph.scenes, nodes]);
  const canCreateProject = projectIssues.length === 0;
  const form = useForm<z.infer<typeof nodeEditorSchema>>({
    resolver: zodResolver(nodeEditorSchema),
    defaultValues: nodeLabel(undefined),
  });
  const briefForm = useForm<z.infer<typeof briefEditorSchema>>({
    resolver: zodResolver(briefEditorSchema),
    defaultValues: { objective: "", targetAudience: "" },
  });
  const assetForm = useForm<z.infer<typeof assetEditorSchema>>({ resolver: zodResolver(assetEditorSchema), defaultValues: { assetRef: "", rightsEvidenceRef: "" } });
  const sceneForm = useForm<z.infer<typeof sceneEditorSchema>>({ resolver: zodResolver(sceneEditorSchema), defaultValues: { prompt: "", durationSeconds: 5 } });
  const generationForm = useForm<z.infer<typeof generationEditorSchema>>({ resolver: zodResolver(generationEditorSchema), defaultValues: { platforms: [] } });
  const [projectState, setProjectState] = useState<VideoActionState>({ status: "idle", message: "" });
  const [createPending, startCreateTransition] = useTransition();
  const router = useRouter();
  const updateGraph = useCallback((update: (current: CanvasGraph) => CanvasGraph) => {
    setGraph((current) => {
      setPastGraphs((past) => [...past.slice(-49), current]);
      setFutureGraphs([]);
      return update(current);
    });
  }, []);
  const addScene = useCallback(() => {
    const id = `scene-${crypto.randomUUID()}`;
    updateGraph((current) => ({ ...current, nodes: [
      ...current.nodes,
      {
        id,
        position: { x: 280 + current.nodes.length * 32, y: 300 },
        data: { label: "镜头\n拖拽连接到生成节点" },
      },
    ] }));
    setSelectedId(id);
  }, [updateGraph]);
  const validateConnection = useCallback((connection: Connection | Edge) => isConnectionValid(connection, edges), [edges]);
  const connect = useCallback((connection: Connection) => {
    if (!validateConnection(connection)) return;
    updateGraph((current) => ({ ...current, edges: addEdge(connection, current.edges) }));
  }, [updateGraph, validateConnection]);
  const changeNodes = useCallback((changes: NodeChange[]) => {
    const graphChanges = changes.filter((change) => change.type !== "select");
    if (!graphChanges.length) return;
    updateGraph((current) => ({ ...current, nodes: applyNodeChanges(graphChanges, current.nodes) }));
  }, [updateGraph]);
  const removeSelected = useCallback(() => {
    if (!selected || selected.deletable === false) return;
    updateGraph((current) => {
      const { [selected.id]: _removed, ...scenes } = current.scenes ?? {};
      return { ...current, nodes: current.nodes.filter((node) => node.id !== selected.id), edges: current.edges.filter((edge) => edge.source !== selected.id && edge.target !== selected.id), scenes: Object.keys(scenes).length ? scenes : undefined };
    });
    setSelectedId(null);
  }, [selected, updateGraph]);
  const removeSelectedEdge = useCallback(() => {
    if (!selectedEdge || selectedEdge.deletable === false) return;
    updateGraph((current) => ({ ...current, edges: current.edges.filter((edge) => edge.id !== selectedEdge.id) }));
    setSelectedEdgeId(null);
  }, [selectedEdge, updateGraph]);
  const duplicateSelected = useCallback(() => {
    if (!selected || selected.deletable === false) return;
    const id = `scene-${crypto.randomUUID()}`;
    updateGraph((current) => ({
      ...current,
      nodes: [...current.nodes, {
        ...selected,
        id,
        position: { x: selected.position.x + 48, y: selected.position.y + 48 },
        selected: false,
      }],
      ...(selected.id.startsWith("scene-") && current.scenes?.[selected.id] ? { scenes: { ...current.scenes, [id]: current.scenes[selected.id] } } : {}),
    }));
    setSelectedId(id);
  }, [selected, updateGraph]);

  const undo = useCallback(() => {
    setPastGraphs((past) => {
      const previous = past.at(-1);
      if (!previous) return past;
      setFutureGraphs((future) => [graph, ...future].slice(0, 50));
      setGraph(previous);
      return past.slice(0, -1);
    });
  }, [graph]);
  const redo = useCallback(() => {
    setFutureGraphs((future) => {
      const next = future[0];
      if (!next) return future;
      setPastGraphs((past) => [...past.slice(-49), graph]);
      setGraph(next);
      return future.slice(1);
    });
  }, [graph]);
  const restoreDefaultCanvas = useCallback(() => {
    updateGraph(() => initialGraph);
    setSelectedId(null);
    setSelectedEdgeId(null);
    requestAnimationFrame(() => flow?.fitView({ padding: 0.2, duration: 250 }));
  }, [flow, updateGraph]);
  const arrangeLayout = useCallback(async () => {
    if (layoutPending) return;
    setLayoutPending(true);
    try {
      const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
      const layout = await new ELK().layout({
        id: "studio",
        layoutOptions: { "elk.algorithm": "layered", "elk.direction": "RIGHT", "elk.spacing.nodeNode": "72", "elk.layered.spacing.nodeNodeBetweenLayers": "120" },
        children: nodes.map((node) => ({ id: node.id, width: 190, height: 56 })),
        edges: edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
      });
      const positions = new Map((layout.children ?? []).flatMap((node) => node.x === undefined || node.y === undefined ? [] : [[node.id, { x: node.x, y: node.y }] as const]));
      updateGraph((current) => ({ ...current, nodes: current.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })) }));
      requestAnimationFrame(() => flow?.fitView({ padding: 0.2, duration: 250 }));
    } finally {
      setLayoutPending(false);
    }
  }, [edges, layoutPending, nodes, updateGraph]);
  const exportSnapshot = useCallback(() => {
    const snapshot = {
      ...documentFromGraph(graph),
      exportedAt: new Date().toISOString(),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `video-studio-canvas-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [graph]);
  const importSnapshot = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const imported = sanitizeGraph(JSON.parse(await file.text()));
      if (!imported) throw new Error("invalid snapshot");
      updateGraph(() => imported);
      setSelectedId(null);
      setSnapshotState("imported");
    } catch {
      setSnapshotState("invalid");
    }
  }, [updateGraph]);

  const updateFactBinding = useCallback((productId: string, factPath: string) => {
    const product = products.find((item) => item.id === productId);
    if (!product || !product.factOptions.some((fact) => fact.value === factPath)) return;
    updateGraph((current) => ({
      ...current,
      factBinding: { productId, factPath },
      nodes: current.nodes.map((node) => node.id === "facts" ? { ...node, data: { ...node.data, label: `已验证事实\n${product.internalSku} · ${factPath}` } } : node),
    }));
  }, [products, updateGraph]);

  const saveToCloud = useCallback(() => {
    setCloudFeedback("saving");
    startSaveTransition(async () => {
      const result = await saveVideoCanvasAction({ expectedRevision: serverRevision, document: currentDocument });
      if (result.status === "success" && result.revision !== undefined) {
        setServerRevision(result.revision);
        setSavedFingerprint(currentFingerprint);
        setCloudFeedback("idle");
        return;
      }
      setCloudFeedback(result.status === "conflict" ? "conflict" : "error");
    });
  }, [currentDocument, currentFingerprint, serverRevision, startSaveTransition]);

  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
    form.reset(nodeLabel(selected));
    if (selected?.id === "brief") briefForm.reset(graph.brief ?? { objective: "", targetAudience: "" });
    if (selected?.id === "assets") assetForm.reset(graph.assetBinding ?? { assetRef: "", rightsEvidenceRef: "" });
    if (selected?.id?.startsWith("scene-")) sceneForm.reset(graph.scenes?.[selected.id] ?? { prompt: "", durationSeconds: 5 });
    if (selected?.id === "generate") generationForm.reset({ platforms: graph.platforms ?? [] });
  }, [assetForm, briefForm, form, generationForm, graph.assetBinding, graph.brief, graph.platforms, graph.scenes, sceneForm, selected, selectedId]);

  useEffect(() => {
    try {
      const initial = initialCanvas?.document ?? JSON.parse(window.localStorage.getItem(studioStorageKey) ?? "null");
      if (initial) {
        const restored = sanitizeGraph(initial);
        if (restored) setGraph(restored);
      }
      setStorageState("saved");
    } catch {
      setStorageState("unavailable");
    } finally {
      setHydrated(true);
    }
  }, [initialCanvas]);

  useEffect(() => {
    if (!hydrated || storageState === "unavailable") return;
    try {
      window.localStorage.setItem(studioStorageKey, JSON.stringify(graph));
      setStorageState("saved");
    } catch {
      setStorageState("unavailable");
    }
  }, [graph, hydrated, storageState]);

  useEffect(() => {
    function handleDelete(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (event.key === "Escape") {
        setSelectedId(null);
        setSelectedEdgeId(null);
        return;
      }
      if (event.metaKey || event.ctrlKey) {
        const key = event.key.toLowerCase();
        if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) redo(); else undo();
          return;
        }
        if (key === "y") {
          event.preventDefault();
          redo();
          return;
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d" && selected?.deletable !== false && selected) {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if ((event.key === "Backspace" || event.key === "Delete") && selectedEdge) {
        event.preventDefault();
        removeSelectedEdge();
        return;
      }
      if ((event.key !== "Backspace" && event.key !== "Delete") || selected?.deletable === false || !selected) return;
      event.preventDefault();
      removeSelected();
    }

    window.addEventListener("keydown", handleDelete);
    return () => window.removeEventListener("keydown", handleDelete);
  }, [duplicateSelected, redo, removeSelected, removeSelectedEdge, selected, selectedEdge, undo]);

  function saveNode(values: z.infer<typeof nodeEditorSchema>) {
    if (!selected || selectedNodeIsReadOnly) return;
    updateGraph((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === selected.id ? { ...node, data: { ...node.data, label: `${values.title}\n${values.detail}` } } : node) }));
  }

  function saveBrief(values: z.infer<typeof briefEditorSchema>) {
    updateGraph((current) => ({
      ...current,
      brief: values,
      nodes: current.nodes.map((node) => node.id === "brief" ? { ...node, data: { ...node.data, label: `营销简报\n${values.objective.slice(0, 72)}` } } : node),
    }));
  }

  function saveAsset(values: z.infer<typeof assetEditorSchema>) {
    updateGraph((current) => ({ ...current, assetBinding: values, nodes: current.nodes.map((node) => node.id === "assets" ? { ...node, data: { ...node.data, label: `私有素材\n${values.assetRef}` } } : node) }));
  }

  function saveScene(values: z.infer<typeof sceneEditorSchema>) {
    if (!selected?.id.startsWith("scene-")) return;
    updateGraph((current) => ({ ...current, scenes: { ...current.scenes, [selected.id]: values }, nodes: current.nodes.map((node) => node.id === selected.id ? { ...node, data: { ...node.data, label: `镜头\n${values.prompt.slice(0, 72)}` } } : node) }));
  }

  function saveGeneration(values: z.infer<typeof generationEditorSchema>) {
    updateGraph((current) => ({ ...current, platforms: values.platforms, nodes: current.nodes.map((node) => node.id === "generate" ? { ...node, data: { ...node.data, label: `生成视频\n${values.platforms.length} 个目标平台` } } : node) }));
  }

  const createProject = useCallback(() => {
    setProjectState({ status: "idle", message: "" });
    startCreateTransition(async () => setProjectState(await createVideoProjectFromCanvasAction(currentDocument)));
  }, [currentDocument, startCreateTransition]);

  const reloadCloudDraft = useCallback(() => {
    if (!window.confirm("重新载入会替换当前未保存的本地画布。建议先导出快照。是否继续？")) return;
    setCloudFeedback("idle");
    router.refresh();
  }, [router]);

  return (
    <main id="main-content" className="fixed inset-0 overflow-hidden bg-muted" aria-label="视频创意 Studio">
      <ContextMenu>
        <ContextMenuTrigger className="block size-full">
          <ReactFlow
            className="video-studio-canvas bg-background"
            nodes={nodes}
            edges={edges}
            nodeTypes={studioNodeTypes}
            proOptions={{ hideAttribution: true }}
            onNodesChange={changeNodes}
            onInit={setFlow}
            onConnect={connect}
            isValidConnection={validateConnection}
            deleteKeyCode={null}
            snapToGrid={snapEnabled}
            snapGrid={[16, 16]}
            panOnScroll
            zoomOnScroll={false}
            onNodeClick={(_, node) => { setSelectedId(node.id); setSelectedEdgeId(null); }}
            onEdgeClick={(_, edge) => { setSelectedEdgeId(edge.id); setSelectedId(null); }}
            onPaneClick={() => { setSelectedId(null); setSelectedEdgeId(null); }}
            fitView
          >
            <Background />
            <Controls position="top-right" />
            <MiniMap className="hidden md:block" nodeColor={miniMapNodeColor} position="bottom-left" style={{ bottom: 92 }} />
          </ReactFlow>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            <ContextMenuItem onClick={addScene}>添加镜头节点</ContextMenuItem>
            <ContextMenuItem disabled={!selected || selected.deletable === false} onClick={duplicateSelected}>复制选中节点</ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>

      <Card className="absolute inset-x-3 top-3 z-10 border-white/50 !bg-background/70 shadow-lg backdrop-blur-xl dark:border-white/10 md:left-6 md:right-auto md:top-6 md:w-[34rem]">
        <CardHeader className="gap-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2"><Badge variant="secondary">视频 Studio</Badge><Badge variant="outline">创意检查为建议</Badge><span aria-live="polite" className="contents"><Badge variant="outline">{storageState === "saved" ? "本地已保存" : storageState === "unavailable" ? "本地保存不可用" : "正在恢复画布"}</Badge><Badge variant={cloudState === "saved" ? "secondary" : "outline"}>{cloudState === "saved" ? `云端已保存 r${serverRevision}` : cloudState === "saving" ? "正在保存云端草稿" : cloudState === "conflict" ? "云端版本冲突" : cloudState === "error" ? "云端保存失败" : "尚未保存到云端"}</Badge>{snapshotState === "imported" ? <Badge variant="secondary">已导入快照</Badge> : null}{snapshotState === "invalid" ? <Badge variant="outline">快照格式无效</Badge> : null}</span></div>
            <Button variant="ghost" size="icon" render={<Link href="/console" />} aria-label="退出 Studio"><XIcon /></Button>
          </div>
          <div className="flex flex-col gap-1">
            <CardTitle>无限画布</CardTitle>
            <CardDescription>连接简报、已验证事实、私有素材和生成节点；正式产品事实与发布仍须人工确认。</CardDescription>
          </div>
        </CardHeader>
      </Card>

      <div className="absolute bottom-4 left-3 z-10 flex max-w-[calc(100vw-1.5rem)] gap-2 overflow-x-auto rounded-2xl border border-white/50 !bg-background/70 p-2 shadow-lg backdrop-blur-xl dark:border-white/10 md:bottom-6 md:left-6 md:max-w-[calc(100vw-3rem)]">
        <Button onClick={addScene}><PlusIcon data-icon="inline-start" />添加镜头</Button>
        <Button variant="outline" size="icon" onClick={undo} disabled={!pastGraphs.length} aria-label="撤销画布操作"><Undo2Icon /></Button>
        <Button variant="outline" size="icon" onClick={redo} disabled={!futureGraphs.length} aria-label="重做画布操作"><Redo2Icon /></Button>
        <Button variant="outline" onClick={() => setSnapEnabled((enabled) => !enabled)}>{snapEnabled ? "网格吸附：开" : "网格吸附：关"}</Button>
        <Button variant="outline" onClick={() => flow?.fitView({ padding: 0.2, duration: 250 })}>适配视图</Button>
        <Button variant="outline" onClick={restoreDefaultCanvas}>恢复默认</Button>
        <Button variant="outline" onClick={arrangeLayout} disabled={layoutPending}><WorkflowIcon data-icon="inline-start" />{layoutPending ? "整理中" : "整理布局"}</Button>
        <Button variant="outline" onClick={saveToCloud} disabled={savePending}><SaveIcon data-icon="inline-start" />{savePending ? "保存中" : "保存云端草稿"}</Button>
        <Button onClick={createProject} disabled={createPending || !canCreateProject} title={canCreateProject ? undefined : projectIssues.join("；")}><ClapperboardIcon data-icon="inline-start" />{createPending ? "创建中" : canCreateProject ? "创建视频项目" : "补全画布后创建"}</Button>
        <Button variant="outline" onClick={exportSnapshot}><DownloadIcon data-icon="inline-start" />导出快照</Button>
        <Input ref={snapshotInputRef} className="hidden" type="file" accept="application/json,.json" onChange={importSnapshot} aria-label="导入画布快照" />
        <Button variant="outline" onClick={() => snapshotInputRef.current?.click()}><UploadIcon data-icon="inline-start" />导入快照</Button>
        <Button variant="outline" render={<Link href="/console/video/settings" />}><ClapperboardIcon data-icon="inline-start" />模型配置</Button>
      </div>

      <Card className="absolute bottom-4 right-3 z-10 w-[min(20rem,calc(100vw-1.5rem))] border-white/50 !bg-background/70 shadow-lg backdrop-blur-xl dark:border-white/10 md:bottom-6 md:right-6">
        <CardHeader className="p-4 pb-2"><CardTitle className="text-base">节点检查器</CardTitle><CardDescription>{selected ? `正在编辑 ${String(selected.data.label).split("\n")[0]}` : selectedEdge ? "正在编辑连线" : "选择节点或连线以查看约束。"}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3 p-4 pt-2">
          <div className="flex flex-wrap gap-2"><Badge variant="outline">已核验产品 {products.length}</Badge><Badge variant="outline">项目 {entries.length}</Badge></div>
          <p className="text-sm text-muted-foreground"><SparklesIcon className="mr-1 inline" aria-hidden="true" />创意风险会提示但不阻断；服务端仍会核验证据、素材权利、模型配置和成本。</p>
          {projectState.status !== "idle" ? <Alert variant={projectState.status === "error" ? "destructive" : "default"}><AlertTitle>{projectState.status === "success" ? "视频项目已创建" : "无法创建视频项目"}</AlertTitle><AlertDescription>{projectState.message}</AlertDescription></Alert> : null}
          {cloudState === "conflict" ? <Alert><AlertTitle>云端草稿有更新</AlertTitle><AlertDescription className="flex flex-col gap-2"><span>请先导出本地快照，再重新载入云端版本以继续编辑。</span><Button type="button" size="sm" variant="outline" onClick={reloadCloudDraft}>重新载入云端草稿</Button></AlertDescription></Alert> : null}
          {projectIssues.length ? <Alert><AlertTitle>创建项目还需补全</AlertTitle><AlertDescription><ul className="flex list-disc flex-col gap-1 pl-4">{projectIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></AlertDescription></Alert> : <Badge variant="secondary">可从画布创建视频项目</Badge>}
          {advisoryIssues.length ? <Alert><SparklesIcon /><AlertTitle>画布建议</AlertTitle><AlertDescription><ul className="flex list-disc flex-col gap-1 pl-4">{advisoryIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></AlertDescription></Alert> : <Badge variant="secondary">画布结构已准备好生成</Badge>}
          {selectedEdge?.deletable !== false ? <Button type="button" size="sm" variant="outline" onClick={removeSelectedEdge}><Trash2Icon data-icon="inline-start" />删除连线</Button> : null}
          {selectedNodeIsReadOnly ? <Alert><AlertTitle>此节点只读</AlertTitle><AlertDescription>{selected?.id === "facts" ? "已验证事实只能由产品记录及其证据更新，不能在画布中改写。" : selected?.id === "assets" ? "素材引用与权利证据只能在受控工作流中更新，不能在画布中改写。" : "模型与参数只能通过模型配置页面更新。"}</AlertDescription></Alert> : null}
          {selected?.id === "facts" ? <FieldGroup>
            <Field><FieldLabel htmlFor="studio-fact-product">已核验产品</FieldLabel><Select value={graph.factBinding?.productId ?? ""} onValueChange={(productId) => { if (!productId) return; const product = products.find((item) => item.id === productId); if (product?.factOptions[0]) updateFactBinding(product.id, product.factOptions[0].value); }}><SelectTrigger id="studio-fact-product" className="w-full"><SelectValue placeholder="选择已核验产品" /></SelectTrigger><SelectContent><SelectGroup>{products.map((product) => <SelectItem key={product.id} value={product.id}>{product.internalSku} · {product.productName}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
            <Field><FieldLabel htmlFor="studio-fact-path">引用的字段</FieldLabel><Select value={graph.factBinding?.factPath ?? ""} onValueChange={(factPath) => { if (factPath && graph.factBinding) updateFactBinding(graph.factBinding.productId, factPath); }} disabled={!boundProduct}><SelectTrigger id="studio-fact-path" className="w-full"><SelectValue placeholder="先选择产品" /></SelectTrigger><SelectContent><SelectGroup>{boundProduct?.factOptions.map((fact) => <SelectItem key={fact.value} value={fact.value}>{fact.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
            <p className="text-xs text-muted-foreground">画布只保存产品和字段引用；每次云端保存都会重新验证该字段的证据。</p>
          </FieldGroup> : null}
          {selected?.id === "assets" ? <form onSubmit={assetForm.handleSubmit(saveAsset)}><FieldGroup>
            <Field data-invalid={!!assetForm.formState.errors.assetRef}><FieldLabel htmlFor="studio-asset-ref">私有素材引用</FieldLabel><Input id="studio-asset-ref" placeholder="asset-product-001" aria-invalid={!!assetForm.formState.errors.assetRef} {...assetForm.register("assetRef")} /><FieldError>{assetForm.formState.errors.assetRef?.message}</FieldError></Field>
            <Field data-invalid={!!assetForm.formState.errors.rightsEvidenceRef}><FieldLabel htmlFor="studio-rights-ref">权利证据引用</FieldLabel><Input id="studio-rights-ref" placeholder="evidence-rights-001" aria-invalid={!!assetForm.formState.errors.rightsEvidenceRef} {...assetForm.register("rightsEvidenceRef")} /><FieldError>{assetForm.formState.errors.rightsEvidenceRef?.message}</FieldError></Field>
            <p className="text-xs text-muted-foreground">只保存脱敏引用；创建项目时会将其带入受控视频计划。</p><Button type="submit" size="sm">保存素材引用</Button>
          </FieldGroup></form> : null}
          {selected?.id === "generate" ? <form onSubmit={generationForm.handleSubmit(saveGeneration)}><FieldGroup>
            <Field><FieldLabel>目标平台</FieldLabel><div className="mt-1 flex flex-col gap-2">{canvasPlatforms.map((platform) => <Controller key={platform.value} control={generationForm.control} name="platforms" render={({ field }) => <Field orientation="horizontal"><Checkbox id={`studio-platform-${platform.value}`} checked={field.value.includes(platform.value)} onCheckedChange={(checked) => field.onChange(checked ? [...field.value, platform.value] : field.value.filter((value) => value !== platform.value))} /><FieldLabel htmlFor={`studio-platform-${platform.value}`}>{platform.label}</FieldLabel></Field>} />)}</div><FieldError>{generationForm.formState.errors.platforms?.message}</FieldError></Field>
            <p className="text-xs text-muted-foreground">目标平台是项目意图，不会自动发布或绕过模型配置。</p><Button type="submit" size="sm">保存目标平台</Button>
          </FieldGroup></form> : null}
          {selected?.id === "brief" ? <form onSubmit={briefForm.handleSubmit(saveBrief)}><FieldGroup>
            <Field data-invalid={!!briefForm.formState.errors.objective}><FieldLabel htmlFor="studio-brief-objective">营销目标</FieldLabel><Input id="studio-brief-objective" aria-invalid={!!briefForm.formState.errors.objective} {...briefForm.register("objective")} /><FieldError>{briefForm.formState.errors.objective?.message}</FieldError></Field>
            <Field data-invalid={!!briefForm.formState.errors.targetAudience}><FieldLabel htmlFor="studio-brief-audience">目标受众</FieldLabel><Input id="studio-brief-audience" aria-invalid={!!briefForm.formState.errors.targetAudience} {...briefForm.register("targetAudience")} /><FieldError>{briefForm.formState.errors.targetAudience?.message}</FieldError></Field>
            <p className="text-xs text-muted-foreground">这是创意草稿；产品事实仍必须通过已核验事实节点引用。</p>
            <Button type="submit" size="sm">保存简报</Button>
          </FieldGroup></form> : null}
          {selected?.id.startsWith("scene-") ? <form onSubmit={sceneForm.handleSubmit(saveScene)}><FieldGroup>
            <Field data-invalid={!!sceneForm.formState.errors.prompt}><FieldLabel htmlFor="studio-scene-prompt">镜头说明</FieldLabel><Textarea id="studio-scene-prompt" aria-invalid={!!sceneForm.formState.errors.prompt} {...sceneForm.register("prompt")} /><FieldError>{sceneForm.formState.errors.prompt?.message}</FieldError></Field>
            <Field data-invalid={!!sceneForm.formState.errors.durationSeconds}><FieldLabel htmlFor="studio-scene-duration">镜头时长（秒）</FieldLabel><Input id="studio-scene-duration" type="number" min={1} max={30} aria-invalid={!!sceneForm.formState.errors.durationSeconds} {...sceneForm.register("durationSeconds", { valueAsNumber: true })} /><FieldError>{sceneForm.formState.errors.durationSeconds?.message}</FieldError></Field>
            <p className="text-xs text-muted-foreground">镜头说明不得补充未绑定证据的工程或商业事实。</p><Button type="submit" size="sm">保存镜头</Button>
          </FieldGroup></form> : null}
          {selected && !selectedNodeIsReadOnly && selected.id !== "brief" && !selected.id.startsWith("scene-") ? <form onSubmit={form.handleSubmit(saveNode)}><FieldGroup>
            <Field data-invalid={!!form.formState.errors.title}><FieldLabel htmlFor="studio-node-title">名称</FieldLabel><Input id="studio-node-title" aria-invalid={!!form.formState.errors.title} {...form.register("title")} /><FieldError>{form.formState.errors.title?.message}</FieldError></Field>
            <Field data-invalid={!!form.formState.errors.detail}><FieldLabel htmlFor="studio-node-detail">说明</FieldLabel><Input id="studio-node-detail" aria-invalid={!!form.formState.errors.detail} {...form.register("detail")} /><FieldError>{form.formState.errors.detail?.message}</FieldError></Field>
            <div className="flex flex-wrap gap-2"><Button type="submit" size="sm">保存节点</Button>{selected.deletable !== false ? <><Button type="button" size="sm" variant="outline" onClick={duplicateSelected}><CopyIcon data-icon="inline-start" />复制</Button><Button type="button" size="sm" variant="outline" onClick={removeSelected}><Trash2Icon data-icon="inline-start" />删除</Button></> : null}</div>
          </FieldGroup></form> : null}
          {entries.filter((entry) => entry.previewAssetRef).map((entry) => <PrivateVideoPreview key={entry.id} assetRef={entry.previewAssetRef!} title={entry.productName} />)}
          {products.length === 0 ? <Empty className="border"><EmptyHeader><EmptyMedia variant="icon"><ClapperboardIcon /></EmptyMedia><EmptyTitle>暂无已核验产品</EmptyTitle><EmptyDescription>请先完成产品事实确认。</EmptyDescription></EmptyHeader></Empty> : null}
        </CardContent>
      </Card>
    </main>
  );
}
