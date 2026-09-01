"use client";

import { startTransition, useActionState, useEffect, useState, type ReactNode } from "react";
import { CheckSquareIcon, FolderOpenIcon, PlusIcon, SaveIcon, Settings2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";

import { createWorkspaceProjectAction, type WorkspaceActionState } from "@/lib/actions/workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useIsMobile } from "@/hooks/use-mobile";
import { createWorkspaceProjectSchema } from "@/lib/workspace/contracts";
import type { WorkspaceProjectSummary, WorkspaceTaskSummary } from "@/lib/workspace/store";
import { useWorkspaceDirty, useWorkspaceDirtyState } from "./dirty-state";

type Values = z.infer<typeof createWorkspaceProjectSchema>;
type DockPanel = "projects" | "tasks" | "tools" | null;
const initialState: WorkspaceActionState = { status: "idle", message: "" };

function DockPanelContent({ title, description, children, open, onOpenChange }: { title: string; description: string; children: ReactNode; open: boolean; onOpenChange: (open: boolean) => void }) {
  const mobile = useIsMobile();
  if (mobile) return <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle><DrawerContent><DrawerHeader><DrawerTitle>{title}</DrawerTitle><DrawerDescription>{description}</DrawerDescription></DrawerHeader><div className="min-h-0 flex-1">{children}</div></DrawerContent></Drawer>;
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="right" className="gap-0 sm:max-w-md"><SheetHeader><SheetTitle>{title}</SheetTitle><SheetDescription>{description}</SheetDescription></SheetHeader><div className="min-h-0 flex-1">{children}</div></SheetContent></Sheet>;
}

export function WorkspaceActionDock({ projects, tasks, settingsPanel, activeProjectId, onSave, saveDisabled, savePending }: {
  projects: WorkspaceProjectSummary[];
  tasks: WorkspaceTaskSummary[];
  settingsPanel?: ReactNode;
  activeProjectId?: string;
  onSave?: () => void;
  saveDisabled?: boolean;
  savePending?: boolean;
}) {
  const router = useRouter();
  const { confirmNavigation } = useWorkspaceDirtyState();
  const [panel, setPanel] = useState<DockPanel>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [state, action, pending] = useActionState(createWorkspaceProjectAction, initialState);
  const form = useForm<Values>({ resolver: zodResolver(createWorkspaceProjectSchema), defaultValues: { kind: "marketing", title: "" } });
  useWorkspaceDirty("new-project", createOpen && form.formState.isDirty);
  useEffect(() => {
    if (state.status === "success" && state.projectId) {
      form.reset();
      setCreateOpen(false);
      router.push(`/workspace/${state.projectId}`);
    }
  }, [form, router, state.projectId, state.status]);
  function navigate(url: string) { if (!confirmNavigation()) return; setPanel(null); router.push(url); }
  function submit(values: Values) { const data = new FormData(); data.set("kind", values.kind); data.set("title", values.title); startTransition(() => action(data)); }
  function changeCreateOpen(open: boolean) { if (!open && !confirmNavigation()) return; if (!open) form.reset(); setCreateOpen(open); }
  return <>
    <nav aria-label="画布操作坞" className="fixed bottom-3 left-1/2 z-20 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-1 rounded-xl border bg-background/95 p-1.5 shadow-lg backdrop-blur md:bottom-6">
      <Button size="sm" variant="ghost" onClick={() => setPanel("projects")}><FolderOpenIcon data-icon="inline-start" />项目</Button>
      <Button size="sm" variant="ghost" onClick={() => { setPanel(null); setCreateOpen(true); }}><PlusIcon data-icon="inline-start" />新建</Button>
      <Button size="sm" variant="ghost" onClick={() => setPanel("tasks")}><CheckSquareIcon data-icon="inline-start" />待办{tasks.length ? <Badge variant="secondary">{tasks.length}</Badge> : null}</Button>
      {settingsPanel ? <Button size="sm" variant="ghost" onClick={() => setPanel("tools")}><Settings2Icon data-icon="inline-start" />工具</Button> : null}
      {onSave ? <Button size="sm" variant="default" disabled={saveDisabled || savePending} onClick={onSave}><SaveIcon data-icon="inline-start" />{savePending ? "保存中" : "保存"}</Button> : null}
    </nav>
    <DockPanelContent title="项目" description="切换项目时保持画布作为第一入口。" open={panel === "projects"} onOpenChange={(open) => setPanel(open ? "projects" : null)}><ScrollArea className="h-full"><div className="flex flex-col gap-2 p-4"><Button variant={!activeProjectId ? "secondary" : "outline"} className="justify-start" onClick={() => navigate("/workspace")}>项目总画布</Button>{projects.map((project) => <Button key={project.id} variant={project.id === activeProjectId ? "secondary" : "outline"} className="h-auto justify-start py-3 text-left" onClick={() => navigate(`/workspace/${project.id}`)}><span className="flex min-w-0 flex-1 flex-col gap-1"><span className="truncate font-medium">{project.title}</span><span className="text-xs text-muted-foreground">{project.kind === "marketing" ? "产品营销" : "销售机会"} · {project.status === "active" ? "进行中" : "已归档"}</span></span></Button>)}</div></ScrollArea></DockPanelContent>
    <DockPanelContent title="跨项目待办" description="按优先级汇总，打开后直接定位到所属项目节点。" open={panel === "tasks"} onOpenChange={(open) => setPanel(open ? "tasks" : null)}><ScrollArea className="h-full"><div className="flex flex-col gap-2 p-4">{tasks.length ? tasks.map((task) => <Button key={`${task.priority}-${task.id}`} data-target={`/workspace/${task.projectId}?panel=${task.nodeKind}&view=records&item=${task.id}`} variant="outline" className="h-auto justify-start py-3 text-left" onClick={() => navigate(`/workspace/${task.projectId}?panel=${task.nodeKind}&view=records&item=${task.id}`)}><span className="flex min-w-0 flex-1 flex-col gap-1"><span className="flex items-center gap-2"><Badge variant={task.priority === "review" ? "default" : "secondary"}>{task.priority === "review" ? "审核" : "补全"}</Badge><span className="truncate font-medium">{task.title}</span></span><span className="truncate text-xs text-muted-foreground">{task.projectTitle} · {task.detail}</span></span></Button>) : <p className="p-6 text-center text-sm text-muted-foreground">当前没有待处理事项。</p>}</div></ScrollArea></DockPanelContent>
    {settingsPanel ? <DockPanelContent title="工具与账号" description="管理团队、模型、渠道和账号边界。" open={panel === "tools"} onOpenChange={(open) => setPanel(open ? "tools" : null)}><ScrollArea className="h-full"><div className="p-4">{settingsPanel}</div></ScrollArea></DockPanelContent> : null}
    <Dialog open={createOpen} onOpenChange={changeCreateOpen}><DialogContent><DialogHeader><DialogTitle>新建项目</DialogTitle><DialogDescription>创建后立即进入项目画布。</DialogDescription></DialogHeader><form className="min-h-0 overflow-y-auto" onSubmit={form.handleSubmit(submit)}><FieldGroup><Field data-invalid={!!form.formState.errors.title}><FieldLabel htmlFor="workspace-title">项目名称</FieldLabel><Input id="workspace-title" placeholder="例如：离合器新品推广" aria-invalid={!!form.formState.errors.title} {...form.register("title")} /><FieldError>{form.formState.errors.title?.message}</FieldError></Field><Field><FieldLabel>项目类型</FieldLabel><Controller control={form.control} name="kind" render={({ field }) => <ToggleGroup value={[field.value]} onValueChange={(value) => value[0] && field.onChange(value[0])} variant="outline" spacing={2}><ToggleGroupItem value="marketing">产品营销</ToggleGroupItem><ToggleGroupItem value="sales">销售机会</ToggleGroupItem></ToggleGroup>} /></Field><Button type="submit" disabled={pending}><PlusIcon data-icon="inline-start" />{pending ? "正在创建…" : "创建并打开画布"}</Button></FieldGroup></form>{state.status === "error" ? <p className="text-sm text-destructive" aria-live="polite">{state.message}</p> : null}</DialogContent></Dialog>
  </>;
}
