"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { SendIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { PublicationReconciliationForm } from "@/components/workspace/publication-reconciliation-form";
import { VideoPublicationReconciliationForm } from "@/components/workspace/video-publication-reconciliation-form";
import { initialClosingActionState } from "@/lib/action-states";
import { confirmPublicationAction } from "@/lib/actions/closing";
import { publicationConfirmationFormSchema } from "@/lib/form-schemas";
import { publicationProgress } from "@/lib/social/publication-presentation";
import type {
  PublicationCandidate,
  PublicationChannel,
  PublicationEntry,
} from "@/lib/social/publication-store";
import { workspaceRecordHref } from "@/lib/workspace/navigation";
import { useWorkspaceDirty } from "./dirty-state";
import { SubmissionFeedback as Message } from "./submission-feedback";
import { WorkspaceLink } from "./workspace-link";
export function PublicationPanel({
  projectId,
  candidates,
  channels,
  publications,
}: {
  projectId: string;
  candidates: PublicationCandidate[];
  channels: PublicationChannel[];
  publications: PublicationEntry[];
}) {
  const router = useRouter();
  const textCandidates = candidates.filter((candidate) => candidate.format === "text");
  const current = textCandidates.length === 1 ? textCandidates[0] : undefined;
  const [state, action, pending] = useActionState(
    confirmPublicationAction,
    initialClosingActionState,
  );
  const form = useForm<z.infer<typeof publicationConfirmationFormSchema>>({
    resolver: zodResolver(publicationConfirmationFormSchema),
    defaultValues: {
      projectId,
      previewDigest: current?.previewDigest ?? "",
      contentRef: current?.id ?? "",
      format: current?.format ?? "text",
      channelRef: channels[0]?.channelRef ?? "",
      accountRef: channels[0]?.accountRef ?? "",
      confirmationRef: "",
    },
  });
  useWorkspaceDirty(
    `publication-${projectId}`,
    form.formState.isDirty && state.status !== "success",
  );
  const selected = current;
  const [channelKey, setChannelKey] = useState(
    channels[0] ? `${channels[0].channelRef}\u001f${channels[0].accountRef}` : "",
  );
  useEffect(() => {
    if (state.status === "success") {
      form.reset(form.getValues());
      router.refresh();
    }
  }, [form, router, state]);
  useEffect(() => {
    form.setValue("contentRef", current?.id ?? "");
    form.setValue("format", current?.format ?? "text");
    form.setValue("previewDigest", current?.previewDigest ?? "");
    form.setValue("confirmationRef", "");
  }, [form, current?.id, current?.format, current?.previewDigest]);
  function submit(value: z.infer<typeof publicationConfirmationFormSchema>) {
    if (!selected) return;
    const data = new FormData();
    for (const [key, item] of Object.entries(value)) data.set(key, item);
    data.set("previewDigest", selected.previewDigest);
    startTransition(() => action(data));
  }
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">受控发布</Badge>
          <Badge variant="outline">逐帖人工确认</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          人工确认只提交一次发布任务；平台回执前不会显示为已发布，未知或失败结果会暂停渠道且不自动重试。
        </p>
      </div>
      {publications.map((item) => {
        const progress = publicationProgress(item.status, item.humanConfirmed);
        return (
          <Card key={item.id}>
            <CardHeader>
              <CardTitle>{progress.label}</CardTitle>
              <CardDescription>
                {item.channelRef} · {item.accountRef}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <p className="text-sm">{progress.detail}</p>
              {item.status === "unknown" && item.format === "text" ? (
                <PublicationReconciliationForm projectId={projectId} publicationId={item.id} />
              ) : null}
              {item.status === "unknown" && item.format === "video" ? (
                <VideoPublicationReconciliationForm projectId={projectId} publicationId={item.id} />
              ) : null}
              {item.externalPublicationRef ? (
                <p className="break-all text-sm">发布凭证：{item.externalPublicationRef}</p>
              ) : null}
            </CardContent>
            <CardFooter>
              <WorkspaceLink
                href={workspaceRecordHref(
                  projectId,
                  item.format === "video" ? "video" : "content",
                  item.contentRef,
                )}
                className={buttonVariants({ variant: "outline" })}
              >
                查看发布内容
              </WorkspaceLink>
            </CardFooter>
          </Card>
        );
      })}
      {current ? (
        <Card>
          <CardHeader>
            <CardTitle>确认并提交发布</CardTitle>
            <CardDescription>
              核对最终载荷、渠道与账户。本次确认只授权这一条内容，不会授权后续自动发布。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!channels.length ? (
              <Alert className="mb-4">
                <AlertTitle>等待渠道管理员启用发布</AlertTitle>
                <AlertDescription>
                  当前没有可用渠道，请由管理员在账号与管理中核对授权和渠道状态。
                </AlertDescription>
              </Alert>
            ) : null}
            <form id="publication-confirmation" onSubmit={form.handleSubmit(submit)}>
              <FieldGroup>
                <Field data-invalid={!!form.formState.errors.contentRef}>
                  <FieldLabel htmlFor="publication-content">已批准文字内容</FieldLabel>
                  <p id="publication-content" className="font-medium">
                    {current.title}
                  </p>
                  <FieldError errors={[form.formState.errors.contentRef]} />
                </Field>
                {selected ? (
                  <Alert>
                    <AlertTitle>最终载荷预览</AlertTitle>
                    <AlertDescription>{selected.preview}</AlertDescription>
                  </Alert>
                ) : null}
                <Field>
                  <FieldLabel htmlFor="publication-channel">已启用渠道</FieldLabel>
                  <Select
                    items={Object.fromEntries(
                      channels.map((item) => [
                        `${item.channelRef}\u001f${item.accountRef}`,
                        `${item.channelRef} · ${item.accountRef}`,
                      ]),
                    )}
                    value={channelKey}
                    onValueChange={(value) => {
                      if (!value) return;
                      const channel = channels.find(
                        (item) => `${item.channelRef}\u001f${item.accountRef}` === value,
                      );
                      setChannelKey(value);
                      form.setValue("confirmationRef", "");
                      if (channel) {
                        form.setValue("channelRef", channel.channelRef);
                        form.setValue("accountRef", channel.accountRef);
                      }
                    }}
                  >
                    <SelectTrigger id="publication-channel" className="w-full">
                      <SelectValue placeholder="没有已启用渠道" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {channels.map((item) => {
                          const key = `${item.channelRef}\u001f${item.accountRef}`;
                          return (
                            <SelectItem key={key} value={key}>
                              {item.channelRef} · {item.accountRef}
                            </SelectItem>
                          );
                        })}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field data-invalid={!!form.formState.errors.confirmationRef}>
                  <FieldLabel htmlFor="publication-confirmation-ref">逐帖人工确认凭据</FieldLabel>
                  <Input
                    id="publication-confirmation-ref"
                    aria-invalid={!!form.formState.errors.confirmationRef}
                    {...form.register("confirmationRef")}
                  />
                  <FieldError errors={[form.formState.errors.confirmationRef]} />
                  <FieldDescription>
                    使用脱敏引用；重复提交同一凭据只会返回原任务。
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-3">
            <Button
              form="publication-confirmation"
              type="submit"
              disabled={pending || !candidates.length || !channels.length}
            >
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <SendIcon data-icon="inline-start" />
              )}
              确认并提交此条发布
            </Button>
            <Message {...state} />
          </CardFooter>
        </Card>
      ) : !publications.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {candidates.some((candidate) => candidate.format === "video")
                ? "视频请使用素材发布"
                : "尚无可发布内容"}
            </EmptyTitle>
            <EmptyDescription>
              {candidates.some((candidate) => candidate.format === "video")
                ? "请在素材发布区域核对已批准成片与目标账户。该区域由账号拥有者使用；未显示时请先核对渠道连接。"
                : "完成当前内容的人工审核后，再核对渠道与最终文案并确认发布。"}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
    </div>
  );
}
