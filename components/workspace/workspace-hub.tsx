"use client";

import { useActionState, useEffect } from "react";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { createWorkspaceProjectSchema } from "@/lib/workspace/contracts";
import type { WorkspaceProjectSummary } from "@/lib/workspace/store";

type Values = z.infer<typeof createWorkspaceProjectSchema>;

export function WorkspaceHub({ projects }: { projects: WorkspaceProjectSummary[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createWorkspaceProjectAction, initialWorkspaceActionState);
  const form = useForm<Values>({ resolver: zodResolver(createWorkspaceProjectSchema), defaultValues: { kind: "marketing", title: "" } });
  useEffect(() => { if (state.status === "success" && state.projectId) router.push(`/workspace/${state.projectId}`); }, [router, state.projectId, state.status]);
  function submit(values: Values) { const data = new FormData(); data.set("kind", values.kind); data.set("title", values.title); action(data); }
  return <main id="main-content" className="min-h-svh bg-muted/30 p-4 md:p-8"><div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
    <header className="flex flex-col gap-2"><div className="flex items-center gap-2"><Badge variant="secondary">项目画布</Badge><Badge variant="outline">人工审核边界</Badge></div><h1 className="text-3xl font-semibold tracking-tight">选择或创建项目</h1><p className="text-muted-foreground">项目把受控产品、内容、视频或客户机会组织在同一张画布中。</p></header>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]"><section className="min-w-0"><div className="grid gap-4 sm:grid-cols-2">{projects.map((project) => <Card key={project.id} className="transition-shadow hover:shadow-md"><CardHeader><div className="flex items-center justify-between gap-3"><Badge variant={project.kind === "marketing" ? "secondary" : "outline"}>{project.kind === "marketing" ? "产品营销" : "销售机会"}</Badge><Badge variant="outline">{project.status === "active" ? "进行中" : "已归档"}</Badge></div><CardTitle>{project.title}</CardTitle><CardDescription>最近更新 {project.updatedAt.toLocaleDateString("zh-CN")}</CardDescription></CardHeader><CardContent><Button className="w-full" onClick={() => router.push(`/workspace/${project.id}`)}>打开画布</Button></CardContent></Card>)}</div>{projects.length === 0 ? <Empty className="min-h-72 border"><EmptyHeader><EmptyMedia variant="icon"><BriefcaseBusinessIcon /></EmptyMedia><EmptyTitle>还没有项目</EmptyTitle><EmptyDescription>从右侧创建一个产品营销或销售机会项目。</EmptyDescription></EmptyHeader></Empty> : null}</section>
      <Card><CardHeader><CardTitle>新建项目</CardTitle><CardDescription>选择适合当前工作的项目模板。</CardDescription></CardHeader><CardContent><form onSubmit={form.handleSubmit(submit)}><FieldGroup><Field data-invalid={!!form.formState.errors.title}><FieldLabel htmlFor="workspace-title">项目名称</FieldLabel><Input id="workspace-title" placeholder="例如：离合器新品推广" aria-invalid={!!form.formState.errors.title} {...form.register("title")} /><FieldError>{form.formState.errors.title?.message}</FieldError></Field><Field><FieldLabel>项目类型</FieldLabel><Controller control={form.control} name="kind" render={({ field }) => <ToggleGroup value={[field.value]} onValueChange={(value) => value[0] && field.onChange(value[0])} variant="outline" spacing={2}><ToggleGroupItem value="marketing">产品营销</ToggleGroupItem><ToggleGroupItem value="sales">销售机会</ToggleGroupItem></ToggleGroup>} /></Field><Button type="submit" disabled={pending}><PlusIcon data-icon="inline-start" />{pending ? "正在创建…" : "创建项目"}</Button></FieldGroup></form>{state.status !== "idle" ? <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">{state.message}</p> : null}</CardContent></Card>
    </div></div></main>;
}
