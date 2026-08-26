"use client";

import { useActionState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftIcon, CheckCircle2Icon, ShieldCheckIcon, XCircleIcon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { decideContentReviewAction, initialContentActionState } from "@/lib/actions/content";
import { contentReviewFormSchema } from "@/lib/form-schemas";
import type { ContentCatalogDetail } from "@/lib/content/store";

type ReviewValues = z.infer<typeof contentReviewFormSchema>;

function contentTypeLabel(value: string) {
  return ({ product: "产品型", factory_capability: "工厂能力型", industry_knowledge: "行业知识型" } as Record<string, string>)[value] ?? value;
}

function stateLabel(state: string) {
  return ({
    CONTENT_REVIEW_REQUIRED: "待 Gate 01 审核",
    CONTENT_REVISION_REQUIRED: "待修订",
    CONTENT_APPROVED: "已通过 Gate 01",
  } as Record<string, string>)[state] ?? state;
}

export function ContentReviewPanel({ content }: { content: ContentCatalogDetail }) {
  const [state, formAction, pending] = useActionState(decideContentReviewAction, initialContentActionState);
  const [, startTransition] = useTransition();
  const form = useForm<ReviewValues>({ resolver: zodResolver(contentReviewFormSchema), defaultValues: { contentId: content.id, decision: "approved", evidenceRef: "", notes: "" } });
  const canDecide = content.state === "CONTENT_REVIEW_REQUIRED" && content.approvalStatus === "pending";

  function onSubmit(values: ReviewValues) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(values)) formData.set(key, value);
    startTransition(() => formAction(formData));
  }

  return <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-6 p-4 md:p-6 lg:p-8">
    <header className="flex flex-col gap-3"><LinkButton className="w-fit" size="sm" variant="ghost" href="/console/content"><ArrowLeftIcon data-icon="inline-start" />返回内容工作台</LinkButton><div className="flex gap-2"><Badge variant="secondary">人工事实审核</Badge><Badge variant="outline">{stateLabel(content.state)}</Badge></div><h1 className="text-3xl font-semibold tracking-tight text-balance">审核内容草稿</h1><p className="text-muted-foreground text-pretty">审核营销措辞、产品事实引用和视觉边界。批准不会发布到任何渠道。</p></header>
    <Alert><ShieldCheckIcon /><AlertTitle>内容不替代产品证据</AlertTitle><AlertDescription>表内产品字段由已通过 Gate 01 的产品服务端派生。审核证据必须来自受控私有存储。</AlertDescription></Alert>
    <Card><CardHeader><CardTitle>内容预览</CardTitle><CardDescription>{contentTypeLabel(content.content.content_type)} · 渠道：待决策</CardDescription></CardHeader><CardContent className="flex flex-col gap-5"><p className="whitespace-pre-wrap break-words text-sm leading-6">{content.content.body}</p><div><p className="mb-2 text-sm font-medium">行动号召</p><p className="break-words text-sm text-muted-foreground">{content.content.call_to_action}</p></div><div><p className="mb-2 text-sm font-medium">视觉说明</p><p className="break-words text-sm text-muted-foreground">{content.content.visual_instruction}</p></div><Table><TableHeader><TableRow><TableHead>产品字段</TableHead><TableHead>值</TableHead><TableHead>证据引用</TableHead></TableRow></TableHeader><TableBody>{content.content.product_facts.map((fact) => <TableRow key={fact.field}><TableCell className="max-w-48 whitespace-normal break-words font-mono text-xs">{fact.field}</TableCell><TableCell className="max-w-64 whitespace-normal break-words">{fact.value}</TableCell><TableCell className="max-w-64 whitespace-normal break-words font-mono text-xs">{fact.evidence_ref}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
    <Card><CardHeader><CardTitle>人工事实审核决定</CardTitle><CardDescription>该决定会写入独立审批、不可变工作流事件和审计事件。</CardDescription></CardHeader><CardContent>{!canDecide ? <Alert><AlertTitle>当前无待处理审核</AlertTitle><AlertDescription>该内容已经审核，或状态已不允许再次决定。</AlertDescription></Alert> : <form autoComplete="off" onSubmit={form.handleSubmit(onSubmit)}><FieldGroup><Field><FieldLabel htmlFor="content-review-decision">决定</FieldLabel><Controller control={form.control} name="decision" render={({ field }) => <Select value={field.value} onValueChange={field.onChange}><SelectTrigger id="content-review-decision" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="approved">批准：等待官方渠道发布</SelectItem><SelectItem value="rejected">退回：要求修订</SelectItem></SelectGroup></SelectContent></Select>} /></Field><Field data-invalid={!!form.formState.errors.evidenceRef}><FieldLabel htmlFor="review-evidence-ref">审核证据引用</FieldLabel><Input id="review-evidence-ref" {...form.register("evidenceRef")} /><FieldDescription>例如 evidence-content-review-001。</FieldDescription><FieldError errors={[form.formState.errors.evidenceRef]} /></Field><Field data-invalid={!!form.formState.errors.notes}><FieldLabel htmlFor="notes">审核备注</FieldLabel><Textarea id="notes" {...form.register("notes")} /><FieldError errors={[form.formState.errors.notes]} /></Field><div className="flex justify-end"><Button type="submit" disabled={pending} variant="outline">{pending ? <Spinner aria-hidden="true" data-icon="inline-start" /> : form.watch("decision") === "approved" ? <CheckCircle2Icon data-icon="inline-start" /> : <XCircleIcon data-icon="inline-start" />}提交人工决定</Button></div></FieldGroup></form>}</CardContent></Card>
    {state.status !== "idle" && <Alert variant={state.status === "error" ? "destructive" : "default"}><AlertTitle>{state.status === "success" ? "已记录" : "未能记录"}</AlertTitle><AlertDescription>{state.message}</AlertDescription></Alert>}
  </div>;
}
