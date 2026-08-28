"use client";

import { useActionState, useMemo, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ClapperboardIcon, ShieldCheckIcon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { submitApprovedVideoJobAction, initialVideoJobSubmissionActionState } from "@/lib/actions/video-job-submission";
import { videoJobSubmissionFormSchema } from "@/lib/form-schemas";

type Values = z.output<typeof videoJobSubmissionFormSchema>;
type FormValues = z.input<typeof videoJobSubmissionFormSchema>;

export type EligibleVideoModel = {
  provider: Values["provider"];
  modelId: string;
  aspectRatios: Values["aspectRatio"][];
  resolutions: string[];
  durationMaximumSeconds: number;
};

export type ApprovedVideoPlan = { id: string; objective: string; productName: string };

export function VideoGenerationPanel({ plans, models }: { plans: ApprovedVideoPlan[]; models: EligibleVideoModel[] }) {
  const [state, action, pending] = useActionState(submitApprovedVideoJobAction, initialVideoJobSubmissionActionState);
  const [, startTransition] = useTransition();
  const first = models[0];
  const form = useForm<FormValues, unknown, Values>({
    resolver: zodResolver(videoJobSubmissionFormSchema),
    defaultValues: first ? {
      videoId: plans[0]?.id ?? "",
      provider: first.provider,
      modelId: first.modelId,
      requiredCapabilities: ["text-to-video"],
      aspectRatio: first.aspectRatios[0] ?? "16:9",
      durationSeconds: Math.min(5, first.durationMaximumSeconds),
      resolution: first.resolutions[0] ?? "1280x720",
      expectedCostCents: 1,
    } : undefined,
  });
  const provider = form.watch("provider");
  const selectedModelId = form.watch("modelId");
  const providerModels = useMemo(() => models.filter((model) => model.provider === provider), [models, provider]);
  const selectedModel = providerModels.find((model) => model.modelId === selectedModelId) ?? providerModels[0];

  function selectModel(model: EligibleVideoModel) {
    form.setValue("provider", model.provider, { shouldValidate: true });
    form.setValue("modelId", model.modelId, { shouldValidate: true });
    form.setValue("aspectRatio", model.aspectRatios[0] ?? "16:9", { shouldValidate: true });
    form.setValue("resolution", model.resolutions[0] ?? "1280x720", { shouldValidate: true });
    form.setValue("durationSeconds", Math.min(5, model.durationMaximumSeconds), { shouldValidate: true });
  }
  function submit(values: Values) {
    const data = new FormData();
    data.set("videoId", values.videoId); data.set("provider", values.provider); data.set("modelId", values.modelId);
    data.set("aspectRatio", values.aspectRatio); data.set("durationSeconds", String(values.durationSeconds));
    data.set("resolution", values.resolution); data.set("expectedCostCents", String(values.expectedCostCents));
    for (const capability of values.requiredCapabilities) data.append("requiredCapabilities", capability);
    startTransition(() => action(data));
  }

  return <Card>
    <CardHeader><CardTitle>提交已批准计划生成视频</CardTitle><CardDescription>只显示已启用、凭据已配置且人工验证过的文本生成视频模型。提交后由受控 worker 执行，不会自动发布。</CardDescription></CardHeader>
    <CardContent>{plans.length === 0 || models.length === 0 ? <Alert><ShieldCheckIcon /><AlertTitle>暂不能提交生成任务</AlertTitle><AlertDescription>{plans.length === 0 ? "需要先通过 Gate 01 审核视频计划。" : "管理员需要在提供商设置中配置凭据、启用提供商并验证至少一个视频模型。"}</AlertDescription></Alert> : <form onSubmit={form.handleSubmit(submit)} autoComplete="off"><FieldGroup>
      <Field data-invalid={!!form.formState.errors.videoId}><FieldLabel htmlFor="generation-plan">已批准的视频计划</FieldLabel><Controller control={form.control} name="videoId" render={({ field }) => <Select value={field.value} onValueChange={field.onChange} items={plans.map((plan) => ({ value: plan.id, label: `${plan.productName} · ${plan.objective}` }))}><SelectTrigger id="generation-plan" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{plans.map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.productName} · {plan.objective}</SelectItem>)}</SelectGroup></SelectContent></Select>} /><FieldError>{form.formState.errors.videoId?.message}</FieldError></Field>
      <Field><FieldLabel htmlFor="generation-provider">提供商</FieldLabel><Controller control={form.control} name="provider" render={({ field }) => <Select value={field.value} onValueChange={(value) => { const next = models.find((model) => model.provider === value); if (next) selectModel(next); }} items={[...new Set(models.map((model) => model.provider))].map((value) => ({ value, label: value }))}><SelectTrigger id="generation-provider" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{[...new Set(models.map((model) => model.provider))].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectGroup></SelectContent></Select>} /></Field>
      <Field><FieldLabel htmlFor="generation-model">已验证模型</FieldLabel><Controller control={form.control} name="modelId" render={({ field }) => <Select value={field.value} onValueChange={(value) => { const next = providerModels.find((model) => model.modelId === value); if (next) selectModel(next); }} items={providerModels.map((model) => ({ value: model.modelId, label: model.modelId }))}><SelectTrigger id="generation-model" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{providerModels.map((model) => <SelectItem key={model.modelId} value={model.modelId}>{model.modelId}</SelectItem>)}</SelectGroup></SelectContent></Select>} /></Field>
      <Field><FieldLabel htmlFor="generation-ratio">画幅</FieldLabel><Controller control={form.control} name="aspectRatio" render={({ field }) => <Select value={field.value} onValueChange={field.onChange} items={(selectedModel?.aspectRatios ?? []).map((value) => ({ value, label: value }))}><SelectTrigger id="generation-ratio" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{selectedModel?.aspectRatios.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectGroup></SelectContent></Select>} /></Field>
      <Field data-invalid={!!form.formState.errors.durationSeconds}><FieldLabel htmlFor="generation-duration">时长（秒）</FieldLabel><Input id="generation-duration" type="number" min={1} max={selectedModel?.durationMaximumSeconds ?? 30} {...form.register("durationSeconds", { valueAsNumber: true })} /><FieldDescription>当前模型最多 {selectedModel?.durationMaximumSeconds ?? 0} 秒。</FieldDescription><FieldError>{form.formState.errors.durationSeconds?.message}</FieldError></Field>
      <Field data-invalid={!!form.formState.errors.resolution}><FieldLabel htmlFor="generation-resolution">分辨率</FieldLabel><Controller control={form.control} name="resolution" render={({ field }) => <Select value={field.value} onValueChange={field.onChange} items={(selectedModel?.resolutions ?? []).map((value) => ({ value, label: value }))}><SelectTrigger id="generation-resolution" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{selectedModel?.resolutions.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectGroup></SelectContent></Select>} /><FieldError>{form.formState.errors.resolution?.message}</FieldError></Field>
      <Field data-invalid={!!form.formState.errors.expectedCostCents}><FieldLabel htmlFor="generation-cost">预计成本（分）</FieldLabel><Input id="generation-cost" type="number" min={1} {...form.register("expectedCostCents", { valueAsNumber: true })} /><FieldDescription>这是预算预留值；服务端会重新核对提供商预算与并发策略。</FieldDescription><FieldError>{form.formState.errors.expectedCostCents?.message}</FieldError></Field>
    </FieldGroup><CardFooter className="mt-6 px-0"><Button type="submit" disabled={pending}>{pending ? <Spinner data-icon="inline-start" /> : <ClapperboardIcon data-icon="inline-start" />}提交受控生成任务</Button></CardFooter></form>}</CardContent>
    {state.status !== "idle" ? <CardFooter><Alert variant={state.status === "error" ? "destructive" : "default"}><AlertTitle>{state.status === "success" ? "任务已排队" : "无法提交"}</AlertTitle><AlertDescription>{state.message}</AlertDescription></Alert></CardFooter> : null}
  </Card>;
}
