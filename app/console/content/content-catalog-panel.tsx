"use client";

import { useActionState, useEffect, useMemo, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { FilePenLineIcon, ShieldCheckIcon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { createContentDraftAction, initialContentActionState } from "@/lib/actions/content";
import { generateContentDraftAction, initialContentAgentActionState } from "@/lib/actions/content-agent";
import { contentDraftFormSchema } from "@/lib/form-schemas";
import type { ContentCatalogEntry, ReadyProductContentSource } from "@/lib/content/store";

type ContentFormValues = z.infer<typeof contentDraftFormSchema>;

const contentTypes = [
  { value: "product", label: "产品型" },
  { value: "factory_capability", label: "工厂能力型" },
  { value: "industry_knowledge", label: "行业知识型" },
] as const;

function stateLabel(state: string) {
  return ({ CONTENT_REVIEW_REQUIRED: "待 Gate 01 审核", CONTENT_REVISION_REQUIRED: "待修订", CONTENT_APPROVED: "已通过 Gate 01", CONTENT_PUBLISHED: "已发布" } as Record<string, string>)[state] ?? state;
}

export function ContentCatalogPanel({ entries, products }: { entries: ContentCatalogEntry[]; products: ReadyProductContentSource[] }) {
  const [state, formAction, pending] = useActionState(createContentDraftAction, initialContentActionState);
  const [agentState, agentAction, generating] = useActionState(generateContentDraftAction, initialContentAgentActionState);
  const [, startTransition] = useTransition();
  const form = useForm<ContentFormValues>({
    resolver: zodResolver(contentDraftFormSchema),
    defaultValues: { productId: "", contentType: "product", factPath: "", objective: "", targetCustomer: "", hook: "", body: "", callToAction: "", hashtags: "", visualInstruction: "" },
  });
  const productId = form.watch("productId");
  const selectedProduct = useMemo(() => products.find((product) => product.id === productId), [products, productId]);

  useEffect(() => {
    if (!agentState.draft) return;
    form.setValue("hook", agentState.draft.hook, { shouldValidate: true });
    form.setValue("body", agentState.draft.body, { shouldValidate: true });
    form.setValue("callToAction", agentState.draft.callToAction, { shouldValidate: true });
    form.setValue("hashtags", agentState.draft.hashtags.join(" "), { shouldValidate: true });
    form.setValue("visualInstruction", agentState.draft.visualInstruction, { shouldValidate: true });
  }, [agentState.draft, form]);

  function onSubmit(values: ContentFormValues) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(values)) formData.set(key, value);
    startTransition(() => formAction(formData));
  }
  function generateDraft() {
    const values = form.getValues();
    const formData = new FormData();
    for (const [key, value] of Object.entries(values)) formData.set(key, value);
    startTransition(() => agentAction(formData));
  }

  return <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-6 p-4 md:p-6 lg:p-8">
    <header className="flex flex-col gap-2"><div className="flex flex-wrap gap-2"><Badge variant="secondary">内容工作台</Badge><Badge variant="outline">渠道尚未启用</Badge></div><h1 className="text-3xl font-semibold tracking-tight text-balance">创建内容草稿并进行事实审核</h1><p className="max-w-3xl text-muted-foreground text-pretty">只能引用已审核的产品字段。正式发布前，人工必须确认官方渠道；此处不能发送内容。</p></header>
    <Alert><ShieldCheckIcon /><AlertTitle>产品事实由服务端固定</AlertTitle><AlertDescription>提交时仅接收字段路径，产品值和证据引用会从已核验产品重新取得。视觉说明不能声称花键、尺寸、摩擦材料等工程结构。</AlertDescription></Alert>
    {products.length === 0 ? <Empty><EmptyHeader><EmptyMedia variant="icon"><FilePenLineIcon /></EmptyMedia><EmptyTitle>暂无已审核产品</EmptyTitle><EmptyDescription>先在产品目录完成事实审核。内容工作台不会以草稿或推测数据起草内容。</EmptyDescription></EmptyHeader><EmptyContent>这不是故障：当前环境尚未导入获授权的真实 SKU。</EmptyContent></Empty> : <Card><CardHeader><CardTitle>新建待审内容</CardTitle><CardDescription>渠道固定为“待渠道决策”，不会产生任何对外发布。</CardDescription></CardHeader><CardContent><form autoComplete="off" onSubmit={form.handleSubmit(onSubmit)}><FieldGroup>
      <Field data-invalid={!!form.formState.errors.productId}><FieldLabel htmlFor="content-product">已核验产品</FieldLabel><Controller control={form.control} name="productId" render={({ field }) => <Select value={field.value} onValueChange={(value) => { field.onChange(value); form.setValue("factPath", ""); }}><SelectTrigger id="content-product" className="w-full"><SelectValue placeholder="选择已审核产品" /></SelectTrigger><SelectContent><SelectGroup>{products.map((product) => <SelectItem key={product.id} value={product.id}>{product.internalSku} · {product.productName}</SelectItem>)}</SelectGroup></SelectContent></Select>} /><FieldError errors={[form.formState.errors.productId]} /></Field>
      <Field data-invalid={!!form.formState.errors.factPath}><FieldLabel htmlFor="content-fact">引用的已核验字段</FieldLabel><Controller control={form.control} name="factPath" render={({ field }) => <Select value={field.value} onValueChange={field.onChange} disabled={!selectedProduct}><SelectTrigger id="content-fact" className="w-full"><SelectValue placeholder="先选择产品" /></SelectTrigger><SelectContent><SelectGroup>{selectedProduct?.factOptions.map((fact) => <SelectItem key={fact.path} value={fact.path}>{fact.label}：{fact.value}</SelectItem>)}</SelectGroup></SelectContent></Select>} /><FieldDescription>系统从该字段的人工事实审核记录中取得证据引用。</FieldDescription><FieldError errors={[form.formState.errors.factPath]} /></Field>
      <Field><FieldLabel htmlFor="content-type">内容类型</FieldLabel><Controller control={form.control} name="contentType" render={({ field }) => <Select value={field.value} onValueChange={field.onChange}><SelectTrigger id="content-type" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{contentTypes.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select>} /></Field>
      <FieldGroup className="grid gap-4 md:grid-cols-2"><Field data-invalid={!!form.formState.errors.objective}><FieldLabel htmlFor="objective">目标</FieldLabel><Input id="objective" {...form.register("objective")} /><FieldError errors={[form.formState.errors.objective]} /></Field><Field data-invalid={!!form.formState.errors.targetCustomer}><FieldLabel htmlFor="target-customer">目标客户</FieldLabel><Input id="target-customer" {...form.register("targetCustomer")} /><FieldError errors={[form.formState.errors.targetCustomer]} /></Field></FieldGroup>
      <div className="flex justify-end"><Button type="button" variant="outline" onClick={generateDraft} disabled={generating}>{generating && <Spinner aria-hidden="true" data-icon="inline-start" />}生成 AI 英文初稿</Button></div>
      <Field data-invalid={!!form.formState.errors.hook}><FieldLabel htmlFor="hook">开场句</FieldLabel><Input id="hook" {...form.register("hook")} /><FieldError errors={[form.formState.errors.hook]} /></Field>
      <Field data-invalid={!!form.formState.errors.body}><FieldLabel htmlFor="body">正文</FieldLabel><Textarea id="body" rows={6} {...form.register("body")} /><FieldError errors={[form.formState.errors.body]} /></Field>
      <FieldGroup className="grid gap-4 md:grid-cols-2"><Field data-invalid={!!form.formState.errors.callToAction}><FieldLabel htmlFor="cta">行动号召</FieldLabel><Input id="cta" {...form.register("callToAction")} /><FieldError errors={[form.formState.errors.callToAction]} /></Field><Field data-invalid={!!form.formState.errors.hashtags}><FieldLabel htmlFor="hashtags">标签</FieldLabel><Input id="hashtags" placeholder="#Clutch, #Aftermarket…" {...form.register("hashtags")} /><FieldError errors={[form.formState.errors.hashtags]} /></Field></FieldGroup>
      <Field data-invalid={!!form.formState.errors.visualInstruction}><FieldLabel htmlFor="visual-instruction">视觉说明</FieldLabel><Textarea id="visual-instruction" rows={3} {...form.register("visualInstruction")} /><FieldDescription>只能描述非工程化的示意视觉，不能把图像作为事实证明。</FieldDescription><FieldError errors={[form.formState.errors.visualInstruction]} /></Field>
      <div className="flex justify-end"><Button type="submit" disabled={pending}>{pending && <Spinner aria-hidden="true" data-icon="inline-start" />}创建待审内容</Button></div>
    </FieldGroup></form></CardContent><CardFooter>提交不会调用外部模型或发布渠道。每份内容都要经过人工事实审核。</CardFooter></Card>}
    <Card><CardHeader><CardTitle>最近内容</CardTitle><CardDescription>批准不等于发布。选择官方渠道前，内容保持已批准状态。</CardDescription></CardHeader><CardContent>{entries.length === 0 ? <p className="text-sm text-muted-foreground">尚无内容草稿。</p> : <Table><TableHeader><TableRow><TableHead>产品</TableHead><TableHead>类型</TableHead><TableHead>开场句</TableHead><TableHead>状态</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{entries.map((entry) => <TableRow key={entry.id}><TableCell>{entry.productName}</TableCell><TableCell>{contentTypes.find((item) => item.value === entry.contentType)?.label ?? entry.contentType}</TableCell><TableCell className="max-w-md truncate">{entry.hook}</TableCell><TableCell><Badge variant="secondary">{stateLabel(entry.state)}</Badge></TableCell><TableCell>{entry.state === "CONTENT_REVIEW_REQUIRED" && entry.approvalStatus === "pending" ? <LinkButton size="sm" variant="outline" href={`/console/content/${entry.id}`}>审核</LinkButton> : entry.state === "CONTENT_REVISION_REQUIRED" ? <LinkButton size="sm" variant="outline" href={`/console/content/${entry.id}/revise`}>修订</LinkButton> : "无操作"}</TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>
    {state.status !== "idle" && <Alert variant={state.status === "error" ? "destructive" : "default"}><AlertTitle>{state.status === "success" ? "已保存" : "未能保存"}</AlertTitle><AlertDescription>{state.message}</AlertDescription></Alert>}
    {agentState.status !== "idle" && <Alert variant={agentState.status === "error" ? "destructive" : "default"}><AlertTitle>{agentState.status === "success" ? "AI 初稿已填入表单" : "未能生成初稿"}</AlertTitle><AlertDescription>{agentState.message}</AlertDescription></Alert>}
  </div>;
}
