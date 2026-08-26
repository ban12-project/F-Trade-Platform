"use client";

import { useActionState, useEffect, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { MailPlusIcon, ShieldCheckIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { createInvitationAction, initialInvitationActionState } from "@/lib/actions/invitations";
import { invitationFormSchema } from "@/lib/form-schemas";

export function InvitationPanel() {
  const [state, formAction, pending] = useActionState(createInvitationAction, initialInvitationActionState);
  const [, startTransition] = useTransition();
  const form = useForm<z.infer<typeof invitationFormSchema>>({
    resolver: zodResolver(invitationFormSchema),
    defaultValues: { email: "" },
  });

  useEffect(() => {
    if (state.status === "success") form.reset();
  }, [form, state.status]);

  function onSubmit(values: z.infer<typeof invitationFormSchema>) {
    const formData = new FormData();
    formData.set("email", values.email);
    startTransition(() => formAction(formData));
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-6 p-4 md:p-6 lg:p-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><MailPlusIcon aria-hidden="true" /><span>团队管理</span></div>
        <h1 className="text-3xl font-semibold tracking-tight">邀请用户</h1>
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">仅管理员可发放单次、限时邀请。受邀人验证邮箱后账户才会激活。</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>发放受邀访问</CardTitle>
          <CardDescription>邀请链接只用于初始化账户，不会开放公开注册。</CardDescription>
        </CardHeader>
        <CardContent>
          <form autoComplete="off" onSubmit={form.handleSubmit(onSubmit)}>
            <FieldGroup>
              <Field data-invalid={!!form.formState.errors.email}>
                <FieldLabel htmlFor="invite-email">受邀邮箱</FieldLabel>
                <Input id="invite-email" type="email" autoComplete="email" spellCheck={false} placeholder="name@example.com…" aria-invalid={!!form.formState.errors.email} {...form.register("email")} />
                <FieldError errors={[form.formState.errors.email]} />
              </Field>
              <Button type="submit" disabled={pending}>{pending && <Spinner aria-hidden="true" data-icon="inline-start" />}发送邀请</Button>
            </FieldGroup>
          </form>
          <div className="mt-5 flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">
            <ShieldCheckIcon aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>仅发送邀请，不会在此处暴露真实用户资料或生成业务数据。</span>
          </div>
          <p className="mt-4 min-h-5 text-sm text-muted-foreground" aria-live="polite">{state.message}</p>
        </CardContent>
      </Card>
    </div>
  );
}
