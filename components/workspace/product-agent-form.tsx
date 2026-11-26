"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { BotIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useActionState,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGrid,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useProductStream } from "@/components/workspace/use-product-stream";
import { initialProductAgentActionState } from "@/lib/action-states";
import { runProductAgentAction } from "@/lib/actions/product-agent";
import type { ProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";
import { productAgentRunFormSchema } from "@/lib/form-schemas";
import { productFactLabels } from "@/lib/product/fact-labels";
import { productImageFilesSchema } from "@/lib/product/source-image-contracts";
import { uploadProductDocument } from "@/lib/product/upload-document-client";
import type { EvidenceOption } from "@/lib/workspace/access";
import { workspaceRecordHref } from "@/lib/workspace/navigation";
import { useBackgroundTasks } from "./background-tasks";
import { useWorkspaceDirty } from "./dirty-state";
import { StaticEvidenceCombobox } from "./evidence-select";
import { FileDropzone } from "./file-dropzone";
import { MarkdownPreviewDialog } from "./markdown-preview-dialog";
import { useCreatedRecord } from "./use-created-record";
import { WorkspaceLink } from "./workspace-link";

type AgentValues = z.infer<typeof productAgentRunFormSchema>;

const fieldStatusText = {
  waiting: "等待模型",
  source_validated: "来源校验通过 · 待人工审核",
  needs_evidence: "待补资料",
  invalid: "校验失败",
} as const;

export function ProductAgentForm({
  projectId,
  modelConfigs,
  evidenceOptions,
  canStream,
  source,
  onDraftDirty,
  onBusyChange,
}: {
  canStream: boolean;
  projectId: string;
  modelConfigs: ProductAgentModelSettings[];
  evidenceOptions: EvidenceOption[];
  source?: { file?: File; clear: () => void };
  onDraftDirty?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const { startTask, finishTask } = useBackgroundTasks();
  const textEvidenceOptions = useMemo(
    () => evidenceOptions.filter((option) => !option.contentType.startsWith("image/")),
    [evidenceOptions],
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const [standaloneFiles, setStandaloneFiles] = useState<File[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [actionState, action, actionPending] = useActionState(
    runProductAgentAction,
    initialProductAgentActionState,
  );
  const stream = useProductStream();
  const uploadController = useRef<AbortController | null>(null);
  const taskIdRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      uploadController.current?.abort();
      uploadController.current = null;
    },
    [],
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const state = canStream ? stream.state : actionState;
  const created = useCreatedRecord(projectId, "product", state.status, state.productId);
  const pending = created || uploading || (canStream ? stream.pending : actionPending);
  useEffect(() => {
    onBusyChange?.(pending);
    return () => onBusyChange?.(false);
  }, [pending, onBusyChange]);
  const usableConfigs = useMemo(
    () => modelConfigs.filter((item) => item.apiKeyConfigured || item.authTokenConfigured),
    [modelConfigs],
  );
  const defaultConfig = usableConfigs.find((item) => item.isDefault) ?? usableConfigs[0];
  const emptyAgent = useMemo(
    () => ({
      modelConfigId: defaultConfig?.id ?? "",
      model: defaultConfig?.model ?? "",
      sourceRef: "",
      evidenceRef: "",
      sourceText: "",
      hasUpload: false,
      imageFiles: [] as File[],
    }),
    [defaultConfig?.id, defaultConfig?.model],
  );
  const form = useForm<AgentValues>({
    resolver: zodResolver(productAgentRunFormSchema),
    defaultValues: emptyAgent,
  });
  const sourceFile = source?.file;
  const hasSharedSource = source !== undefined;
  useEffect(() => {
    if (hasSharedSource) form.setValue("hasUpload", !!sourceFile);
  }, [sourceFile, hasSharedSource, form]);
  const watchedImages = useWatch({ control: form.control, name: "imageFiles" }) ?? [];
  const [textSourceOpen, setTextSourceOpen] = useState(false);
  useEffect(() => {
    onDraftDirty?.(form.formState.isDirty);
    return () => onDraftDirty?.(false);
  }, [form.formState.isDirty, onDraftDirty]);
  const clearSource = useEffectEvent(() => source?.clear());
  const choices = useMemo(
    () =>
      usableConfigs.flatMap((config) =>
        Array.from(
          new Set(
            [config.model, ...config.discoveredModels].map((model) => model.trim()).filter(Boolean),
          ),
        ).map((model) => ({
          value: JSON.stringify([config.id, model]),
          configId: config.id,
          model,
          label: `${config.name} · ${model}`,
        })),
      ),
    [usableConfigs],
  );
  const initialChoice =
    choices.find(
      (choice) => choice.configId === emptyAgent.modelConfigId && choice.model === emptyAgent.model,
    )?.value ?? "";
  const [selectedChoice, setSelectedChoice] = useState(initialChoice);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  useWorkspaceDirty("product-agent-import", form.formState.isDirty);

  useEffect(() => {
    if (state.status === "success") {
      form.reset(emptyAgent);
      clearSource();
      setStandaloneFiles([]);
      setSelectedChoice(initialChoice);
      if (fileRef.current) fileRef.current.value = "";
      if (imageRef.current) imageRef.current.value = "";
      if (taskIdRef.current) {
        finishTask(taskIdRef.current, {
          kind: "product-stream",
          status: "success",
          title: "单个产品 AI 抽取完成",
          description: "草稿已生成，请人工核实字段来源。",
          href: state.productId
            ? workspaceRecordHref(projectId, "product", state.productId)
            : undefined,
        });
        taskIdRef.current = null;
      }
      router.refresh();
    } else if (state.status === "error" && taskIdRef.current) {
      finishTask(taskIdRef.current, {
        kind: "product-stream",
        status: "error",
        title: "单个产品 AI 抽取未完成",
        description: "请查看页面内的详细原因并重试。",
        href: state.productId
          ? workspaceRecordHref(projectId, "product", state.productId)
          : undefined,
      });
      taskIdRef.current = null;
    }
  }, [
    emptyAgent,
    finishTask,
    form,
    initialChoice,
    projectId,
    router,
    state.productId,
    state.status,
  ]);

  async function submit(values: AgentValues) {
    if (pending || uploadController.current) return;
    const active = new AbortController();
    uploadController.current = active;
    setUploadError("");
    setUploading(true);
    try {
      const images = productImageFilesSchema.parse(
        values.imageFiles?.length ? values.imageFiles : Array.from(imageRef.current?.files ?? []),
      );
      const data = new FormData();
      data.set("projectId", projectId);
      data.set("modelConfigId", values.modelConfigId);
      data.set("model", values.model);
      data.set("sourceRef", values.sourceRef ?? "");
      data.set("evidenceRef", values.evidenceRef ?? "");
      data.set("sourceText", values.sourceText);
      const file = source ? source.file : (standaloneFiles[0] ?? fileRef.current?.files?.[0]);
      if (file)
        data.set("receiptId", await uploadProductDocument(file, projectId, "agent", active.signal));
      for (const image of images)
        data.append(
          "imageReceiptId",
          await uploadProductDocument(image, projectId, "agent_image", active.signal),
        );
      active.signal.throwIfAborted();
      const taskId = `product-agent-${crypto.randomUUID()}`;
      taskIdRef.current = taskId;
      startTask({
        id: taskId,
        kind: "product-stream",
        title: "正在抽取单个产品资料",
        description: `模型：${values.model} · 请勿关闭页面直到连接建立，可点击「查看 AI 实时输出」`,
      });
      if (canStream) void stream.start(data);
      else startTransition(() => action(data));
    } catch {
      if (uploadController.current === active) {
        setUploadError(
          active.signal.aborted
            ? "已停止上传，未开始生成。文件选择已保留，可重新尝试。"
            : "文件上传失败，请检查格式、大小与项目权限后重试。",
        );
      }
    } finally {
      if (uploadController.current === active) {
        uploadController.current = null;
        setUploading(false);
      }
    }
  }
  function stopUpload() {
    const active = uploadController.current;
    if (!active) return;
    active.abort();
    uploadController.current = null;
    setUploading(false);
    setUploadError("已停止上传，未开始生成。文件选择已保留，可重新尝试。");
  }
  const choiceItems = useMemo(
    () => Object.fromEntries(choices.map((choice) => [choice.value, choice.label])),
    [choices],
  );
  const streamFieldsList = Object.values(stream.fields);
  const completedFieldCount = streamFieldsList.filter((item) => item.status !== "waiting").length;
  const validatedFieldCount = streamFieldsList.filter(
    (item) => item.status === "source_validated",
  ).length;
  const activeModelLabel =
    choices.find((item) => item.value === selectedChoice)?.label ?? "默认模型";

  const streamMarkdown = useMemo(() => {
    if (!detailOpen) return "";
    const lines = [
      `## 产品字段 AI 实时抽取详情`,
      "",
      `- **运行模型**：${activeModelLabel}`,
      `- **当前状态**：${state.message || (stream.pending ? "正在流式核对来源…" : "已就绪")}`,
      `- **已处理字段**：${completedFieldCount} / ${streamFieldsList.length || 20}（来源校验通过 **${validatedFieldCount}** 项）`,
      "",
      "| 产品字段 | 抽取结果 | 状态 | 证据位置 |",
      "| --- | --- | --- | --- |",
      ...streamFieldsList.map((field) => {
        const label = productFactLabels[field.field] ?? field.field;
        const rawValue =
          field.value === null
            ? "—"
            : Array.isArray(field.value)
              ? field.value.join("、")
              : String(field.value);
        const safeValue = rawValue.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
        const safeEvidence = field.evidenceRef ? `\`${field.evidenceRef}\`` : "—";
        return `| ${label} | ${safeValue} | ${fieldStatusText[field.status]} | ${safeEvidence} |`;
      }),
    ];
    return lines.join("\n");
  }, [
    activeModelLabel,
    completedFieldCount,
    detailOpen,
    state.message,
    stream.pending,
    streamFieldsList,
    validatedFieldCount,
  ]);

  const imageField = (
    <Field data-invalid={!!form.formState.errors.imageFiles}>
      <FieldLabel htmlFor="agent-images">实物图片（可选）</FieldLabel>
      <FileDropzone
        id="agent-images"
        inputRef={imageRef}
        accept=".png,.jpg,.jpeg"
        multiple
        maxFiles={4}
        disabled={pending}
        invalid={!!form.formState.errors.imageFiles}
        files={watchedImages}
        emptyTitle="拖拽产品实拍图片到这里（最多 4 张）"
        emptyDescription="支持 PNG / JPG / JPEG，单张不超过 5 MB"
        buttonLabel={watchedImages.length ? "继续添加图片" : "选择图片"}
        onFilesChange={(files) =>
          form.setValue("imageFiles", files, {
            shouldValidate: true,
            shouldDirty: true,
          })
        }
      />
      <FieldError errors={[form.formState.errors.imageFiles]} />
      <FieldDescription>
        仅用于当前单个产品的外观核验。图片不补全工程事实，也不代表营销授权；无图可继续。
      </FieldDescription>
    </Field>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>从获授权资料导入</CardTitle>
        <CardDescription>
          上传的文件会自动保存到资料库。粘贴文本时，可搜索选择对应的来源文件；整理结果仍需人工核实。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id="product-agent-import"
          aria-busy={pending}
          onSubmit={form.handleSubmit(submit, () => setTextSourceOpen(true))}
        >
          {uploadError ? (
            <p role="alert" className="text-sm text-destructive">
              {uploadError}
            </p>
          ) : null}
          <FieldSet disabled={pending}>
            <FieldGroup>
              <Collapsible>
                <div className="flex flex-wrap items-center gap-2">
                  <CollapsibleTrigger render={<Button type="button" variant="outline" />}>
                    高级设置：模型
                  </CollapsibleTrigger>
                  <span className="text-xs text-muted-foreground">
                    当前模型：{activeModelLabel}
                  </span>
                </div>
                <CollapsibleContent className="pt-4">
                  {choices.length ? (
                    <Field
                      data-invalid={
                        !!form.formState.errors.modelConfigId || !!form.formState.errors.model
                      }
                    >
                      <FieldLabel>模型</FieldLabel>
                      <Select
                        items={choiceItems}
                        open={modelPickerOpen}
                        onOpenChange={setModelPickerOpen}
                        value={selectedChoice}
                        onValueChange={(value) => {
                          const choice = choices.find((item) => item.value === value);
                          if (!choice) return;
                          setSelectedChoice(choice.value);
                          form.setValue("modelConfigId", choice.configId, {
                            shouldValidate: true,
                            shouldDirty: true,
                          });
                          form.setValue("model", choice.model, {
                            shouldValidate: true,
                            shouldDirty: true,
                          });
                        }}
                      >
                        <SelectTrigger
                          className="min-h-11 w-full"
                          aria-label="模型"
                          aria-invalid={
                            !!form.formState.errors.modelConfigId || !!form.formState.errors.model
                          }
                          onKeyDownCapture={(event) => {
                            if (event.key !== "Enter" || modelPickerOpen) return;
                            event.preventDefault();
                            event.stopPropagation();
                            setModelPickerOpen(true);
                          }}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {choices.map((choice) => (
                              <SelectItem key={choice.value} value={choice.value}>
                                {choice.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FieldDescription>本次运行只使用这里选择的模型。</FieldDescription>
                      <FieldError
                        errors={[form.formState.errors.modelConfigId, form.formState.errors.model]}
                      />
                    </Field>
                  ) : null}
                </CollapsibleContent>
              </Collapsible>
              {!source ? (
                <FieldGrid columns={2}>
                  <Field>
                    <FieldLabel htmlFor="agent-document">产品资料</FieldLabel>
                    <FileDropzone
                      id="agent-document"
                      inputRef={fileRef}
                      accept=".pdf,.csv,.xls,.xlsx"
                      disabled={pending}
                      files={standaloneFiles}
                      emptyTitle="拖拽单品资料到这里，或点击选择"
                      emptyDescription="支持 PDF、CSV、XLS、XLSX，最大 25 MB"
                      onFilesChange={(files) => {
                        setStandaloneFiles(files);
                        form.setValue("hasUpload", files.length > 0, {
                          shouldDirty: true,
                          shouldValidate: true,
                        });
                      }}
                    />
                    <FieldDescription>资料会自动保存为私有来源，最大 25MB。</FieldDescription>
                    <FieldError errors={[form.formState.errors.sourceText]} />
                  </Field>
                  {imageField}
                </FieldGrid>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {source.file
                      ? `所选文件：${source.file.name}`
                      : "请先在上方选择资料文件，或展开下方使用已有资料中的文本。"}
                  </p>
                  {imageField}
                </>
              )}
              <Accordion
                value={textSourceOpen ? ["existing-text"] : []}
                onValueChange={(next) => setTextSourceOpen(next.includes("existing-text"))}
                className="rounded-lg border px-3"
              >
                <AccordionItem value="existing-text">
                  <AccordionTrigger type="button">改用已有资料中的文本</AccordionTrigger>
                  <AccordionContent className="pt-2 pb-4">
                    <FieldGroup>
                      <Field data-invalid={!!form.formState.errors.evidenceRef}>
                        <FieldLabel htmlFor="agent-evidence">信息来源</FieldLabel>
                        <Controller
                          control={form.control}
                          name="evidenceRef"
                          render={({ field }) => (
                            <StaticEvidenceCombobox
                              id="agent-evidence"
                              options={textEvidenceOptions}
                              value={field.value ?? ""}
                              disabled={pending}
                              invalid={!!form.formState.errors.evidenceRef}
                              placeholder="搜索或选择已上传资料"
                              onValueChange={(value) => {
                                field.onChange(value);
                                form.setValue("sourceRef", value, { shouldValidate: true });
                              }}
                            />
                          )}
                        />
                        <FieldDescription>
                          上传新文件时可不选；粘贴文本时必须选择。
                        </FieldDescription>
                        <FieldError errors={[form.formState.errors.evidenceRef]} />
                      </Field>
                      <Field data-invalid={!!form.formState.errors.sourceText}>
                        <FieldLabel htmlFor="agent-text">已授权资料文本</FieldLabel>
                        <Textarea id="agent-text" rows={8} {...form.register("sourceText")} />
                        <FieldError errors={[form.formState.errors.sourceText]} />
                      </Field>
                    </FieldGroup>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </FieldGroup>
          </FieldSet>
        </form>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3">
        <div className="flex flex-wrap gap-2">
          <Button
            form="product-agent-import"
            type="submit"
            className="w-full sm:w-auto"
            disabled={pending || choices.length === 0}
          >
            {pending ? <Spinner data-icon="inline-start" /> : <BotIcon data-icon="inline-start" />}
            生成待审核草稿
          </Button>
          {uploading ? (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={stopUpload}
            >
              停止上传
            </Button>
          ) : null}
          {canStream && stream.pending ? (
            <Button variant="outline" className="w-full sm:w-auto" onClick={stream.stop}>
              停止生成
            </Button>
          ) : null}
          {state.productId ? (
            <LinkButton
              variant="outline"
              className="w-full sm:w-auto"
              href={workspaceRecordHref(projectId, "product", state.productId)}
              target="_blank"
              rel="noopener noreferrer"
            >
              打开已保存草稿（新窗口）
            </LinkButton>
          ) : null}
        </div>
        {canStream && streamFieldsList.length ? (
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
            <Progress
              aria-label="字段抽取进度"
              value={
                streamFieldsList.length
                  ? Math.round((completedFieldCount / streamFieldsList.length) * 100)
                  : 0
              }
            >
              <ProgressLabel>AI 逐字段核对进度</ProgressLabel>
              <ProgressValue>
                {() =>
                  `${completedFieldCount} / ${streamFieldsList.length}（通过 ${validatedFieldCount}）`
                }
              </ProgressValue>
            </Progress>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                可在详情面板实时查看 Streamdown 渲染的完整字段与证据表
              </span>
              <MarkdownPreviewDialog
                open={detailOpen}
                onOpenChange={setDetailOpen}
                triggerLabel="查看 AI 实时输出"
                title="AI 资料抽取实时输出"
                description="按字段实时验证来源证据；仅来源校验通过的字段会写入草稿。"
                markdown={streamMarkdown}
                isAnimating={stream.pending}
              />
            </div>
            <section className="grid gap-2" aria-label="生成字段状态">
              {streamFieldsList.map((field) => (
                <div
                  key={field.field}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="min-w-0 text-sm">
                    <p>{productFactLabels[field.field]}</p>
                    {field.value !== null ? (
                      <p className="break-words">
                        {Array.isArray(field.value) ? field.value.join("、") : String(field.value)}
                      </p>
                    ) : null}
                    {field.evidenceRef ? (
                      <p className="break-all text-xs text-muted-foreground">
                        证据：{field.evidenceRef}
                      </p>
                    ) : null}
                  </div>
                  <Badge variant={field.status === "invalid" ? "destructive" : "outline"}>
                    {fieldStatusText[field.status]}
                  </Badge>
                </div>
              ))}
            </section>
          </div>
        ) : null}
        {choices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            管理员需先在工作区设置中保存至少一个可用模型。
          </p>
        ) : null}
        {state.message ? (
          <div className="flex flex-wrap items-center gap-2">
            <p
              className={
                state.status === "error"
                  ? "text-sm text-destructive"
                  : "text-sm text-muted-foreground"
              }
              aria-live="polite"
            >
              {state.message}
            </p>
            {state.status === "error" ? (
              <WorkspaceLink href="/workspace/settings?section=agent" className="text-sm underline">
                切换默认 AI 模型
              </WorkspaceLink>
            ) : null}
          </div>
        ) : null}
      </CardFooter>
    </Card>
  );
}
