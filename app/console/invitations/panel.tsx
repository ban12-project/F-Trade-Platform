"use client";

import { useActionState, useEffect, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1>邀请用户</h1>
        <p>仅管理员可发放单次、限时邀请。受邀人验证邮箱后账户才会激活。</p>
      </div>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <FieldGroup>
          <Field data-invalid={!!form.formState.errors.email}>
            <FieldLabel htmlFor="invite-email">受邀邮箱</FieldLabel>
            <Input id="invite-email" type="email" aria-invalid={!!form.formState.errors.email} {...form.register("email")} />
            <FieldError errors={[form.formState.errors.email]} />
          </Field>
          <Button type="submit" disabled={pending}>发送邀请</Button>
        </FieldGroup>
      </form>
      <p aria-live="polite">{state.message}</p>
    </main>
  );
}
