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
import { reconcileVideoPublicationAction } from "@/lib/actions/publication-reconciliation";
import { videoPublicationReconciliationSchema } from "@/lib/social/publication-reconciliation-schema";

export function VideoPublicationReconciliationForm({
  projectId,
  publicationId,
}: {
  projectId: string;
  publicationId: string;
}) {
  const router = useRouter();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const form = useForm<z.infer<typeof videoPublicationReconciliationSchema>>({
    resolver: zodResolver(videoPublicationReconciliationSchema),
    defaultValues: {
      projectId,
      publicationId,
      externalPublicationRef: "",
      evidenceRef: "",
      confirmed: false,
    },
  });
  const pending = form.formState.isSubmitting;
  async function submit(value: z.infer<typeof videoPublicationReconciliationSchema>) {
    try {
      const saved = await reconcileVideoPublicationAction(value);
      setResult(saved);
      if (saved.ok) router.refresh();
    } catch {
      setResult({ ok: false, message: "未收到确认响应。请刷新核对记录；不要再次发布视频。" });
    }
  }
  return (
    <form onSubmit={form.handleSubmit(submit)}>
      <FieldGroup>
        <FieldDescription>
          仅节点所有者可确认。先在 Facebook 核对原账号、视频画面、受众和 Reel
          链接。此确认属于人工核对，不会改变原 unknown 回执、恢复渠道或重新发布。
        </FieldDescription>
        <Field data-invalid={!!form.formState.errors.externalPublicationRef}>
          <FieldLabel htmlFor={`video-receipt-url-${publicationId}`}>已发布 Reel 的链接</FieldLabel>
          <Input
            id={`video-receipt-url-${publicationId}`}
            type="url"
            autoComplete="off"
            {...form.register("externalPublicationRef")}
            aria-invalid={!!form.formState.errors.externalPublicationRef}
            disabled={pending}
          />
          <FieldError errors={[form.formState.errors.externalPublicationRef]} />
        </Field>
        <Field data-invalid={!!form.formState.errors.evidenceRef}>
          <FieldLabel htmlFor={`video-receipt-evidence-${publicationId}`}>
            私有核对依据编号
          </FieldLabel>
          <Input
            id={`video-receipt-evidence-${publicationId}`}
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
                  id={`video-receipt-confirm-${publicationId}`}
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  aria-invalid={fieldState.invalid}
                  disabled={pending}
                />
                <FieldLabel htmlFor={`video-receipt-confirm-${publicationId}`}>
                  我已核对原账号、视频画面、仅自己可见的受众和 Reel 链接，确认这是原任务的发布结果。
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
