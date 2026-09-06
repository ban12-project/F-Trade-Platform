"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  facebookMarketingProjectsAction,
  facebookMediaOptionsAction,
  submitFacebookMediaAction,
} from "@/lib/actions/facebook-media";

const selectionSchema = z.object({
  projectId: z.uuid(),
  choice: z.string().min(1),
  confirm: z.boolean().refine((value) => value, "请确认本次发布。"),
});

type MediaOption = Awaited<ReturnType<typeof facebookMediaOptionsAction>>[number];

export function FacebookMediaPanel() {
  const [projects, setProjects] = useState<
    Awaited<ReturnType<typeof facebookMarketingProjectsAction>>
  >([]);
  const [options, setOptions] = useState<MediaOption[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useForm<z.infer<typeof selectionSchema>>({
    resolver: zodResolver(selectionSchema),
    defaultValues: { projectId: "", choice: "", confirm: false },
  });
  const projectId = form.watch("projectId");

  useEffect(() => {
    void facebookMarketingProjectsAction()
      .then(setProjects)
      .catch(() => setMessage("无法读取营销项目。"));
  }, []);

  useEffect(() => {
    let disposed = false;
    setOptions([]);
    form.setValue("choice", "");
    form.setValue("confirm", false);
    if (projectId) {
      void facebookMediaOptionsAction(projectId)
        .then((rows) => {
          if (!disposed) setOptions(rows);
        })
        .catch(() => {
          if (!disposed) setMessage("无法读取已审核素材。");
        });
    }
    return () => {
      disposed = true;
    };
  }, [projectId, form]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>发布图片 / 视频</CardTitle>
        <CardDescription>
          单张 JPEG / PNG 配已审核文案，或一条已审核 MP4 成片。不接收任意外部素材 URL，不生成新视频。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(async (values) => {
            const option = options.find(
              (item) => `${item.contentRef}:${item.mediaId}` === values.choice,
            );
            if (!option) return;
            setBusy(true);
            try {
              const result = await submitFacebookMediaAction({
                projectId: values.projectId,
                contentRef: option.contentRef,
                format: option.format,
                mediaId: option.mediaId,
                confirm: true,
              });
              setMessage(
                result.ok
                  ? `已提交发布任务 ${result.publicationId}，等待 Worker 返回真实发布结果。`
                  : result.message,
              );
              form.setValue("confirm", false);
            } catch {
              setMessage("提交未完成，请先核对任务记录，避免重复创建发布。");
            } finally {
              setBusy(false);
            }
          })}
        >
          <Field>
            <FieldLabel>营销项目</FieldLabel>
            <Controller
              control={form.control}
              name="projectId"
              render={({ field }) => (
                <Select
                  items={Object.fromEntries(projects.map((project) => [project.id, project.title]))}
                  value={field.value}
                  onValueChange={(value) => field.onChange(value ?? "")}
                  disabled={busy}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[form.formState.errors.projectId]} />
          </Field>
          <Field>
            <FieldLabel>已审核的素材与内容</FieldLabel>
            <Controller
              control={form.control}
              name="choice"
              render={({ field }) => (
                <Select
                  items={Object.fromEntries(
                    options.map((option) => [
                      `${option.contentRef}:${option.mediaId}`,
                      option.label,
                    ]),
                  )}
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value ?? "");
                    form.setValue("confirm", false);
                  }}
                  disabled={busy}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((option) => (
                      <SelectItem
                        key={`${option.contentRef}:${option.mediaId}`}
                        value={`${option.contentRef}:${option.mediaId}`}
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[form.formState.errors.choice]} />
          </Field>
          <Field orientation="horizontal">
            <Controller
              control={form.control}
              name="confirm"
              render={({ field }) => (
                <Checkbox
                  id="fb-media-confirm"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={busy}
                />
              )}
            />
            <FieldLabel htmlFor="fb-media-confirm">
              我已核对所选内容、素材权利及目标个人账号，确认本次发布。
            </FieldLabel>
            <FieldError errors={[form.formState.errors.confirm]} />
          </Field>
          <Button type="submit" disabled={busy || !options.length}>
            确认并发布素材
          </Button>
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
