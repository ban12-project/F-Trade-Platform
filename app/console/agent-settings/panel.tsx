"use client";

import { useActionState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRoundIcon, SaveIcon, ShieldCheckIcon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { saveProductAgentModelSettingsAction, initialAgentSettingsActionState } from "@/lib/actions/agent-settings";
import { productAgentModelSettingsSchema } from "@/lib/form-schemas";
import type { ProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

type Values = z.infer<typeof productAgentModelSettingsSchema>;

const fallback: ProductAgentModelSettings = {
  provider: "openai",
  model: "gpt-5-mini",
  baseUrl: "",
  headersJson: "{}",
  providerName: "",
  organization: "",
  project: "",
  apiKeyConfigured: false,
  authTokenConfigured: false,
  source: "unconfigured",
};

export function AgentSettingsPanel({ settings = fallback }: { settings?: ProductAgentModelSettings }) {
  const [state, formAction, pending] = useActionState(
    saveProductAgentModelSettingsAction,
    initialAgentSettingsActionState,
  );
  const [, startTransition] = useTransition();
  const form = useForm<Values>({
    resolver: zodResolver(productAgentModelSettingsSchema),
    defaultValues: {
      provider: settings.provider,
      model: settings.model,
      baseUrl: settings.baseUrl,
      headersJson: settings.headersJson,
      providerName: settings.providerName,
      organization: settings.organization,
      project: settings.project,
      apiKey: "",
      authToken: "",
      clearApiKey: false,
      clearAuthToken: false,
    },
  });

  function onSubmit(values: Values) {
    const formData = new FormData();
    for (const [name, value] of Object.entries(values)) formData.set(name, String(value));
    startTransition(() => formAction(formData));
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-6 p-4 md:p-6 lg:p-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <KeyRoundIcon aria-hidden="true" />
          <span>Agent 管理</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">模型提供商配置</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          配置会用于 Product Agent 的后续运行。API key 与 Auth token 只在服务端加密保存，保存后不会再显示。
        </p>
      </header>

      <Alert>
        <ShieldCheckIcon />
        <AlertTitle>运行边界不变</AlertTitle>
        <AlertDescription>更换模型不会放宽产品事实、证据绑定或 Gate 01 人工审核规则。</AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>连接设置</CardTitle>
          <CardDescription>
            当前来源：{settings.source === "database" ? "已保存的服务端配置" : "尚未配置"}。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form autoComplete="off" onSubmit={form.handleSubmit(onSubmit)}>
            <FieldGroup>
              <FieldSet>
                <FieldLegend>模型与端点</FieldLegend>
                <FieldDescription>官方端点可留空；OpenAI-compatible 必须提供端点。</FieldDescription>
                <FieldGroup className="grid gap-4 md:grid-cols-2">
                  <Field data-invalid={!!form.formState.errors.provider}>
                    <FieldLabel htmlFor="agent-provider">Provider</FieldLabel>
                    <Controller control={form.control} name="provider" render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="agent-provider" className="w-full" aria-invalid={!!form.formState.errors.provider}><SelectValue /></SelectTrigger>
                        <SelectContent><SelectGroup>
                          <SelectItem value="openai">OpenAI</SelectItem>
                          <SelectItem value="anthropic">Anthropic</SelectItem>
                          <SelectItem value="google">Google Gemini</SelectItem>
                          <SelectItem value="openai-compatible">OpenAI-compatible</SelectItem>
                        </SelectGroup></SelectContent>
                      </Select>
                    )} />
                    <FieldError errors={[form.formState.errors.provider]} />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.model}>
                    <FieldLabel htmlFor="agent-model">模型</FieldLabel>
                    <Input id="agent-model" aria-invalid={!!form.formState.errors.model} {...form.register("model")} />
                    <FieldError errors={[form.formState.errors.model]} />
                  </Field>
                  <Field className="md:col-span-2" data-invalid={!!form.formState.errors.baseUrl}>
                    <FieldLabel htmlFor="agent-base-url">Base URL</FieldLabel>
                    <Input id="agent-base-url" inputMode="url" placeholder="https://gateway.example.com/v1" aria-invalid={!!form.formState.errors.baseUrl} {...form.register("baseUrl")} />
                    <FieldError errors={[form.formState.errors.baseUrl]} />
                  </Field>
                </FieldGroup>
              </FieldSet>

              <FieldSet>
                <FieldLegend>认证</FieldLegend>
                <FieldDescription>留空会保留已有凭据；选择清除后，必须在保存前提供另一种可用认证方式。</FieldDescription>
                <FieldGroup className="grid gap-4 md:grid-cols-2">
                  <Field data-invalid={!!form.formState.errors.apiKey}>
                    <FieldLabel htmlFor="agent-api-key">API key {settings.apiKeyConfigured ? "（已配置）" : ""}</FieldLabel>
                    <Input id="agent-api-key" type="password" autoComplete="new-password" aria-invalid={!!form.formState.errors.apiKey} {...form.register("apiKey")} />
                    <FieldError errors={[form.formState.errors.apiKey]} />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.authToken}>
                    <FieldLabel htmlFor="agent-auth-token">Auth token {settings.authTokenConfigured ? "（已配置）" : ""}</FieldLabel>
                    <Input id="agent-auth-token" type="password" autoComplete="new-password" aria-invalid={!!form.formState.errors.authToken} {...form.register("authToken")} />
                    <FieldDescription>Anthropic 可使用 Bearer token 替代 API key。</FieldDescription>
                    <FieldError errors={[form.formState.errors.authToken]} />
                  </Field>
                  <Field orientation="horizontal">
                    <Controller control={form.control} name="clearApiKey" render={({ field }) => <Checkbox id="clear-api-key" checked={field.value} onCheckedChange={field.onChange} />} />
                    <FieldLabel htmlFor="clear-api-key">清除已保存的 API key</FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <Controller control={form.control} name="clearAuthToken" render={({ field }) => <Checkbox id="clear-auth-token" checked={field.value} onCheckedChange={field.onChange} />} />
                    <FieldLabel htmlFor="clear-auth-token">清除已保存的 Auth token</FieldLabel>
                  </Field>
                </FieldGroup>
              </FieldSet>

              <FieldSet>
                <FieldLegend>请求选项</FieldLegend>
                <FieldGroup className="grid gap-4 md:grid-cols-2">
                  <Field data-invalid={!!form.formState.errors.providerName}>
                    <FieldLabel htmlFor="agent-provider-name">Provider 名称</FieldLabel>
                    <Input id="agent-provider-name" aria-invalid={!!form.formState.errors.providerName} {...form.register("providerName")} />
                    <FieldDescription>第三方路由可覆盖 SDK 默认名称。</FieldDescription>
                    <FieldError errors={[form.formState.errors.providerName]} />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.organization}>
                    <FieldLabel htmlFor="agent-organization">OpenAI Organization</FieldLabel>
                    <Input id="agent-organization" aria-invalid={!!form.formState.errors.organization} {...form.register("organization")} />
                    <FieldError errors={[form.formState.errors.organization]} />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.project}>
                    <FieldLabel htmlFor="agent-project">OpenAI Project</FieldLabel>
                    <Input id="agent-project" aria-invalid={!!form.formState.errors.project} {...form.register("project")} />
                    <FieldError errors={[form.formState.errors.project]} />
                  </Field>
                  <Field className="md:col-span-2" data-invalid={!!form.formState.errors.headersJson}>
                    <FieldLabel htmlFor="agent-headers">自定义请求 Headers（JSON）</FieldLabel>
                    <Textarea id="agent-headers" rows={5} spellCheck={false} aria-invalid={!!form.formState.errors.headersJson} {...form.register("headersJson")} />
                    <FieldDescription>仅保存值为字符串的 JSON 对象；认证信息请使用上方的加密凭据字段。</FieldDescription>
                    <FieldError errors={[form.formState.errors.headersJson]} />
                  </Field>
                </FieldGroup>
              </FieldSet>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">{state.message}</p>
                <Button type="submit" disabled={pending}>
                  {pending ? <Spinner aria-hidden="true" data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
                  保存配置
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
