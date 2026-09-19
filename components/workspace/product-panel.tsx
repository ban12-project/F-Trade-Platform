"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  BotIcon,
  CheckCircle2Icon,
  FileUpIcon,
  PlusIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  XCircleIcon,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type ReactNode,
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useProductStream } from "@/components/workspace/use-product-stream";
import {
  initialProductActionState,
  initialProductAgentActionState,
  initialProductEvidenceActionState,
} from "@/lib/action-states";
import { runProductAgentAction } from "@/lib/actions/product-agent";
import { uploadProductEvidenceAction } from "@/lib/actions/product-evidence";
import {
  createProductCatalogDraftAction,
  decideProductCatalogReviewAction,
  reviseProductCatalogDraftAction,
} from "@/lib/actions/products";
import type { ProductAgentModelSettings } from "@/lib/ai/product-agent-model-config";
import { productAgentRunFormSchema, productReviewFormSchema } from "@/lib/form-schemas";
import { productCatalogFormSchema } from "@/lib/product/catalog-form-schema";
import { documentUploadFormSchema } from "@/lib/product/document-upload-contracts";
import type { ProductEvidencePreview } from "@/lib/product/evidence-preview";
import { productBlockerLabel, productFactLabels } from "@/lib/product/fact-labels";
import { productImageFilesSchema } from "@/lib/product/source-image-contracts";
import { uploadProductDocument } from "@/lib/product/upload-document-client";
import type { ProductCatalogDetail, ProductCatalogEntry } from "@/lib/products";
import type { EvidenceOption } from "@/lib/workspace/access";
import { workspaceCreateHref, workspaceRecordHref } from "@/lib/workspace/navigation";
import { useWorkspaceDirty, useWorkspaceDirtyState } from "./dirty-state";
import { ProductCatalogImport } from "./product-catalog-import";
import { ProductEvidenceSources } from "./product-evidence-preview";
import {
  emptyProduct,
  ProductFields,
  type ProductValues,
  productDraftValues,
} from "./product-fact-fields";
import { WorkspaceLink as Link } from "./workspace-link";

type ReviewValues = z.infer<typeof productReviewFormSchema>;
type AgentValues = z.infer<typeof productAgentRunFormSchema>;

function EvidenceLibrary({
  projectId,
  evidenceOptions,
}: {
  projectId: string;
  evidenceOptions: EvidenceOption[];
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    async (previous: typeof initialProductEvidenceActionState, file: File) => {
      try {
        const receiptId = await uploadProductDocument(file, projectId, "evidence");
        const data = new FormData();
        data.set("projectId", projectId);
        data.set("receiptId", receiptId);
        return await uploadProductEvidenceAction(previous, data);
      } catch {
        return { status: "error" as const, message: "文件上传失败，请检查文件与项目权限后重试。" };
      }
    },
    initialProductEvidenceActionState,
  );
  const form = useForm<z.infer<typeof documentUploadFormSchema>>({
    resolver: zodResolver(documentUploadFormSchema),
  });
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>项目证据库</CardTitle>
        <CardDescription>
          先独立保存工厂资料，再逐字段绑定；上传不会运行 AI 或批准事实。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={form.handleSubmit(({ document }) => startTransition(() => action(document)))}
        >
          <FieldGroup>
            <Field data-invalid={Boolean(form.formState.errors.document)}>
              <FieldLabel htmlFor="project-evidence-document">证据文件</FieldLabel>
              <Controller
                control={form.control}
                name="document"
                render={({ field }) => (
                  <Input
                    id="project-evidence-document"
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    type="file"
                    accept=".pdf,.csv,.xls,.xlsx"
                    required
                    disabled={pending}
                    aria-invalid={Boolean(form.formState.errors.document)}
                    onChange={(event) => field.onChange(event.target.files?.[0])}
                  />
                )}
              />
              <FieldDescription>
                支持 PDF、CSV、XLS、XLSX，最大 25 MiB；文件保存在私有存储。
              </FieldDescription>
              <FieldError errors={[form.formState.errors.document]} />
            </Field>
            <Button type="submit" variant="outline" className="min-h-11 w-full" disabled={pending}>
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <FileUpIcon data-icon="inline-start" />
              )}
              保存到项目证据库
            </Button>
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
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter>
        <span className="text-xs text-muted-foreground">
          当前可用 {evidenceOptions.length} 项证据
        </span>
      </CardFooter>
    </Card>
  );
}

function stateLabel(state: string) {
  return (
    (
      {
        PRODUCT_REVIEW_REQUIRED: "待人工核实",
        PRODUCT_REVISION_REQUIRED: "待修订",
        PRODUCT_READY: "已核验",
      } as Record<string, string>
    )[state] ?? state
  );
}

function textValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function ProductDraftForm({
  projectId,
  detail,
  evidenceOptions,
}: {
  projectId: string;
  detail?: ProductCatalogDetail;
  evidenceOptions: EvidenceOption[];
}) {
  const router = useRouter();
  const revising = detail?.state === "PRODUCT_REVISION_REQUIRED";
  const [state, action, pending] = useActionState(
    revising ? reviseProductCatalogDraftAction : createProductCatalogDraftAction,
    initialProductActionState,
  );
  const form = useForm<ProductValues>({
    resolver: zodResolver(productCatalogFormSchema),
    defaultValues: detail ? productDraftValues(detail) : emptyProduct,
  });
  useWorkspaceDirty(`product-draft-${detail?.id ?? "new"}`, form.formState.isDirty);
  useEffect(() => {
    if (state.status === "success") {
      form.reset(revising ? form.getValues() : emptyProduct);
      router.refresh();
    }
  }, [form, revising, router, state.status]);
  function submit(values: ProductValues) {
    const data = new FormData();
    data.set("projectId", projectId);
    if (detail) data.set("productId", detail.id);
    for (const [key, value] of Object.entries(values))
      if (value !== undefined) data.set(key, value);
    startTransition(() => action(data));
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{revising ? "修订产品草稿" : "手动新建产品草稿"}</CardTitle>
        <CardDescription>
          {revising
            ? "只更正有来源依据的字段及其独立证据，提交后重新送交人工核实。"
            : "每个事实独立绑定已持久化证据；保存后只创建待审核记录。"}
        </CardDescription>
      </CardHeader>
      <form
        id={revising ? "revise-product" : "create-product"}
        onSubmit={form.handleSubmit(submit)}
        noValidate
      >
        <CardContent>
          <ProductFields form={form} evidenceOptions={evidenceOptions} />
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3">
          <Button type="submit" disabled={pending || !evidenceOptions.length}>
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : revising ? (
              <RotateCcwIcon data-icon="inline-start" />
            ) : (
              <PlusIcon data-icon="inline-start" />
            )}
            {revising ? "提交修订并送审" : "创建待审核草稿"}
          </Button>
          {state.status === "success" && state.productId && !revising ? (
            <Button
              render={<Link href={workspaceRecordHref(projectId, "product", state.productId)} />}
              variant="outline"
            >
              打开产品草稿
            </Button>
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
      </form>
    </Card>
  );
}

function ProductAgentForm({
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

function ProductReview({
  projectId,
  detail,
  canReview,
  evidenceOptions,
  sourceDocuments,
}: {
  projectId: string;
  detail: ProductCatalogDetail;
  canReview: boolean;
  evidenceOptions: EvidenceOption[];
  sourceDocuments: ProductEvidencePreview[];
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    decideProductCatalogReviewAction,
    initialProductActionState,
  );
  const form = useForm<ReviewValues>({
    resolver: zodResolver(productReviewFormSchema),
    defaultValues: {
      productId: detail.id,
      reviewedVersion: String(detail.version),
      approvalId: detail.approvalId ?? "",
      evidenceRef: "",
      notes: "",
    },
  });
  useWorkspaceDirty(`product-review-${detail.id}`, form.formState.isDirty);
  useEffect(() => {
    if (state.status === "success") {
      form.reset(form.getValues());
      router.refresh();
    }
  }, [form, router, state.status]);
  function submit(values: ReviewValues) {
    const data = new FormData();
    data.set("projectId", projectId);
    for (const [key, value] of Object.entries(values))
      if (value !== undefined) data.set(key, value);
    startTransition(() => action(data));
  }
  const facts = (["product", "specifications", "commercial"] as const).flatMap((section) =>
    Object.entries(detail.draft[section] ?? {}).map(([field, value]) => ({
      path: `${section}.${field}`,
      value: Array.isArray(value) ? value.join(", ") : textValue(value),
      evidence: detail.draft.field_evidence[`${section}.${field}`] ?? "缺失",
    })),
  );
  const canDecide =
    canReview && detail.state === "PRODUCT_REVIEW_REQUIRED" && detail.approvalStatus === "pending";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{stateLabel(detail.state)}</Badge>
        <Badge variant="outline">{detail.internalSku}</Badge>
        <Badge variant="outline">第 {detail.version} 版</Badge>
      </div>
      {detail.blockingFields.length ? (
        <Alert>
          <AlertTitle>先补齐核实所需资料</AlertTitle>
          <AlertDescription>
            {detail.blockingFields.map(productBlockerLabel).join("；")}
            。请在退回备注中明确需要补充的来源，资料编辑者修订后重新送审。
          </AlertDescription>
        </Alert>
      ) : null}
      {detail.state.endsWith("REVISION_REQUIRED") ? (
        <Alert>
          <AlertTitle>根据审核意见修订</AlertTitle>
          <AlertDescription>
            {detail.reviewNotes || "这条记录已退回，请核对来源后修改并重新送审。"}
          </AlertDescription>
        </Alert>
      ) : null}
      {detail.state === "PRODUCT_REVISION_REQUIRED" ? (
        <div className="flex flex-col gap-4">
          <ProductDraftForm
            projectId={projectId}
            detail={detail}
            evidenceOptions={evidenceOptions}
          />
          <EvidenceLibrary projectId={projectId} evidenceOptions={evidenceOptions} />
        </div>
      ) : null}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{detail.productName}</CardTitle>
            <CardDescription>产品事实与证据 · 逐项核对，缺少来源的事实保持待补充。</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>字段</TableHead>
                  <TableHead>当前值</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {facts.map((fact) => (
                  <TableRow key={fact.path}>
                    <TableCell className="max-w-36 whitespace-normal break-words">
                      <span>{productFactLabels[fact.path] ?? fact.path}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {evidenceOptions.find((item) => item.id === fact.evidence)?.sourceLabel ??
                          fact.evidence}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-48 whitespace-normal break-words">
                      {fact.value || "未提供"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
          <CardFooter>
            阻塞项：
            {detail.blockingFields.length
              ? detail.blockingFields.map(productBlockerLabel).join("、")
              : "无自动阻塞项，仍需人工核对。"}
          </CardFooter>
        </Card>
        <ProductEvidenceSources sources={sourceDocuments} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>原始实物图片</CardTitle>
          <CardDescription>
            核对外观与当前产品是否一致；图片不能证明尺寸、OE 或材料，也不能替代营销素材授权。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {detail.sourceImages.length ? (
            <div className="flex flex-col gap-2">
              {detail.sourceImages.map((image, index) => (
                <LinkButton
                  key={image.evidenceId}
                  variant="outline"
                  href={`/api/product-source-images/${detail.id}/${image.evidenceId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  查看原始图片 {index + 1}
                </LinkButton>
              ))}
            </div>
          ) : (
            <p>未提供实物图片。后续内容可使用文字排版，不能以生成图补充产品事实。</p>
          )}
        </CardContent>
      </Card>
      {canDecide ? (
        <Card>
          <CardHeader>
            <CardTitle>产品核实决定</CardTitle>
            <CardDescription>
              审核版本 {detail.version}。批准不会发布、报价或承诺交期；请先明确选择。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form id="product-review" onSubmit={form.handleSubmit(submit)}>
              <FieldGroup>
                <Field data-invalid={!!form.formState.errors.decision}>
                  <FieldLabel htmlFor="product-review-decision">决定</FieldLabel>
                  <Controller
                    control={form.control}
                    name="decision"
                    render={({ field }) => (
                      <Select
                        items={{ approved: "批准产品事实", rejected: "退回产品事实" }}
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger
                          id="product-review-decision"
                          className="min-h-11 w-full"
                          aria-invalid={!!form.formState.errors.decision}
                        >
                          <SelectValue placeholder="请选择审核决定" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="approved">批准产品事实</SelectItem>
                            <SelectItem value="rejected">退回产品事实</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldError errors={[form.formState.errors.decision]} />
                </Field>
                {detail.sourceImages.length ? (
                  <Field>
                    <FieldLabel htmlFor="product-image-confirmation">图片一致性</FieldLabel>
                    <Controller
                      control={form.control}
                      name="imageConsistencyConfirmed"
                      render={({ field }) => (
                        <Select
                          value={field.value ?? "false"}
                          onValueChange={field.onChange}
                          items={{
                            false: "尚未确认或不一致",
                            true: "已核对全部原始图片，与当前产品一致",
                          }}
                        >
                          <SelectTrigger id="product-image-confirmation">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="false">尚未确认或不一致</SelectItem>
                              <SelectItem value="true">
                                已核对全部原始图片，与当前产品一致
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <FieldDescription>
                      批准前必须确认；无法确认时请退回并说明原因。
                    </FieldDescription>
                  </Field>
                ) : null}
                <Field data-invalid={!!form.formState.errors.evidenceRef}>
                  <FieldLabel htmlFor="product-review-evidence">审核证据</FieldLabel>
                  <Controller
                    control={form.control}
                    name="evidenceRef"
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={(value) => field.onChange(value ?? "")}
                        disabled={!evidenceOptions.length}
                      >
                        <SelectTrigger id="product-review-evidence" className="min-h-11 w-full">
                          <SelectValue>
                            {evidenceOptions.find((option) => option.id === field.value)
                              ?.sourceLabel ?? "选择已上传证据"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {evidenceOptions.map((option) => (
                              <SelectItem key={option.id} value={option.id}>
                                {option.sourceLabel} · {option.id.slice(-8)}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldError errors={[form.formState.errors.evidenceRef]} />
                </Field>
                <Field data-invalid={!!form.formState.errors.notes}>
                  <FieldLabel htmlFor="product-review-notes">
                    审核备注{form.watch("decision") === "rejected" ? "（必填）" : ""}
                  </FieldLabel>
                  <Textarea
                    id="product-review-notes"
                    aria-invalid={!!form.formState.errors.notes}
                    {...form.register("notes")}
                  />
                  <FieldError errors={[form.formState.errors.notes]} />
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-3">
            <Button
              form="product-review"
              type="submit"
              variant={form.watch("decision") === "rejected" ? "destructive" : "default"}
              disabled={pending || !form.watch("decision") || !evidenceOptions.length}
            >
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : form.watch("decision") === "approved" ? (
                <CheckCircle2Icon data-icon="inline-start" />
              ) : (
                <XCircleIcon data-icon="inline-start" />
              )}
              {form.watch("decision") === "approved"
                ? "批准产品事实"
                : form.watch("decision") === "rejected"
                  ? "退回产品事实"
                  : "请先选择决定"}
            </Button>
            {state.message ? (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {state.message}
              </p>
            ) : null}
          </CardFooter>
        </Card>
      ) : detail.state === "PRODUCT_REVIEW_REQUIRED" ? (
        <Alert>
          <ShieldCheckIcon />
          <AlertTitle>{canReview ? "审核请求需要核对" : "等待审核者核实产品"}</AlertTitle>
          <AlertDescription>
            {canReview
              ? "当前记录没有有效的待审请求，请核对记录状态。"
              : "由有产品审核权限的项目编辑者核对当前版本。"}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

export function ProductPanel({
  projectId,
  entries,
  detail,
  canReview,
  agentModelConfigs,
  evidenceOptions = [],
  mode = "create",
  children,
  sourceDocuments = [],
}: {
  projectId: string;
  entries: ProductCatalogEntry[];
  detail: ProductCatalogDetail | null;
  canReview: boolean;
  agentModelConfigs: ProductAgentModelSettings[];
  evidenceOptions?: EvidenceOption[];
  mode?: "create" | "collection";
  children?: ReactNode;
  sourceDocuments?: ProductEvidencePreview[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { requestNavigation } = useWorkspaceDirtyState();
  const intakeForm = useForm<z.infer<typeof documentUploadFormSchema>>({
    resolver: zodResolver(documentUploadFormSchema),
  });
  const file = intakeForm.watch("document");
  const intakeFileRef = useRef<HTMLInputElement | null>(null);
  const clearFile = useCallback(() => {
    intakeForm.reset();
    if (intakeFileRef.current) intakeFileRef.current.value = "";
  }, [intakeForm]);
  const [draftDirty, setDraftDirty] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  useWorkspaceDirty("product-intake-file", !detail && !!file);
  const requestedMethod = searchParams.get("method");
  const tab =
    requestedMethod === "manual" || requestedMethod === "catalog" ? requestedMethod : "agent";
  function setTab(value: string) {
    const query = new URLSearchParams(searchParams.toString());
    query.set("method", value);
    const navigate = () => {
      if (value === "manual") clearFile();
      window.history.pushState(null, "", `${pathname}?${query}`);
    };
    if (draftDirty || value === "manual" || tab === "manual") requestNavigation(navigate);
    else navigate();
  }
  function href(item: string) {
    if (pathname.startsWith("/workspace/")) return workspaceRecordHref(projectId, "product", item);
    const params = new URLSearchParams(searchParams.toString());
    params.set("panel", "product");
    params.set("item", item);
    return `${pathname}?${params}`;
  }
  if (detail)
    return (
      <div className="flex flex-col gap-6">
        {children}
        <ProductReview
          key={`${detail.id}:${detail.version}:${detail.approvalId}`}
          projectId={projectId}
          detail={detail}
          canReview={canReview}
          evidenceOptions={evidenceOptions}
          sourceDocuments={sourceDocuments}
        />
      </div>
    );
  if (mode === "collection" && entries.length)
    return (
      <Card>
        <CardHeader>
          <CardTitle>产品资料</CardTitle>
          <CardDescription>选择产品核实资料，或导入新的产品。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {entries.map((entry) => (
            <Button
              key={entry.id}
              render={<Link href={href(entry.id)} />}
              variant="outline"
              className="h-auto justify-start py-3 text-left"
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="break-words">
                  {entry.internalSku} · {entry.productName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {stateLabel(entry.state)}
                  {entry.blockingFields.length ? ` · ${entry.blockingFields.length} 项待补充` : ""}
                </span>
              </span>
            </Button>
          ))}
        </CardContent>
        <CardFooter>
          <Button render={<Link href={workspaceCreateHref(projectId, "product")} />}>
            导入产品资料
          </Button>
        </CardFooter>
      </Card>
    );
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">导入产品资料</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          从获授权的工厂资料开始。导入结果会保存为草稿，由人工核实后用于内容制作。
        </p>
      </div>
      {tab !== "manual" ? (
        <Card>
          <CardHeader>
            <CardTitle>选择产品资料</CardTitle>
            <CardDescription>
              先选择文件，再确认是单个产品资料还是包含多个产品的目录。文件会随导入自动保存为证据。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field data-invalid={!!intakeForm.formState.errors.document}>
                <FieldLabel htmlFor="product-source-file">产品资料</FieldLabel>
                <Controller
                  control={intakeForm.control}
                  name="document"
                  render={({ field }) => (
                    <Input
                      id="product-source-file"
                      disabled={importBusy || !intakeForm.formState.isReady}
                      type="file"
                      accept=".pdf,.csv,.xls,.xlsx"
                      ref={(element) => {
                        field.ref(element);
                        intakeFileRef.current = element;
                      }}
                      onBlur={field.onBlur}
                      onChange={(event) => {
                        field.onChange(event.target.files?.[0]);
                        void intakeForm.trigger("document");
                      }}
                    />
                  )}
                />
                <FieldDescription>
                  {file ? `已选择：${file.name}` : "支持 PDF、CSV 和 Excel，最大 25 MiB。"}
                </FieldDescription>
                <FieldError errors={[intakeForm.formState.errors.document]} />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
      ) : null}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full" aria-label="资料录入方式">
          <TabsTrigger value="agent" disabled={importBusy}>
            单个产品
          </TabsTrigger>
          <TabsTrigger value="catalog" disabled={importBusy}>
            产品目录
          </TabsTrigger>
          <TabsTrigger value="manual" disabled={importBusy}>
            手动录入
          </TabsTrigger>
        </TabsList>
        <TabsContent value="agent">
          <ProductAgentForm
            source={{ file, clear: clearFile }}
            onDraftDirty={setDraftDirty}
            onBusyChange={setImportBusy}
            canStream={canReview}
            projectId={projectId}
            modelConfigs={agentModelConfigs}
            evidenceOptions={evidenceOptions}
          />
        </TabsContent>
        <TabsContent value="manual" className="flex flex-col gap-4">
          <EvidenceLibrary projectId={projectId} evidenceOptions={evidenceOptions} />
          <ProductDraftForm projectId={projectId} evidenceOptions={evidenceOptions} />
        </TabsContent>
        <TabsContent value="catalog">
          <ProductCatalogImport
            source={{ file, clear: clearFile }}
            onDraftDirty={setDraftDirty}
            onBusyChange={setImportBusy}
            key={projectId}
            projectId={projectId}
            modelConfigs={agentModelConfigs}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
