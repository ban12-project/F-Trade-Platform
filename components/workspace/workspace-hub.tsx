"use client";

import { useActionState, useEffect, useState } from "react";
import { BriefcaseBusinessIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { createWorkspaceProjectAction, initialWorkspaceActionState } from "@/lib/actions/workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { createWorkspaceProjectSchema } from "@/lib/workspace/contracts";
import type { WorkspaceProjectSummary } from "@/lib/workspace/store";

type Values = z.infer<typeof createWorkspaceProjectSchema>;

export function WorkspaceHub({ projects }: { projects: WorkspaceProjectSummary[] }) {
  const router = useRouter(); const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createWorkspaceProjectAction, initialWorkspaceActionState);
  const form = useForm<Values>({ resolver: zodResolver(createWorkspaceProjectSchema), defaultValues: { kind: "marketing", title: "" } });
  useEffect(() => { if (state.status === "success" && state.projectId) { setOpen(false); router.push(`/workspace/${state.projectId}`); } }, [router, state.projectId, state.status]);
  function submit(values: Values) { const data = new FormData(); data.set("kind", values.kind); data.set("title", values.title); action(data); }
  return <main id="main-content" className="min-h-svh bg-muted/30 p-4 md:p-8"><div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
    <header className="flex flex-wrap items-end justify-between gap-4"><div className="flex flex-col gap-2"><div className="flex items-center gap-2"><Badge variant="secondary">项目画布</Badge><Badge variant="outline">人工审核边界</Badge></div><h1 className="text-3xl font-semibold tracking-tight">项目</h1><p className="text-muted-foreground">从一个项目继续工作，或在画布中创建新的工作流。</p></div><Button onClick={() => setOpen(true)}><PlusIcon data-icon="inline-start" />新建项目</Button></header>
    <section aria-label="项目列表" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{projects.map((project) => <Card key={project.id} className="transition-shadow hover:shadow-md"><CardHeader><div className="flex items-center justify-between gap-3"><Badge variant={project.kind === "marketing" ? "secondary" : "outline"}>{project.kind === "marketing" ? "产品营销" : "销售机会"}</Badge><Badge variant="outline">{project.status === "active" ? "进行中" : "已归档"}</Badge></div><CardTitle>{project.title}</CardTitle><CardDescription>最近更新 {project.updatedAt.toLocaleDateString("zh-CN")}</CardDescription></CardHeader><CardContent><Button className="w-full" onClick={() => router.push(`/workspace/${project.id}`)}>打开画布</Button></CardContent></Card>)}</section>
    {projects.length === 0 ? <Empty className="min-h-72 border"><EmptyHeader><EmptyMedia variant="icon"><BriefcaseBusinessIcon /></EmptyMedia><EmptyTitle>还没有项目</EmptyTitle><EmptyDescription>点击右上角“新建项目”，马上从一张画布开始。</EmptyDescription></EmptyHeader></Empty> : null}
    <Sheet open={open} onOpenChange={setOpen}><SheetContent side="bottom" className="mx-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border"><SheetHeader><SheetTitle>新建项目</SheetTitle><SheetDescription>选择适合当前工作的模板，创建后立即进入画布。</SheetDescription></SheetHeader><form className="min-h-0 overflow-y-auto px-4 pb-4" onSubmit={form.handleSubmit(submit)}><FieldGroup><Field data-invalid={!!form.formState.errors.title}><FieldLabel htmlFor="workspace-title">项目名称</FieldLabel><Input id="workspace-title" placeholder="例如：离合器新品推广" aria-invalid={!!form.formState.errors.title} {...form.register("title")} /><FieldError>{form.formState.errors.title?.message}</FieldError></Field><Field><FieldLabel>项目类型</FieldLabel><Controller control={form.control} name="kind" render={({ field }) => <ToggleGroup value={[field.value]} onValueChange={(value) => value[0] && field.onChange(value[0])} variant="outline" spacing={2}><ToggleGroupItem value="marketing">产品营销</ToggleGroupItem><ToggleGroupItem value="sales">销售机会</ToggleGroupItem></ToggleGroup>} /></Field><Button type="submit" disabled={pending}><PlusIcon data-icon="inline-start" />{pending ? "正在创建…" : "创建并打开画布"}</Button></FieldGroup></form>{state.status === "error" ? <p className="px-4 pb-4 text-sm text-destructive" aria-live="polite">{state.message}</p> : null}</SheetContent></Sheet>
  </div></main>;
}
