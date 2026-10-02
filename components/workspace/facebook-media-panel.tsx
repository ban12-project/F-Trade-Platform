"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { submitFacebookMediaAction } from "@/lib/actions/facebook-media";
import {
  facebookMediaFormSchema,
  facebookMediaSubmitFormSchema,
} from "@/lib/social/facebook-account-forms";
import type { listFacebookMediaOptions } from "@/lib/social/facebook-media-store";
import { workspaceRecordHref } from "@/lib/workspace/navigation";
import { useWorkspaceDirty } from "./dirty-state";
import { WorkspaceLink } from "./workspace-link";

export function FacebookMediaPanel({
  projectId,
  contentRef,
  options,
  channelRef,
  accountRef,
}: {
  projectId: string;
  contentRef: string;
  options: Awaited<ReturnType<typeof listFacebookMediaOptions>>;
  channelRef: string;
  accountRef: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [message, setMessage] = useState("");
  const [publicationId, setPublicationId] = useState<string>();
  const [uncertain, setUncertain] = useState(false);
  const format = options[0]?.format ?? "image";
  const form = useForm<z.infer<typeof facebookMediaFormSchema>>({
    resolver: zodResolver(facebookMediaFormSchema),
    defaultValues: {
      projectId,
      contentRef,
      format,
      mediaId: "",
      confirm: false,
      contentVersion: options[0]?.contentVersion ?? 1,
      previewDigest: options[0]?.previewDigest ?? "",
      channelRef,
      accountRef,
    },
  });
  const selected = options.find((option) => option.mediaId === form.watch("mediaId"));
  useWorkspaceDirty(`media-publication:${contentRef}`, form.formState.isDirty && !publicationId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>发布当前{format === "video" ? "视频" : "图文"}</CardTitle>
        <CardDescription>
          渠道：{channelRef} · 账户：{accountRef}。人工确认仅授权当前内容。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(async (values) => {
            if (submitting.current || uncertain || publicationId || !selected) return;
            submitting.current = true;
            setBusy(true);
            try {
              const result = await submitFacebookMediaAction(
                facebookMediaSubmitFormSchema.parse({ ...values, confirm: true }),
              );
              if (result.ok) {
                setPublicationId(result.publicationId);
                setMessage("已提交发布任务，等待真实平台回执。");
                form.reset({ ...values, confirm: false });
                router.refresh();
              } else setMessage(result.message);
            } catch {
              setUncertain(true);
              setMessage("提交结果待核对。请检查发布记录，避免重复提交。");
            } finally {
              submitting.current = false;
              setBusy(false);
            }
          })}
        >
          <Field>
            <FieldLabel htmlFor={`media-${contentRef}`}>当前内容的已审核素材</FieldLabel>
            <NativeSelect
              id={`media-${contentRef}`}
              disabled={busy || !!publicationId || uncertain}
              {...form.register("mediaId", {
                onChange: (event) => {
                  form.setValue("confirm", false);
                  const option = options.find((item) => item.mediaId === event.target.value);
                  if (option) {
                    form.setValue("contentVersion", option.contentVersion);
                    form.setValue("previewDigest", option.previewDigest);
                  }
                },
              })}
            >
              <NativeSelectOption value="">请选择素材</NativeSelectOption>
              {options.map((option) => (
                <NativeSelectOption key={option.mediaId} value={option.mediaId}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldError errors={[form.formState.errors.mediaId]} />
          </Field>
          {selected ? (
            <Alert>
              <AlertTitle>最终载荷</AlertTitle>
              <AlertDescription className="whitespace-pre-wrap">
                {selected.preview}
                <span className="block break-all">素材：{selected.mediaId}</span>
              </AlertDescription>
            </Alert>
          ) : null}
          <Field orientation="horizontal">
            <Controller
              control={form.control}
              name="confirm"
              render={({ field }) => (
                <Checkbox
                  id={`confirm-${contentRef}`}
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={busy || !!publicationId || uncertain}
                />
              )}
            />
            <FieldLabel htmlFor={`confirm-${contentRef}`}>
              已核对当前内容、素材权利及目标账户，确认本次发布。
            </FieldLabel>
            <FieldError errors={[form.formState.errors.confirm]} />
          </Field>
          <Button type="submit" disabled={busy || !options.length || !!publicationId || uncertain}>
            {busy ? "提交中…" : "确认并提交素材发布"}
          </Button>
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
          {publicationId ? (
            <WorkspaceLink
              href={workspaceRecordHref(projectId, "publication", publicationId)}
              className="underline"
            >
              查看发布记录与回执
            </WorkspaceLink>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
