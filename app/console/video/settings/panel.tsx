"use client";

import { useActionState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRoundIcon, SaveIcon, ShieldCheckIcon, VideoIcon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { initialVideoProviderSettingsActionState, saveVideoProviderModelSettingsAction } from "@/lib/actions/video-provider-settings";
import { videoProviderModelSettingsFormSchema } from "@/lib/form-schemas";
import type { VideoProviderSettingsSummary } from "@/lib/video/provider-config-store";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

type FormInput = z.input<typeof videoProviderModelSettingsFormSchema>;
type Values = z.output<typeof videoProviderModelSettingsFormSchema>;

const defaults: FormInput = {
  provider: "google", providerEnabled: false, credential: "", clearCredential: false,
  maximumConcurrentJobs: 1, maximumAttempts: 1, budgetLimitCents: 1, budgetCommittedCents: 0,
  modelId: "", capabilities: "text-to-video", aspectRatios: "16:9", durationMinimumSeconds: 1,
  durationMaximumSeconds: 10, resolutions: "1280x720", verifiedAt: "", verificationRef: "", modelEnabled: false,
};

export function VideoProviderSettingsPanel({ settings }: { settings: VideoProviderSettingsSummary[] }) {
  const [state, formAction, pending] = useActionState(saveVideoProviderModelSettingsAction, initialVideoProviderSettingsActionState);
  const [, startTransition] = useTransition();
  const form = useForm<FormInput, unknown, Values>({ resolver: zodResolver(videoProviderModelSettingsFormSchema), defaultValues: defaults });

  function onSubmit(values: Values) {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, String(value));
    startTransition(() => formAction(data));
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-6 p-4 md:p-6 lg:p-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><VideoIcon aria-hidden="true" /><span>视频工作流</span></div>
        <h1 className="text-3xl font-semibold tracking-tight">视频模型配置</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">仅由管理员登记经验证的 AI SDK 视频模型。安装 SDK 不等于可用；凭据只在服务端加密保存。</p>
      </header>
      <Alert><ShieldCheckIcon /><AlertTitle>受控启用</AlertTitle><AlertDescription>启用模型需要验证时间与证据引用；启用提供商需要凭据。此处不能发布视频或绕过人工审核。</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle>已保存配置</CardTitle><CardDescription>显示配置状态，不显示或传回任何凭据。</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {settings.length ? settings.map((item) => <Badge key={item.provider} variant={item.enabled ? "default" : "secondary"}>{item.provider} · {item.credentialConfigured ? "凭据已配置" : "未配置凭据"} · {item.models.length} 个模型</Badge>) : <p className="text-sm text-muted-foreground">尚未登记任何视频提供商。</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>登记或更新模型</CardTitle><CardDescription>逗号分隔能力、画幅和分辨率；证据引用必须是可复核的私有引用。</CardDescription></CardHeader>
        <CardContent>
          <form autoComplete="off" onSubmit={form.handleSubmit(onSubmit)}>
            <FieldGroup>
              <FieldSet><FieldLegend>提供商与运行边界</FieldLegend><FieldGroup className="grid gap-4 md:grid-cols-2">
                <Field data-invalid={!!form.formState.errors.provider}><FieldLabel htmlFor="video-provider">提供商</FieldLabel><Controller control={form.control} name="provider" render={({ field }) => <Select value={field.value} onValueChange={field.onChange}><SelectTrigger id="video-provider" className="w-full" aria-invalid={!!form.formState.errors.provider}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{["alibaba", "bytedance", "fal", "google", "google-vertex", "kling", "replicate", "xai"].map((provider) => <SelectItem key={provider} value={provider}>{provider}</SelectItem>)}</SelectGroup></SelectContent></Select>} /><FieldError errors={[form.formState.errors.provider]} /></Field>
                <Field data-invalid={!!form.formState.errors.credential}><FieldLabel htmlFor="video-credential">API 凭据</FieldLabel><Input id="video-credential" type="password" autoComplete="new-password" aria-invalid={!!form.formState.errors.credential} {...form.register("credential")} /><FieldDescription>留空会保留已有凭据。</FieldDescription><FieldError errors={[form.formState.errors.credential]} /></Field>
                <Field><Controller control={form.control} name="providerEnabled" render={({ field }) => <Checkbox id="video-provider-enabled" checked={field.value} onCheckedChange={field.onChange} />} /><FieldLabel htmlFor="video-provider-enabled">启用提供商</FieldLabel></Field>
                <Field><Controller control={form.control} name="clearCredential" render={({ field }) => <Checkbox id="video-clear-credential" checked={field.value} onCheckedChange={field.onChange} />} /><FieldLabel htmlFor="video-clear-credential">清除已有凭据</FieldLabel></Field>
                <Field data-invalid={!!form.formState.errors.maximumConcurrentJobs}><FieldLabel htmlFor="video-concurrency">最大并发</FieldLabel><Input id="video-concurrency" type="number" min="1" aria-invalid={!!form.formState.errors.maximumConcurrentJobs} {...form.register("maximumConcurrentJobs")} /><FieldError errors={[form.formState.errors.maximumConcurrentJobs]} /></Field>
                <Field data-invalid={!!form.formState.errors.maximumAttempts}><FieldLabel htmlFor="video-attempts">最大尝试次数</FieldLabel><Input id="video-attempts" type="number" min="1" max="10" aria-invalid={!!form.formState.errors.maximumAttempts} {...form.register("maximumAttempts")} /><FieldError errors={[form.formState.errors.maximumAttempts]} /></Field>
                <Field data-invalid={!!form.formState.errors.budgetLimitCents}><FieldLabel htmlFor="video-budget-limit">预算上限（分）</FieldLabel><Input id="video-budget-limit" type="number" min="1" aria-invalid={!!form.formState.errors.budgetLimitCents} {...form.register("budgetLimitCents")} /><FieldError errors={[form.formState.errors.budgetLimitCents]} /></Field>
                <Field data-invalid={!!form.formState.errors.budgetCommittedCents}><FieldLabel htmlFor="video-budget-committed">已承诺预算（分）</FieldLabel><Input id="video-budget-committed" type="number" min="0" aria-invalid={!!form.formState.errors.budgetCommittedCents} {...form.register("budgetCommittedCents")} /><FieldError errors={[form.formState.errors.budgetCommittedCents]} /></Field>
              </FieldGroup></FieldSet>
              <FieldSet><FieldLegend>经验证的模型能力</FieldLegend><FieldGroup className="grid gap-4 md:grid-cols-2">
                {([['modelId','模型标识'],['capabilities','能力（逗号分隔）'],['aspectRatios','画幅（逗号分隔）'],['resolutions','分辨率（逗号分隔）'],['verificationRef','验证证据引用']] as const).map(([name,label]) => <Field key={name} data-invalid={!!form.formState.errors[name]}><FieldLabel htmlFor={`video-${name}`}>{label}</FieldLabel><Input id={`video-${name}`} aria-invalid={!!form.formState.errors[name]} {...form.register(name)} /><FieldError errors={[form.formState.errors[name]]} /></Field>)}
                <Field data-invalid={!!form.formState.errors.durationMinimumSeconds}><FieldLabel htmlFor="video-duration-min">最短时长（秒）</FieldLabel><Input id="video-duration-min" type="number" min="1" {...form.register("durationMinimumSeconds")} /><FieldError errors={[form.formState.errors.durationMinimumSeconds]} /></Field>
                <Field data-invalid={!!form.formState.errors.durationMaximumSeconds}><FieldLabel htmlFor="video-duration-max">最长时长（秒）</FieldLabel><Input id="video-duration-max" type="number" min="1" {...form.register("durationMaximumSeconds")} /><FieldError errors={[form.formState.errors.durationMaximumSeconds]} /></Field>
                <Field data-invalid={!!form.formState.errors.verifiedAt}><FieldLabel htmlFor="video-verified-at">验证时间</FieldLabel><Input id="video-verified-at" type="datetime-local" {...form.register("verifiedAt")} /><FieldError errors={[form.formState.errors.verifiedAt]} /></Field>
                <Field><Controller control={form.control} name="modelEnabled" render={({ field }) => <Checkbox id="video-model-enabled" checked={field.value} onCheckedChange={field.onChange} />} /><FieldLabel htmlFor="video-model-enabled">启用模型</FieldLabel><FieldError errors={[form.formState.errors.modelEnabled]} /></Field>
              </FieldGroup></FieldSet>
              <div className="flex flex-wrap items-center justify-between gap-3"><p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">{state.message}</p><Button type="submit" disabled={pending}>{pending ? <Spinner aria-hidden="true" data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}保存视频配置</Button></div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
