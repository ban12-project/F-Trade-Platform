"use client";

import { useActionState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ShieldAlertIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { initialSocialControlActionState, saveSocialChannelControlAction } from "@/lib/actions/social-controls";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const formSchema = z.object({
  channelRef: z.string().trim().min(1, "需要渠道引用。"), accountRef: z.string().trim().min(1, "需要账户引用。"),
  action: z.enum(["enable", "pause", "resume"]), evidenceRef: z.string().trim().min(1, "需要脱敏证据引用。"),
});
type Values = z.infer<typeof formSchema>;

export function SocialControlPanel() {
  const [state, action, pending] = useActionState(saveSocialChannelControlAction, initialSocialControlActionState);
  const [, startTransition] = useTransition();
  const form = useForm<Values>({ resolver: zodResolver(formSchema), defaultValues: { channelRef: "", accountRef: "", action: "pause", evidenceRef: "" } });
  function submit(values: Values) {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    startTransition(() => action(data));
  }
  return <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-6 lg:p-8">
    <header><h1 className="text-3xl font-semibold tracking-tight">社交渠道控制</h1><p className="mt-2 text-sm text-muted-foreground">默认关闭。所有操作均需管理员身份与脱敏证据引用。</p></header>
    <Alert variant="destructive"><ShieldAlertIcon /><AlertTitle>失败闭合</AlertTitle><AlertDescription>遇到安全检查、验证码、2FA、登录失效或不确定结果时，请暂停渠道；不要自动重试。</AlertDescription></Alert>
    <Card><CardHeader><CardTitle>渠道操作</CardTitle><CardDescription>启用或恢复不会绕过 Gate 01 与逐帖人工确认。</CardDescription></CardHeader><CardContent>
      <form onSubmit={form.handleSubmit(submit)}><FieldGroup>
        <Field data-invalid={!!form.formState.errors.channelRef}><FieldLabel htmlFor="channel-ref">渠道引用</FieldLabel><Input id="channel-ref" {...form.register("channelRef")} /><FieldError errors={[form.formState.errors.channelRef]} /></Field>
        <Field data-invalid={!!form.formState.errors.accountRef}><FieldLabel htmlFor="account-ref">账户引用</FieldLabel><Input id="account-ref" {...form.register("accountRef")} /><FieldError errors={[form.formState.errors.accountRef]} /></Field>
        <Field data-invalid={!!form.formState.errors.action}><FieldLabel>操作</FieldLabel><Select value={form.watch("action")} onValueChange={(value) => form.setValue("action", value as Values["action"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="enable">启用</SelectItem><SelectItem value="pause">暂停</SelectItem><SelectItem value="resume">人工恢复</SelectItem></SelectContent></Select><FieldError errors={[form.formState.errors.action]} /></Field>
        <Field data-invalid={!!form.formState.errors.evidenceRef}><FieldLabel htmlFor="evidence-ref">脱敏证据引用</FieldLabel><Input id="evidence-ref" {...form.register("evidenceRef")} /><FieldError errors={[form.formState.errors.evidenceRef]} /></Field>
        <div className="flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground" aria-live="polite">{state.message}</p><Button type="submit" disabled={pending}>{pending ? "保存中…" : "保存控制状态"}</Button></div>
      </FieldGroup></form>
    </CardContent></Card>
  </div>;
}
