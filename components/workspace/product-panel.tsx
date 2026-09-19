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
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from "react";
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
import { productImageFilesSchema } from "@/lib/product/source-image-contracts";
import { uploadProductDocument } from "@/lib/product/upload-document-client";
import type { ProductCatalogDetail, ProductCatalogEntry } from "@/lib/products";
import type { EvidenceOption } from "@/lib/workspace/access";
import { workspaceRecordHref } from "@/lib/workspace/navigation";
import { useWorkspaceDirty } from "./dirty-state";
import { ProductCatalogImport } from "./product-catalog-import";
import {
  emptyProduct,
  ProductFields,
  type ProductValues,
  productDraftValues,
} from "./product-fact-fields";

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
        PRODUCT_REVIEW_REQUIRED: "待 Gate 01",
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
            ? "只更正有来源依据的字段及其独立证据，提交后重新进入 Gate 01。"
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

const productStreamFieldLabels: Record<string, string> = {
  "product.product_name": "产品名称",
  "product.product_type": "产品类型",
  "product.internal_sku": "产品编号",
  "product.oe_numbers": "OE 编号",
  "product.application": "适用范围",
  "product.vehicle_brand": "车辆品牌",
  "product.vehicle_model": "车型",
  "specifications.clutch_diameter_mm": "离合器直径",
  "specifications.spline_count": "花键齿数",
  "specifications.spline_size": "花键尺寸",
  "specifications.friction_material": "摩擦材料",
  "specifications.kit_contents": "套件内容",
  "specifications.gross_weight_kg": "毛重",
  "specifications.net_weight_kg": "净重",
  "specifications.package_size": "包装尺寸",
  "commercial.moq": "起订量",
  "commercial.estimated_lead_time_days": "资料中的预计交期",
  "commercial.packaging": "包装",
  "commercial.supported_customization": "支持定制",
  "commercial.sample_available": "样品可用性",
};

function ProductAgentForm({
  projectId,
  modelConfigs,
  evidenceOptions,
  canStream,
}: {
  canStream: boolean;
  projectId: string;
  modelConfigs: ProductAgentModelSettings[];
  evidenceOptions: EvidenceOption[];
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
      const file = fileRef.current?.files?.[0];
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
          上传文件会自动持久化为证据；粘贴文本时必须选择一项已保存证据，结果仍需 Gate 01。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form id="product-agent-import" onSubmit={form.handleSubmit(submit)}>
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
                    form.setValue("modelConfigId", choice.configId, { shouldValidate: true });
                    form.setValue("model", choice.model, { shouldValidate: true });
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
            <Field>
              <FieldLabel htmlFor="agent-document">产品资料</FieldLabel>
              <Input
                ref={fileRef}
                id="agent-document"
                type="file"
                accept=".pdf,.csv,.xls,.xlsx"
                onChange={(event) =>
                  form.setValue("hasUpload", Boolean(event.target.files?.length), {
                    shouldValidate: true,
                  })
                }
              />
              <FieldDescription>原始文件只进入 Private Blob，最大 25MB。</FieldDescription>
            </Field>
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
            href={workspaceRecordHref(projectId, "product", state.productId!)}
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
                  <p>{productStreamFieldLabels[field.field]}</p>
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
}: {
  projectId: string;
  detail: ProductCatalogDetail;
  canReview: boolean;
  evidenceOptions: EvidenceOption[];
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
      </div>
      <Card>
        <CardHeader>
          <CardTitle>产品事实与证据</CardTitle>
          <CardDescription>逐项核对，不能用视觉猜测替代来源。</CardDescription>
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
                    <span className="font-mono text-xs">{fact.path}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {fact.evidence}
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
            ? detail.blockingFields.join("、")
            : "无自动阻塞项，仍需人工核对。"}
        </CardFooter>
      </Card>
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
            <CardTitle>Gate 01 决定</CardTitle>
            <CardDescription>
              审核版本 {detail.version}。批准不会发布、报价或承诺交期；请先明确选择。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form id="product-review" onSubmit={form.handleSubmit(submit)}>
              <FieldGroup>
                <Field data-invalid={!!form.formState.errors.decision}>
                  <FieldLabel>决定</FieldLabel>
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
      ) : (
        <Alert>
          <ShieldCheckIcon />
          <AlertTitle>{canReview ? "当前无需审核" : "等待管理员审核"}</AlertTitle>
          <AlertDescription>
            业务员可以核对事实，但不能替代管理员作出 Gate 01 决定。
          </AlertDescription>
        </Alert>
      )}
      {detail.state === "PRODUCT_REVISION_REQUIRED" ? (
        <ProductDraftForm projectId={projectId} detail={detail} evidenceOptions={evidenceOptions} />
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
}: {
  projectId: string;
  entries: ProductCatalogEntry[];
  detail: ProductCatalogDetail | null;
  canReview: boolean;
  agentModelConfigs: ProductAgentModelSettings[];
  evidenceOptions?: EvidenceOption[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(detail ? "records" : "agent");
  function href(item: string) {
    if (pathname.startsWith("/workspace/")) return workspaceRecordHref(projectId, "product", item);
    const params = new URLSearchParams(searchParams.toString());
    params.set("panel", "product");
    params.set("item", item);
    return `${pathname}?${params}`;
  }
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">产品资料</Badge>
          <Badge variant="outline">Gate 01 受控</Badge>
          <Badge variant="outline">{evidenceOptions.length} 项可用证据</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          导入、录入、审核和修订都在当前营销项目中完成。
        </p>
      </div>
      <EvidenceLibrary projectId={projectId} evidenceOptions={evidenceOptions} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full">
          <TabsTrigger value="agent">
            <FileUpIcon />
            智能导入
          </TabsTrigger>
          <TabsTrigger value="manual">
            <PlusIcon />
            手动录入
          </TabsTrigger>
          <TabsTrigger value="catalog">目录批量导入</TabsTrigger>
          <TabsTrigger value="records">记录 {entries.length}</TabsTrigger>
        </TabsList>
        <TabsContent value="agent">
          <ProductAgentForm
            canStream={canReview}
            projectId={projectId}
            modelConfigs={agentModelConfigs}
            evidenceOptions={evidenceOptions}
          />
        </TabsContent>
        <TabsContent value="manual">
          <ProductDraftForm projectId={projectId} evidenceOptions={evidenceOptions} />
        </TabsContent>
        <TabsContent value="catalog">
          <ProductCatalogImport
            key={projectId}
            projectId={projectId}
            modelConfigs={agentModelConfigs}
            onOpenDraft={() => setTab("records")}
          />
        </TabsContent>
        <TabsContent value="records">
          <div className="flex flex-col gap-3">
            {entries.length ? (
              entries.map((entry) => (
                <Button
                  key={entry.id}
                  render={<Link href={href(entry.id)} />}
                  variant={detail?.id === entry.id ? "secondary" : "outline"}
                  className="h-auto justify-start py-3 text-left"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate font-medium">
                      {entry.internalSku} · {entry.productName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {stateLabel(entry.state)}
                      {entry.blockingFields.length
                        ? ` · ${entry.blockingFields.length} 个阻塞项`
                        : ""}
                    </span>
                  </span>
                </Button>
              ))
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileUpIcon />
                  </EmptyMedia>
                  <EmptyTitle>当前项目还没有产品</EmptyTitle>
                  <EmptyDescription>从智能导入或手动录入开始。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {detail ? (
              <ProductReview
                key={`${detail.id}:${detail.version}:${detail.approvalId}`}
                projectId={projectId}
                detail={detail}
                canReview={canReview}
                evidenceOptions={evidenceOptions}
              />
            ) : null}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
