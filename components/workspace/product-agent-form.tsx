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
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
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
import { useWorkspaceDirty } from "./dirty-state";
import { useCreatedRecord } from "./use-created-record";

type AgentValues = z.infer<typeof productAgentRunFormSchema>;

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
  const textEvidenceOptions = evidenceOptions.filter(
    (option) => !option.contentType.startsWith("image/"),
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const [actionState, action, actionPending] = useActionState(
    runProductAgentAction,
    initialProductAgentActionState,
  );
  const stream = useProductStream();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const state = canStream ? stream.state : actionState;
  const pending = uploading || (canStream ? stream.pending : actionPending);
  useEffect(() => {
    onBusyChange?.(pending);
    return () => onBusyChange?.(false);
  }, [pending, onBusyChange]);
  const usableConfigs = modelConfigs.filter(
    (item) => item.apiKeyConfigured || item.authTokenConfigured,
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
  const [textSourceOpen, setTextSourceOpen] = useState(false);
  useEffect(() => {
    onDraftDirty?.(form.formState.isDirty);
    return () => onDraftDirty?.(false);
  }, [form.formState.isDirty, onDraftDirty]);
  const clearSource = useEffectEvent(() => source?.clear());
  const choices = usableConfigs.flatMap((config) =>
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
      setSelectedChoice(initialChoice);
      if (fileRef.current) fileRef.current.value = "";
      if (imageRef.current) imageRef.current.value = "";
      router.refresh();
    }
  }, [emptyAgent, initialChoice, form, router, state.status]);
  useCreatedRecord(projectId, "product", state.status, state.productId);
  async function submit(values: AgentValues) {
    setUploadError("");
    setUploading(true);
    try {
      const images = productImageFilesSchema.parse(Array.from(imageRef.current?.files ?? []));
      const data = new FormData();
      data.set("projectId", projectId);
      data.set("modelConfigId", values.modelConfigId);
      data.set("model", values.model);
      data.set("sourceRef", values.sourceRef ?? "");
      data.set("evidenceRef", values.evidenceRef ?? "");
      data.set("sourceText", values.sourceText);
      const file = source ? source.file : fileRef.current?.files?.[0];
      if (file) data.set("receiptId", await uploadProductDocument(file, projectId, "agent"));
      for (const image of images)
        data.append("imageReceiptId", await uploadProductDocument(image, projectId, "agent_image"));
      if (canStream) void stream.start(data);
      else startTransition(() => action(data));
    } catch {
      setUploadError("文件上传失败，请检查格式、大小与项目权限后重试。");
    } finally {
      setUploading(false);
    }
  }
  const choiceItems = Object.fromEntries(choices.map((choice) => [choice.value, choice.label]));
  return (
    <Card>
      <CardHeader>
        <CardTitle>从获授权资料导入</CardTitle>
        <CardDescription>
          上传文件会自动持久化为证据；粘贴文本时必须选择一项已保存证据，结果仍需人工核实。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id="product-agent-import"
          onSubmit={form.handleSubmit(submit, () => setTextSourceOpen(true))}
        >
          {uploadError ? (
            <p role="alert" className="text-sm text-destructive">
              {uploadError}
            </p>
          ) : null}
          <FieldGroup>
            <Collapsible>
              <CollapsibleTrigger render={<Button type="button" variant="outline" />}>
                高级设置：模型
              </CollapsibleTrigger>
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
              <Field>
                <FieldLabel htmlFor="agent-document">产品资料</FieldLabel>
                <Input
                  ref={fileRef}
                  id="agent-document"
                  type="file"
                  accept=".pdf,.csv,.xls,.xlsx"
                  onChange={(event) =>
                    form.setValue("hasUpload", Boolean(event.target.files?.length), {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                />
                <FieldDescription>资料会自动保存为私有来源，最大 25MB。</FieldDescription>
                <FieldError errors={[form.formState.errors.sourceText]} />
              </Field>
            ) : (
              <p className="text-sm text-muted-foreground">
                {source.file
                  ? `所选文件：${source.file.name}`
                  : "请先在上方选择资料文件，或使用已有证据中的文本。"}
              </p>
            )}
            <Field data-invalid={!!form.formState.errors.imageFiles}>
              <FieldLabel htmlFor="agent-images">实物图片（可选）</FieldLabel>
              <Input
                ref={imageRef}
                id="agent-images"
                aria-invalid={!!form.formState.errors.imageFiles}
                onChange={(event) =>
                  form.setValue("imageFiles", Array.from(event.target.files ?? []), {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
                type="file"
                multiple
                accept=".png,.jpg,.jpeg"
                disabled={pending}
              />
              <FieldError errors={[form.formState.errors.imageFiles]} />
              <FieldDescription>
                最多 4 张，每张 5
                MiB，仅用于当前单个产品的外观核验。图片不补全工程事实，也不代表营销授权；无图可继续。
              </FieldDescription>
            </Field>
            <Collapsible open={textSourceOpen} onOpenChange={setTextSourceOpen}>
              <CollapsibleTrigger render={<Button type="button" variant="outline" />}>
                改用已有证据中的文本
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-4">
                <FieldGroup>
                  <Field data-invalid={!!form.formState.errors.sourceRef}>
                    <FieldLabel htmlFor="agent-source">来源引用</FieldLabel>
                    <Input
                      id="agent-source"
                      placeholder="source-catalog-001"
                      {...form.register("sourceRef")}
                    />
                    <FieldError errors={[form.formState.errors.sourceRef]} />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.evidenceRef}>
                    <FieldLabel htmlFor="agent-evidence">字段证据</FieldLabel>
                    <Controller
                      control={form.control}
                      name="evidenceRef"
                      render={({ field }) => (
                        <Select
                          value={field.value ?? ""}
                          onValueChange={(value) => field.onChange(value ?? "")}
                          disabled={!textEvidenceOptions.length}
                        >
                          <SelectTrigger
                            id="agent-evidence"
                            className="min-h-11 w-full"
                            aria-invalid={!!form.formState.errors.evidenceRef}
                          >
                            <SelectValue>
                              {textEvidenceOptions.find((option) => option.id === field.value)
                                ?.sourceLabel ?? "选择已上传证据"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {textEvidenceOptions.map((option) => (
                                <SelectItem key={option.id} value={option.id}>
                                  {option.sourceLabel} · {option.id.slice(-8)}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <FieldDescription>上传新文件时可不选；粘贴文本时必须选择。</FieldDescription>
                    <FieldError errors={[form.formState.errors.evidenceRef]} />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.sourceText}>
                    <FieldLabel htmlFor="agent-text">已授权资料文本</FieldLabel>
                    <Textarea id="agent-text" rows={8} {...form.register("sourceText")} />
                    <FieldError errors={[form.formState.errors.sourceText]} />
                  </Field>
                </FieldGroup>
              </CollapsibleContent>
            </Collapsible>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3">
        <Button
          form="product-agent-import"
          type="submit"
          disabled={pending || choices.length === 0}
        >
          {pending ? <Spinner data-icon="inline-start" /> : <BotIcon data-icon="inline-start" />}
          生成待审核草稿
        </Button>
        {canStream && pending ? (
          <Button variant="outline" onClick={stream.stop}>
            停止生成
          </Button>
        ) : null}
        {canStream && state.productId ? (
          <LinkButton
            variant="outline"
            href={workspaceRecordHref(projectId, "product", state.productId)}
            target="_blank"
            rel="noopener noreferrer"
          >
            打开已保存草稿（新窗口）
          </LinkButton>
        ) : null}
        {canStream && Object.keys(stream.fields).length ? (
          <section className="grid gap-2" aria-label="生成字段状态">
            {Object.values(stream.fields).map((field) => (
              <div key={field.field} className="flex flex-wrap items-center justify-between gap-2">
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
                  {
                    {
                      waiting: "等待模型",
                      source_validated: "来源校验通过 · 待人工审核",
                      needs_evidence: "待补证据",
                      invalid: "校验失败",
                    }[field.status]
                  }
                </Badge>
              </div>
            ))}
          </section>
        ) : null}
        {choices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            管理员需先在工作区设置中保存至少一个可用模型。
          </p>
        ) : null}
        {state.message ? (
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
        ) : null}
      </CardFooter>
    </Card>
  );
}
