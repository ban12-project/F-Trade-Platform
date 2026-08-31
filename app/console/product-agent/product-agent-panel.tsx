"use client";

import { useActionState, useRef, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { BotIcon, ExternalLinkIcon, ShieldCheckIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { runProductAgentAction, initialProductAgentActionState } from "@/lib/actions/product-agent";
import { productAgentRunFormSchema } from "@/lib/form-schemas";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

type Values = z.infer<typeof productAgentRunFormSchema>;

export function ProductAgentPanel({ configured }: { configured: boolean }) {
  const [state, formAction, pending] = useActionState(runProductAgentAction, initialProductAgentActionState);
  const [, startTransition] = useTransition();
  const formElement = useRef<HTMLFormElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  const form = useForm<Values>({ resolver: zodResolver(productAgentRunFormSchema), defaultValues: { sourceRef: "", evidenceRef: "", sourceText: "", hasUpload: false } });
  const submit = (values: Values) => { const data = new FormData(formElement.current ?? undefined); Object.entries(values).forEach(([key, value]) => data.set(key, String(value))); startTransition(() => formAction(data)); };
  const receiveDocument = (files: FileList) => { const [file] = Array.from(files); if (!file) return; const transfer = new DataTransfer(); transfer.items.add(file); if (documentInput.current) documentInput.current.files = transfer.files; form.setValue("hasUpload", true, { shouldValidate: true }); };
  return <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-6 p-4 md:p-6 lg:p-8">
    <header className="flex flex-col gap-2"><div className="flex items-center gap-2 text-sm text-muted-foreground"><BotIcon aria-hidden="true" /><span>产品资料导入</span></div><h1 className="text-3xl font-semibold tracking-tight">从获授权资料创建产品草稿</h1><p className="max-w-3xl text-muted-foreground">系统会将已授权且脱敏的工厂资料转换为待人工确认的产品草稿；结果不会自动成为 Product Ready。</p></header>
    {!configured && <Alert variant="destructive"><AlertTitle>尚未配置模型</AlertTitle><AlertDescription>先保存可用的服务端模型凭据，才能运行 Agent。</AlertDescription></Alert>}
    <Alert><ShieldCheckIcon /><AlertTitle>事实与资料边界</AlertTitle><AlertDescription>仅粘贴已授权的脱敏文本。OE、车型、尺寸和材料只会在来源有明确标签时保留；缺失项会进入 Gate 01 人工审核。</AlertDescription></Alert>
    <Card><CardHeader><CardTitle>运行一次提取</CardTitle><CardDescription>上传的原始资料只保存在 Private Blob；产品草稿与浏览器均不保存原文。</CardDescription></CardHeader><CardContent><form ref={formElement} autoComplete="off" onSubmit={form.handleSubmit(submit)}><FieldGroup><input type="hidden" {...form.register("hasUpload")} /><Field onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); receiveDocument(event.dataTransfer.files); }}><FieldLabel htmlFor="agent-document">拖入或选择产品资料（推荐）</FieldLabel><Input ref={documentInput} id="agent-document" name="document" type="file" accept=".pdf,.csv,.xls,.xlsx" onChange={(event) => form.setValue("hasUpload", Boolean(event.target.files?.length), { shouldValidate: true })} /><FieldDescription>仅限 PDF、CSV、XLS、XLSX，最大 25MB。上传时无需填写下方文本与引用。</FieldDescription></Field><Field data-invalid={!!form.formState.errors.sourceRef}><FieldLabel htmlFor="agent-source-ref">来源引用（粘贴文本时必填）</FieldLabel><Input id="agent-source-ref" placeholder="source-catalog-001" aria-invalid={!!form.formState.errors.sourceRef} {...form.register("sourceRef")} /><FieldError errors={[form.formState.errors.sourceRef]} /></Field><Field data-invalid={!!form.formState.errors.evidenceRef}><FieldLabel htmlFor="agent-evidence-ref">字段证据引用（粘贴文本时必填）</FieldLabel><Input id="agent-evidence-ref" placeholder="evidence-catalog-001" aria-invalid={!!form.formState.errors.evidenceRef} {...form.register("evidenceRef")} /><FieldError errors={[form.formState.errors.evidenceRef]} /></Field><Field data-invalid={!!form.formState.errors.sourceText}><FieldLabel htmlFor="agent-source-text">已授权资料文本（可替代上传）</FieldLabel><Textarea id="agent-source-text" rows={14} spellCheck={false} aria-invalid={!!form.formState.errors.sourceText} {...form.register("sourceText")} /><FieldDescription>用于已预处理的表格或标签文本；不支持来源路径或公开 URL。</FieldDescription><FieldError errors={[form.formState.errors.sourceText]} /></Field><div className="flex justify-end"><Button type="submit" disabled={pending || !configured}>{pending ? <Spinner aria-hidden="true" data-icon="inline-start" /> : <BotIcon data-icon="inline-start" />}生成待审核草稿</Button></div></FieldGroup></form></CardContent><CardFooter>Agent 只能创建待审草稿，不能批准、发布、报价或承诺交期。</CardFooter></Card>
    {state.status !== "idle" && <Alert variant={state.status === "error" ? "destructive" : "default"}><AlertTitle>{state.status === "success" ? "已创建草稿" : "运行失败"}</AlertTitle><AlertDescription>{state.message}{state.productId && <LinkButton className="ml-3" size="sm" variant="outline" href={`/console/products/${state.productId}`}><ExternalLinkIcon data-icon="inline-start" />打开审核</LinkButton>}</AlertDescription></Alert>}
  </div>;
}
