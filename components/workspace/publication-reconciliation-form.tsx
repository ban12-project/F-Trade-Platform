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
import { EvidenceSelectField } from "./evidence-select";

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
          仅账号管理员可确认。先在 Facebook
          核对原账号、完整文案、图片（如有）和公开范围，再填写已存在帖子的正式链接。核对不会恢复发布或重新发帖。若没有找到对应帖子，请保留暂停状态并联系管理员进一步检查，不能直接重发。
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
          <FieldLabel htmlFor={`receipt-evidence-${publicationId}`}>发布结果核对依据</FieldLabel>
          <EvidenceSelectField
            projectId={projectId}
            control={form.control}
            name="evidenceRef"
            id={`receipt-evidence-${publicationId}`}
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
                  我已核对账号、完整文案、图片（如有）、公开范围和帖子链接，确认这是原任务的发布结果。
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
