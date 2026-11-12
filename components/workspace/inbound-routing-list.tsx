"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FolderInputIcon, FolderPlusIcon, InboxIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useRef, useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { type ClosingActionState, initialClosingActionState } from "@/lib/action-states";
import { routeInboundConversationAction } from "@/lib/actions/closing";
import { readInboundContextAction } from "@/lib/actions/inbound-context";
import { inboundRoutingFormSchema } from "@/lib/form-schemas";
import type { InboundContextPreview } from "@/lib/social/inbound-context-store";
import type { InboundRoutingSummary } from "@/lib/social/inbound-routing-store";
import { workspaceRecordHref } from "@/lib/workspace/navigation";
import type { WorkspaceProjectSummary } from "@/lib/workspace/types";

function RoutingDialog({
  inbound,
  mode,
  salesProjects,
}: {
  inbound: InboundRoutingSummary;
  mode: "create" | "link";
  salesProjects: WorkspaceProjectSummary[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<InboundContextPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [loading, loadTransition] = useTransition();
  const generation = useRef(0);
  const form = useForm<z.infer<typeof inboundRoutingFormSchema>>({
    resolver: zodResolver(inboundRoutingFormSchema),
    defaultValues: {
      conversationId: inbound.id,
      mode,
      projectId: "",
      reviewedMessageAt: "",
      reviewedContextDigest: "",
    },
  });
  const projectId = form.watch("projectId");
  const confirmed = form.watch("confirmed");
  function loadPreview() {
    const request = ++generation.current;
    setPreview(null);
    setPreviewError("");
    form.resetField("confirmed");
    loadTransition(async () => {
      try {
        const result = await readInboundContextAction({ conversationId: inbound.id });
        if (generation.current !== request) return;
        if (result.preview) {
          setPreview(result.preview);
          form.setValue("reviewedMessageAt", result.preview.reviewedMessageAt);
          form.setValue("reviewedContextDigest", result.preview.reviewedContextDigest);
        } else setPreviewError(result.error);
      } catch {
        if (generation.current === request) setPreviewError("上下文未加载，请检查连接后重试。");
      }
    });
  }
  const [state, action, pending] = useActionState(
    async (previous: ClosingActionState, formData: FormData) => {
      const result = await routeInboundConversationAction(previous, formData);
      // Workspace refresh can remove this row before a state effect can navigate.
      if (result.status === "success" && result.projectId && result.id) {
        setOpen(false);
        router.push(workspaceRecordHref(result.projectId, "lead", result.id, "/workspace"));
      }
      return result;
    },
    initialClosingActionState,
  );
  const creating = mode === "create";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        form.reset();
        if (next) loadPreview();
        else {
          generation.current++;
          setPreview(null);
          setPreviewError("");
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant={creating ? "default" : "outline"}
            className="min-h-11 flex-1"
            disabled={!creating && !salesProjects.length}
          />
        }
      >
        {creating ? (
          <FolderPlusIcon data-icon="inline-start" />
        ) : (
          <FolderInputIcon data-icon="inline-start" />
        )}
        {creating ? "新建销售项目" : "关联现有项目"}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{creating ? "从入站消息新建销售项目" : "关联到现有销售项目"}</DialogTitle>
          <DialogDescription>
            {creating
              ? `项目名将使用“入站线索 ${inbound.shortReference}”，不会暴露客户姓名或账号。`
              : "只显示你有权编辑的销售项目；关联后，该项目的授权成员可查看保留期内的客户会话。"}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((value) => {
            const data = new FormData();
            for (const [key, entry] of Object.entries(value)) if (entry) data.set(key, entry);
            startTransition(() => action(data));
          })}
          className="space-y-4"
        >
          <section aria-label="入站上下文" className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">最近 3 条入站消息片段</p>
            <p className="text-xs text-muted-foreground">
              仅入站账号负责人可查看。原文是客户陈述，不代表产品事实已核实；不会复制到项目名。
            </p>
            {loading ? <p role="status">正在核对权限并加载上下文…</p> : null}
            {previewError ? (
              <p role="alert" className="text-sm text-destructive">
                {previewError}
              </p>
            ) : null}
            {preview?.messages.map((message) => (
              <div key={message.id} className="rounded bg-muted p-2">
                <time dateTime={message.receivedAt} className="text-xs text-muted-foreground">
                  {new Date(message.receivedAt).toLocaleString("zh-CN")}
                </time>
                <p className="whitespace-pre-wrap break-words text-sm">{message.excerpt}</p>
                {message.truncated ? (
                  <p className="text-xs text-muted-foreground">片段已截断</p>
                ) : null}
              </div>
            ))}
            {preview && !preview.messages.length ? (
              <p className="text-sm">没有仍在保留期内的入站消息，暂不能确认分流。</p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={loadPreview}
              disabled={loading || pending}
            >
              重新查看上下文
            </Button>
          </section>
          {!creating ? (
            <Field>
              <FieldLabel htmlFor={`project-${inbound.id}`}>销售项目</FieldLabel>
              <Select
                name="projectId"
                value={projectId}
                onValueChange={(value) => {
                  form.setValue("projectId", value ?? "");
                  form.resetField("confirmed");
                }}
              >
                <SelectTrigger id={`project-${inbound.id}`} className="min-h-11 w-full">
                  <SelectValue>
                    {salesProjects.find((project) => project.id === projectId)?.title ?? "选择项目"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {salesProjects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                请核对所选项目及其成员范围，确认这条客户会话可以归入该项目。
              </FieldDescription>
            </Field>
          ) : null}
          <Controller
            control={form.control}
            name="confirmed"
            render={({ field }) => (
              <Field orientation="horizontal">
                <Checkbox
                  id={`confirm-${mode}-${inbound.id}`}
                  checked={field.value === "yes"}
                  onCheckedChange={(checked) => field.onChange(checked ? "yes" : undefined)}
                  disabled={
                    loading || pending || !preview?.messages.length || (!creating && !projectId)
                  }
                />
                <FieldLabel htmlFor={`confirm-${mode}-${inbound.id}`}>
                  {creating
                    ? `我已核对上下文，确认创建“入站线索 ${inbound.shortReference}”`
                    : `我已核对上下文，确认关联“${salesProjects.find((project) => project.id === projectId)?.title ?? "所选项目"}”`}
                </FieldLabel>
              </Field>
            )}
          />
          {Object.values(form.formState.errors).map((error) => (
            <p key={error.message} role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          ))}
          {state.message ? (
            <p
              aria-live="polite"
              className={
                state.status === "error"
                  ? "text-sm text-destructive"
                  : "text-sm text-muted-foreground"
              }
            >
              {state.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="submit"
              className="min-h-11"
              disabled={
                pending ||
                loading ||
                !preview?.messages.length ||
                confirmed !== "yes" ||
                (!creating && !projectId)
              }
            >
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {creating ? `创建“入站线索 ${inbound.shortReference}”` : "关联所选项目"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function InboundRoutingList({
  items,
  projects,
}: {
  items: InboundRoutingSummary[];
  projects: WorkspaceProjectSummary[];
}) {
  const salesProjects = projects.filter(
    (project) =>
      project.kind === "sales" && project.status === "active" && project.memberRole !== "viewer",
  );
  if (!items.length) return null;
  return (
    <section className="mb-4 space-y-3" aria-label="待分流入站消息">
      {items.map((item) => (
        <div key={item.id} className="rounded-xl border bg-muted/30 p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-background">
              <InboxIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">入站消息 {item.shortReference}</p>
                <Badge>待分流</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.channelLabel} · {item.lastMessageAt.toLocaleString("zh-CN")}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                选择新建项目或关联现有项目后，直接进入销售项目的客户线索步骤。
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <RoutingDialog inbound={item} mode="create" salesProjects={salesProjects} />
            <RoutingDialog inbound={item} mode="link" salesProjects={salesProjects} />
          </div>
        </div>
      ))}
    </section>
  );
}
