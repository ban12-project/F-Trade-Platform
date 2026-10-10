"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { startTransition, useActionState, useId } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  type MarketingVideoActionState,
  registerVideoReviewWorkingEvidenceAction,
} from "@/lib/actions/marketing-video";
import {
  type VideoReviewEvidenceCopy,
  videoReviewWorkingEvidenceFormSchema,
} from "@/lib/video/review-evidence-contracts";

function EvidenceCopyForm({
  projectId,
  videoId,
  copy,
}: {
  projectId: string;
  videoId: string;
  copy: VideoReviewEvidenceCopy;
}) {
  const id = useId();
  const [state, submit, pending] = useActionState(
    async (
      _previous: MarketingVideoActionState,
      input: z.infer<typeof videoReviewWorkingEvidenceFormSchema>,
    ) => registerVideoReviewWorkingEvidenceAction(input),
    { status: "idle", message: "" } as MarketingVideoActionState,
  );
  const form = useForm<z.infer<typeof videoReviewWorkingEvidenceFormSchema>>({
    resolver: zodResolver(videoReviewWorkingEvidenceFormSchema),
    defaultValues: { projectId, videoId, evidenceRef: copy.evidenceRef, workingCopyOnly: false },
  });
  if (copy.registered)
    return (
      <FieldGroup>
        <FieldLabel>{copy.label}</FieldLabel>
        <Badge variant="secondary">已登记工作副本</Badge>
        <FieldDescription>
          截止时间：{copy.expiresAt}。原始时间保持，读取和再次登记不续期。
        </FieldDescription>
      </FieldGroup>
    );
  if (!copy.canRegister)
    return (
      <FieldGroup>
        <FieldLabel>{copy.label}</FieldLabel>
        <FieldDescription>
          请使用自己上传、只用于本视频审核的附件。已有事实或权利用途的附件继续保留来源保护。
        </FieldDescription>
      </FieldGroup>
    );
  return (
    <form onSubmit={form.handleSubmit((value) => startTransition(() => submit(value)))}>
      <FieldGroup>
        <FieldLabel>{copy.label}</FieldLabel>
        <Field orientation="horizontal" data-invalid={!!form.formState.errors.workingCopyOnly}>
          <Controller
            control={form.control}
            name="workingCopyOnly"
            render={({ field }) => (
              <Checkbox
                id={id}
                checked={field.value}
                onCheckedChange={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                disabled={pending}
                aria-invalid={!!form.formState.errors.workingCopyOnly}
              />
            )}
          />
          <FieldLabel htmlFor={id}>
            这份附件是本视频的审核工作副本，不是工厂原件或长期事实／权利来源。
          </FieldLabel>
        </Field>
        <FieldError errors={[form.formState.errors.workingCopyOnly]} />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "正在登记…" : "登记审核工作副本"}
        </Button>
        {state.message ? <p role="status">{state.message}</p> : null}
      </FieldGroup>
    </form>
  );
}
export function VideoReviewEvidenceCopies({
  projectId,
  videoId,
  copies,
}: {
  projectId: string;
  videoId: string;
  copies: VideoReviewEvidenceCopy[];
}) {
  if (!copies.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>审核附件保留</CardTitle>
        <CardDescription>
          含剪辑参数或处理内容的审核附件应登记为工作副本。工厂原件、事实和授权来源继续保留。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {copies.map((copy) => (
          <EvidenceCopyForm
            key={copy.evidenceRef}
            projectId={projectId}
            videoId={videoId}
            copy={copy}
          />
        ))}
      </CardContent>
      <CardFooter>
        <FieldDescription>
          工作副本仅用于所属视频审核，按附件和原视频的最早截止时间执行 90 天保留。
        </FieldDescription>
      </CardFooter>
    </Card>
  );
}
