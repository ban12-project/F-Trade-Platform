"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { reconcilePublicationAction } from "@/lib/actions/publication-reconciliation";
import { publicationReconciliationSchema } from "@/lib/social/publication-reconciliation-schema";

export function PublicationReconciliationForm({
  projectId,
  publicationId,
}: {
  projectId: string;
  publicationId: string;
}) {
  const router = useRouter();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const form = useForm<z.infer<typeof publicationReconciliationSchema>>({
    resolver: zodResolver(publicationReconciliationSchema),
    defaultValues: {
      projectId,
      publicationId,
      externalPublicationRef: "",
      evidenceRef: "",
      confirmed: false,
    },
  });
  const pending = form.formState.isSubmitting;
  async function submit(value: z.infer<typeof publicationReconciliationSchema>) {
    try {
      const saved = await reconcilePublicationAction(value);
      setResult(saved);
      if (saved.ok) router.refresh();
    } catch {
      setResult({ ok: false, message: "未收到确认响应。请刷新核对记录；不要再次发布帖子。" });
    }
  }
  return (
    <form onSubmit={form.handleSubmit(submit)}>
      <FieldGroup>
        <FieldDescription>
          仅节点所有者可确认。先在 Facebook
          核对原账号、完整文案和受众，再填写已存在帖子的正式链接。核对不会恢复渠道或重新发帖。
        </FieldDescription>
        <Field data-invalid={!!form.formState.errors.externalPublicationRef}>
          <FieldLabel htmlFor={`receipt-url-${publicationId}`}>已发布帖子的链接</FieldLabel>
          <Input
            id={`receipt-url-${publicationId}`}
            type="url"
            autoComplete="off"
            {...form.register("externalPublicationRef")}
            aria-invalid={!!form.formState.errors.externalPublicationRef}
            disabled={pending}
          />
          <FieldError errors={[form.formState.errors.externalPublicationRef]} />
        </Field>
        <Field data-invalid={!!form.formState.errors.evidenceRef}>
          <FieldLabel htmlFor={`receipt-evidence-${publicationId}`}>私有核对依据编号</FieldLabel>
          <Input
            id={`receipt-evidence-${publicationId}`}
            placeholder="evidence-…"
            autoComplete="off"
            {...form.register("evidenceRef")}
            aria-invalid={!!form.formState.errors.evidenceRef}
            disabled={pending}
          />
          <FieldError errors={[form.formState.errors.evidenceRef]} />
        </Field>
        <Controller
          control={form.control}
          name="confirmed"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <Field orientation="horizontal">
                <Checkbox
                  id={`receipt-confirm-${publicationId}`}
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  aria-invalid={fieldState.invalid}
                  disabled={pending}
                />
                <FieldLabel htmlFor={`receipt-confirm-${publicationId}`}>
                  我已核对账号、完整文案、受众和帖子链接，确认这是原任务的发布结果。
                </FieldLabel>
              </Field>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Button type="submit" variant="outline" disabled={pending || result?.ok}>
          {pending ? <Spinner data-icon="inline-start" /> : null}确认已发布结果
        </Button>
        {result ? (
          <Alert variant={result.ok ? "default" : "destructive"}>
            <AlertTitle>{result.ok ? "已确认" : "需要核对"}</AlertTitle>
            <AlertDescription>{result.message}</AlertDescription>
          </Alert>
        ) : null}
      </FieldGroup>
    </form>
  );
}
