"use client";

import { startTransition, useActionState, useEffect, useMemo, useState } from "react";
import { Background, Controls, ReactFlow, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FolderOpenIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { createWorkspaceProjectAction, type WorkspaceActionState } from "@/lib/actions/workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { createWorkspaceProjectSchema } from "@/lib/workspace/contracts";
import type { WorkspaceProjectSummary } from "@/lib/workspace/store";

type Values = z.infer<typeof createWorkspaceProjectSchema>;
const initialWorkspaceActionState: WorkspaceActionState = { status: "idle", message: "" };
type ProjectNode = Node<{ label: string; kind: "marketing" | "sales"; status: string }>;
function nodeForProject(project: WorkspaceProjectSummary, index: number): ProjectNode { return { id: project.id, position: { x: 80 + (index % 3) * 280, y: 100 + Math.floor(index / 3) * 180 }, data: { label: project.title, kind: project.kind, status: project.status }, style: { width: 220, borderColor: project.kind === "marketing" ? "var(--primary)" : "var(--border)" }, type: "default" }; }

function ProjectList({ projects, onOpen }: { projects: WorkspaceProjectSummary[]; onOpen: (id: string) => void }) {
  return <ScrollArea className="min-h-0 flex-1"><div className="flex flex-col gap-2 p-4">{projects.map((project) => <Button key={project.id} variant="outline" className="h-auto justify-start py-3 text-left" onClick={() => onOpen(project.id)}><span className="flex min-w-0 flex-1 flex-col gap-1"><span className="truncate font-medium">{project.title}</span><span className="text-xs text-muted-foreground">{project.kind === "marketing" ? "产品营销" : "销售机会"} · {project.status === "active" ? "进行中" : "已归档"}</span></span></Button>)}</div></ScrollArea>;
}

export function WorkspaceHub({ projects }: { projects: WorkspaceProjectSummary[] }) {
  const router = useRouter(); const [createOpen, setCreateOpen] = useState(false); const [projectsOpen, setProjectsOpen] = useState(false);
  const [state, action, pending] = useActionState(createWorkspaceProjectAction, initialWorkspaceActionState);
  const form = useForm<Values>({ resolver: zodResolver(createWorkspaceProjectSchema), defaultValues: { kind: "marketing", title: "" } });
  const nodes = useMemo(() => projects.map(nodeForProject), [projects]);
  useEffect(() => { if (state.status === "success" && state.projectId) { setCreateOpen(false); router.push(`/workspace/${state.projectId}`); } }, [router, state.projectId, state.status]);
  function submit(values: Values) { const data = new FormData(); data.set("kind", values.kind); data.set("title", values.title); startTransition(() => action(data)); }
  function openProject(id: string) { setProjectsOpen(false); router.push(`/workspace/${id}`); }
  return <main id="main-content" className="fixed inset-0 overflow-hidden bg-muted" aria-label="项目总画布"><ReactFlow className="bg-background" nodes={nodes} edges={[]} onNodeClick={(_, node) => openProject(node.id)} fitView><Background /><Controls position="top-right" /></ReactFlow>
    <header className="absolute left-3 top-3 z-10 flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center gap-2 rounded-lg border bg-background/90 p-2 shadow-sm backdrop-blur md:left-6 md:top-6"><Badge variant="secondary">项目画布</Badge><Badge variant="outline">人工审核受控</Badge><Button size="sm" variant="outline" onClick={() => setProjectsOpen(true)}><FolderOpenIcon data-icon="inline-start" />项目</Button><Button size="sm" onClick={() => setCreateOpen(true)}><PlusIcon data-icon="inline-start" />新建项目</Button></header>
    <div className="hidden md:block"><Sheet open={projectsOpen} onOpenChange={setProjectsOpen}><SheetContent side="right" className="gap-0"><SheetHeader><SheetTitle>项目</SheetTitle><SheetDescription>从列表切换项目，不离开画布工作方式。</SheetDescription></SheetHeader><ProjectList projects={projects} onOpen={openProject} /></SheetContent></Sheet></div><Drawer open={projectsOpen} onOpenChange={setProjectsOpen} showSwipeHandle><DrawerContent className="md:hidden"><DrawerHeader><DrawerTitle>项目</DrawerTitle><DrawerDescription>选择要打开的项目。</DrawerDescription></DrawerHeader><ProjectList projects={projects} onOpen={openProject} /></DrawerContent></Drawer>
    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent><DialogHeader><DialogTitle>新建项目</DialogTitle><DialogDescription>创建后立即进入项目画布。</DialogDescription></DialogHeader><form className="min-h-0 overflow-y-auto" onSubmit={form.handleSubmit(submit)}><FieldGroup><Field data-invalid={!!form.formState.errors.title}><FieldLabel htmlFor="workspace-title">项目名称</FieldLabel><Input id="workspace-title" placeholder="例如：离合器新品推广" aria-invalid={!!form.formState.errors.title} {...form.register("title")} /><FieldError>{form.formState.errors.title?.message}</FieldError></Field><Field><FieldLabel>项目类型</FieldLabel><Controller control={form.control} name="kind" render={({ field }) => <ToggleGroup value={[field.value]} onValueChange={(value) => value[0] && field.onChange(value[0])} variant="outline" spacing={2}><ToggleGroupItem value="marketing">产品营销</ToggleGroupItem><ToggleGroupItem value="sales">销售机会</ToggleGroupItem></ToggleGroup>} /></Field><Button type="submit" disabled={pending}><PlusIcon data-icon="inline-start" />{pending ? "正在创建…" : "创建并打开画布"}</Button></FieldGroup></form>{state.status === "error" ? <p className="text-sm text-destructive" aria-live="polite">{state.message}</p> : null}</DialogContent></Dialog>
  </main>;
}
