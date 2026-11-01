"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
import type { PublicationChannel } from "@/lib/social/publication-store";
import { workspaceRecordHref } from "@/lib/workspace/navigation";
import { useWorkspaceDirty } from "./dirty-state";
import { PublishingAccountSelect, publishingAccountKey } from "./publishing-account-select";
import { WorkspaceLink } from "./workspace-link";

export function FacebookMediaPanel({
  projectId,
  contentRef,
  options,
  channelRef,
  accountRef,
  accounts = [],
}: {
  projectId: string;
  contentRef: string;
  options: Awaited<ReturnType<typeof listFacebookMediaOptions>>;
  channelRef: string;
  accountRef: string;
  accounts?: PublicationChannel[];
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
  const targetChannel = form.watch("channelRef");
  const targetAccount = form.watch("accountRef");
  const target = accounts.find(
    (a) => a.channelRef === targetChannel && a.accountRef === targetAccount,
  );
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(`publication-media:${contentRef}`) ?? "null");
      if (!saved) return;
      const target = accounts.find(
        (a) => a.accountRef === saved.accountRef && a.channelRef === saved.channelRef,
      );
      const media = options.find(
        (a) => a.mediaId === saved.mediaId && a.captionContentRef === saved.captionContentRef,
      );
      if (target) {
        form.setValue("accountRef", target.accountRef);
        form.setValue("channelRef", target.channelRef);
      }
      if (media) {
        form.setValue("mediaId", media.mediaId);
        form.setValue("captionContentRef", media.captionContentRef);
        form.setValue("contentVersion", media.contentVersion);
        form.setValue("previewDigest", media.previewDigest);
      }
    } catch {
      /* Optional draft selection, never an authorization. */
    }
  }, [accounts, options, contentRef, form]);
  function rememberSelection() {
    const { accountRef, channelRef, mediaId, captionContentRef } = form.getValues();
    try {
      sessionStorage.setItem(
        `publication-media:${contentRef}`,
        JSON.stringify({ accountRef, channelRef, mediaId, captionContentRef }),
      );
    } catch {}
  }
  const mediaId = form.watch("mediaId");
  const captionContentRef = form.watch("captionContentRef");
  const selected = options.find(
    (option) => option.mediaId === mediaId && option.captionContentRef === captionContentRef,
  );
  const optionKey = (option: (typeof options)[number]) =>
    option.captionContentRef ? `${option.mediaId}:${option.captionContentRef}` : option.mediaId;
  const previewUrl = selected
    ? `/api/publication-preview?${new URLSearchParams({ projectId, contentRef, format: selected.format, mediaId: selected.mediaId, ...(selected.captionContentRef ? { captionContentRef: selected.captionContentRef } : {}) })}`
    : "";
  const [previewFailed, setPreviewFailed] = useState(false);
  const disabled = !form.formState.isReady || busy || !!publicationId || uncertain;
  useWorkspaceDirty(`media-publication:${contentRef}`, form.formState.isDirty && !publicationId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>发布当前{format === "video" ? "视频" : "图文"}</CardTitle>
        <CardDescription>
          人工确认仅授权当前版本和所选素材，发布到目标账号的帖子页面；可见范围以平台设置为准。
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
            <FieldLabel htmlFor={`target-${contentRef}`}>发布账号</FieldLabel>
            <PublishingAccountSelect
              id={`target-${contentRef}`}
              accounts={accounts}
              value={publishingAccountKey({ channelRef: targetChannel, accountRef: targetAccount })}
              disabled={disabled}
              onChange={(account) => {
                form.setValue("channelRef", account.channelRef, { shouldDirty: true });
                form.setValue("accountRef", account.accountRef, { shouldDirty: true });
                form.setValue("confirm", false);
                rememberSelection();
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`media-${contentRef}`}>当前内容的已审核素材</FieldLabel>
            <Controller
              control={form.control}
              name="mediaId"
              render={({ field }) => (
                <NativeSelect
                  id={`media-${contentRef}`}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  value={selected ? optionKey(selected) : ""}
                  disabled={disabled}
                  onChange={(event) => {
                    const option = options.find((item) => optionKey(item) === event.target.value);
                    field.onChange(option?.mediaId ?? "");
                    setPreviewFailed(false);
                    form.setValue("captionContentRef", option?.captionContentRef, {
                      shouldDirty: true,
                    });
                    form.setValue("confirm", false, { shouldDirty: true });
                    if (option) {
                      form.setValue("contentVersion", option.contentVersion);
                      form.setValue("previewDigest", option.previewDigest);
                    }
                    rememberSelection();
                  }}
                >
                  <NativeSelectOption value="">请选择素材</NativeSelectOption>
                  {options.map((option) => (
                    <NativeSelectOption key={optionKey(option)} value={optionKey(option)}>
                      {option.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            />
            <FieldError errors={[form.formState.errors.mediaId]} />
          </Field>
          {selected ? (
            <Alert>
              <AlertTitle>发布内容</AlertTitle>
              <AlertDescription className="whitespace-pre-wrap">
                {selected.preview}
                <span className="block break-all">
                  素材：{selected.label} · 内容版本：{selected.contentVersion}
                </span>
              </AlertDescription>
            </Alert>
          ) : null}
          {selected &&
            (previewFailed ? (
              <p role="alert">素材预览未能加载，请返回内容核对素材后再确认发布。</p>
            ) : selected.format === "video" ? (
              <video
                key={previewUrl}
                controls
                preload="metadata"
                className="max-h-80 w-full"
                src={previewUrl}
                onError={() => setPreviewFailed(true)}
              >
                <track kind="captions" />
              </video>
            ) : (
              <img
                className="max-h-80 max-w-full object-contain"
                src={previewUrl}
                alt="本次发布的已审核图片"
                onError={() => setPreviewFailed(true)}
              />
            ))}
          <Field orientation="horizontal">
            <Controller
              control={form.control}
              name="confirm"
              render={({ field }) => (
                <Checkbox
                  id={`confirm-${contentRef}`}
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={disabled}
                />
              )}
            />
            <FieldLabel htmlFor={`confirm-${contentRef}`}>
              已核对当前内容、素材权利及目标账户，确认本次发布。
            </FieldLabel>
            <FieldError errors={[form.formState.errors.confirm]} />
          </Field>
          <Button
            type="submit"
            disabled={disabled || previewFailed || !options.length || !target?.ready}
          >
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
