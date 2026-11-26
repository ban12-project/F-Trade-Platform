"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "@ui-sdk/react/toast";
import { uploadPresigned } from "@vercel/blob/client";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  FilmIcon,
  ImageIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UploadCloudIcon,
  VideoIcon,
  XCircleIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { RadioGroup, RadioGroupChoice } from "@/components/ui/radio-group";
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
import { useBrowserTimeZone } from "@/hooks/use-browser-time-zone";
import {
  type ProductMediaActionState,
  registerProductMediaAction,
  reviewProductMediaAction,
} from "@/lib/actions/product-media";
import { localTimeChoices } from "@/lib/local-time";
import {
  type ProductMediaRegistrationFields,
  type ProductMediaReviewForm,
  productMediaRegistrationFieldsSchema,
  productMediaReviewFormSchema,
} from "@/lib/product/media-form-schemas";
import type { ProductMediaAsset, VideoReadyAssessment } from "@/lib/product/video-readiness";
import {
  shouldUseMultipartVideoUpload,
  videoPresignedUploadPayloadSchema,
  videoUploadBlobPath,
} from "@/lib/video/upload-contracts";
import { useWorkspaceDirty } from "./dirty-state";
import { EvidenceSelectField } from "./evidence-select";
import { FileDropzone } from "./file-dropzone";

const initialProductMediaActionState: ProductMediaActionState = {
  status: "idle",
  message: "",
};

const roleLabels: Record<ProductMediaAsset["semantic"]["role"], string> = {
  product_hero: "产品主图",
  product_detail: "产品细节",
  packaging: "包装",
  factory: "工厂",
  inspection: "检测",
  application: "应用场景",
  other: "其他",
};

const originLabels: Record<ProductMediaAsset["origin"], string> = {
  factory: "工厂提供",
  user_upload: "用户上传",
  licensed: "第三方授权",
};

const reviewLabels: Record<ProductMediaAsset["review"]["status"], string> = {
  pending: "待媒体审核",
  approved: "已批准",
  rejected: "已拒绝 / 撤销",
};

function readinessLabel(status: VideoReadyAssessment["status"]) {
  return status === "ready"
    ? "可制作视频"
    : status === "review_required"
      ? "等待素材审核"
      : "暂不可制作视频";
}

function mediaDimensions(asset: ProductMediaAsset) {
  const technical = asset.technical;
  const duration =
    technical.durationMs === null ? "" : ` · ${(technical.durationMs / 1_000).toFixed(1)} 秒`;
  return `${technical.width}×${technical.height}${duration}`;
}

function formatRightsExpiry(value: string) {
  return new Date(value).toISOString().replace(".000Z", "Z");
}

function RegistrationForm({ projectId, productId }: { projectId: string; productId: string }) {
  const timeZone = useBrowserTimeZone();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const hasFile = selectedFiles.length > 0;
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [state, action, pending] = useActionState(
    registerProductMediaAction,
    initialProductMediaActionState,
  );
  const form = useForm<ProductMediaRegistrationFields>({
    resolver: zodResolver(productMediaRegistrationFieldsSchema),
    defaultValues: {
      projectId,
      productId,
      origin: "factory",
      role: "product_hero",
      description: "",
      tags: "",
      productVisible: true,
      logoVisible: false,
      textPresent: false,
      rightsEvidenceRef: "",
      editingAllowed: false,
      publicDistributionAllowed: false,
      paidAdvertisingAllowed: false,
      imageToVideoAllowed: false,
      referenceToVideoAllowed: false,
      rightsExpiresAt: "",
      selectedRightsExpiryInstant: "",
    },
  });
  const expiryField = form.register("rightsExpiresAt");
  const expiryChoices = localTimeChoices(form.watch("rightsExpiresAt"), timeZone);
  useWorkspaceDirty(`product-media-${productId}`, form.formState.isDirty || hasFile || uploading);

  useEffect(() => {
    if (state.status !== "success") return;
    form.reset({ ...form.getValues(), description: "", tags: "" });
    if (fileRef.current) fileRef.current.value = "";
    setSelectedFiles([]);
    setUploadProgress(0);
    toast.success("媒体素材已登记，可在列表中核对状态。");
    router.refresh();
  }, [form, router, state]);

  async function submit(values: ProductMediaRegistrationFields) {
    if (!form.formState.isReady || uploading || pending) return;
    const file = selectedFiles[0] ?? fileRef.current?.files?.[0];
    if (!file) {
      setUploadError("请选择一个产品图片或视频。");
      return;
    }
    setUploadError("");
    setUploading(true);
    setUploadProgress(0);
    try {
      const receiptId = crypto.randomUUID();
      const payload = videoPresignedUploadPayloadSchema.parse({
        receiptId,
        projectId,
        originalFilename: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        rightsEvidenceRef: values.rightsEvidenceRef,
      });
      await uploadPresigned(videoUploadBlobPath(payload), file, {
        access: "private",
        contentType: payload.contentType,
        handleUploadUrl: "/api/video-assets/upload",
        clientPayload: JSON.stringify(payload),
        multipart: shouldUseMultipartVideoUpload(payload.sizeBytes),
        onUploadProgress: ({ percentage }) => setUploadProgress(percentage),
      });

      const data = new FormData();
      for (const [key, value] of Object.entries(values)) data.set(key, String(value));
      data.set("receiptId", receiptId);
      startTransition(() => action(data));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "无法上传产品媒体。");
    } finally {
      setUploading(false);
    }
  }

  const busy = !form.formState.isReady || pending || uploading;
  return (
    <Card>
      <CardHeader>
        <CardTitle>添加产品图片或视频</CardTitle>
        <CardDescription>
          上传产品图片或视频，选择使用授权证明。系统会自动读取文件规格，审核通过后可用于制作营销视频。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id={`register-product-media-${productId}`}
          aria-busy={busy}
          onSubmit={form.handleSubmit(submit)}
        >
          <FieldSet disabled={busy}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`product-media-file-${productId}`}>图片或视频</FieldLabel>
                <FileDropzone
                  inputRef={fileRef}
                  id={`product-media-file-${productId}`}
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                  required
                  disabled={busy}
                  files={selectedFiles}
                  emptyTitle="拖拽产品图片或视频到这里，或点击选择"
                  emptyDescription="支持 JPG、PNG、WebP、MP4、MOV；视频最长 120 秒"
                  onFilesChange={(files) => {
                    setSelectedFiles(files);
                    setUploadError("");
                  }}
                />
                <FieldDescription>
                  支持 JPG、PNG、WebP、MP4、MOV。视频最长 120 秒，登记后仍需独立媒体审核。
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor={`media-origin-${productId}`}>素材来源</FieldLabel>
                <Controller
                  control={form.control}
                  name="origin"
                  render={({ field }) => (
                    <Select
                      disabled={busy}
                      items={originLabels}
                      value={field.value ?? null}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger id={`media-origin-${productId}`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {Object.entries(originLabels).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`media-role-${productId}`}>素材角色</FieldLabel>
                <Controller
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <Select
                      disabled={busy}
                      items={roleLabels}
                      value={field.value ?? null}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger id={`media-role-${productId}`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {Object.entries(roleLabels).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field data-invalid={Boolean(form.formState.errors.description)}>
                <FieldLabel htmlFor={`product-media-description-${productId}`}>内容说明</FieldLabel>
                <Textarea
                  id={`product-media-description-${productId}`}
                  rows={3}
                  placeholder="只描述画面中可见内容，不补充工程结论。"
                  {...form.register("description")}
                />
                <FieldError errors={[form.formState.errors.description]} />
              </Field>
              <Field data-invalid={Boolean(form.formState.errors.tags)}>
                <FieldLabel htmlFor={`product-media-tags-${productId}`}>标签</FieldLabel>
                <Input
                  id={`product-media-tags-${productId}`}
                  placeholder="front, product, packaging"
                  {...form.register("tags")}
                />
                <FieldDescription>最多保留 20 个去重标签。</FieldDescription>
                <FieldError errors={[form.formState.errors.tags]} />
              </Field>
              <FieldSet>
                <FieldLegend>可见内容</FieldLegend>
                <FieldGroup>
                  <Field orientation="horizontal">
                    <Controller
                      control={form.control}
                      name="productVisible"
                      render={({ field }) => (
                        <Checkbox
                          disabled={busy}
                          id={`media-product-visible-${productId}`}
                          aria-labelledby={`media-product-visible-${productId}-label`}
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      )}
                    />
                    <FieldLabel
                      id={`media-product-visible-${productId}-label`}
                      htmlFor={`media-product-visible-${productId}`}
                    >
                      产品清晰可见
                    </FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <Controller
                      control={form.control}
                      name="logoVisible"
                      render={({ field }) => (
                        <Checkbox
                          disabled={busy}
                          id={`media-logo-visible-${productId}`}
                          aria-labelledby={`media-logo-visible-${productId}-label`}
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      )}
                    />
                    <FieldLabel
                      id={`media-logo-visible-${productId}-label`}
                      htmlFor={`media-logo-visible-${productId}`}
                    >
                      包含 Logo
                    </FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <Controller
                      control={form.control}
                      name="textPresent"
                      render={({ field }) => (
                        <Checkbox
                          disabled={busy}
                          id={`media-text-present-${productId}`}
                          aria-labelledby={`media-text-present-${productId}-label`}
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      )}
                    />
                    <FieldLabel
                      id={`media-text-present-${productId}-label`}
                      htmlFor={`media-text-present-${productId}`}
                    >
                      画面包含文字
                    </FieldLabel>
                  </Field>
                </FieldGroup>
              </FieldSet>
              <FieldSet>
                <FieldLegend>权利范围</FieldLegend>
                <FieldDescription>
                  这些选项只记录授权范围，不会自动启用生成模型或发布。
                </FieldDescription>
                <FieldGroup>
                  <Field data-invalid={Boolean(form.formState.errors.rightsEvidenceRef)}>
                    <FieldLabel htmlFor={`media-rights-${productId}`}>素材使用授权证明</FieldLabel>
                    <EvidenceSelectField
                      disabled={busy}
                      projectId={projectId}
                      control={form.control}
                      name="rightsEvidenceRef"
                      id={`media-rights-${productId}`}
                    />
                    <FieldError errors={[form.formState.errors.rightsEvidenceRef]} />
                  </Field>
                  <Field orientation="horizontal">
                    <Controller
                      control={form.control}
                      name="editingAllowed"
                      render={({ field }) => (
                        <Checkbox
                          disabled={busy}
                          id={`media-editing-${productId}`}
                          aria-labelledby={`media-editing-${productId}-label`}
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      )}
                    />
                    <FieldLabel
                      id={`media-editing-${productId}-label`}
                      htmlFor={`media-editing-${productId}`}
                    >
                      允许剪辑
                    </FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <Controller
                      control={form.control}
                      name="publicDistributionAllowed"
                      render={({ field }) => (
                        <Checkbox
                          disabled={busy}
                          id={`media-public-${productId}`}
                          aria-labelledby={`media-public-${productId}-label`}
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      )}
                    />
                    <FieldLabel
                      id={`media-public-${productId}-label`}
                      htmlFor={`media-public-${productId}`}
                    >
                      允许公开发布
                    </FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <Controller
                      control={form.control}
                      name="paidAdvertisingAllowed"
                      render={({ field }) => (
                        <Checkbox
                          disabled={busy}
                          id={`media-paid-${productId}`}
                          aria-labelledby={`media-paid-${productId}-label`}
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      )}
                    />
                    <FieldLabel
                      id={`media-paid-${productId}-label`}
                      htmlFor={`media-paid-${productId}`}
                    >
                      允许付费广告
                    </FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <Controller
                      control={form.control}
                      name="imageToVideoAllowed"
                      render={({ field }) => (
                        <Checkbox
                          disabled={busy}
                          id={`media-i2v-${productId}`}
                          aria-labelledby={`media-i2v-${productId}-label`}
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      )}
                    />
                    <FieldLabel
                      id={`media-i2v-${productId}-label`}
                      htmlFor={`media-i2v-${productId}`}
                    >
                      允许图生视频
                    </FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <Controller
                      control={form.control}
                      name="referenceToVideoAllowed"
                      render={({ field }) => (
                        <Checkbox
                          disabled={busy}
                          id={`media-r2v-${productId}`}
                          aria-labelledby={`media-r2v-${productId}-label`}
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      )}
                    />
                    <FieldLabel
                      id={`media-r2v-${productId}-label`}
                      htmlFor={`media-r2v-${productId}`}
                    >
                      允许作为视频参考素材
                    </FieldLabel>
                  </Field>
                  <Field data-invalid={Boolean(form.formState.errors.rightsExpiresAt)}>
                    <FieldLabel htmlFor={`media-expiry-${productId}`}>授权到期时间</FieldLabel>
                    <Input
                      id={`media-expiry-${productId}`}
                      type="datetime-local"
                      {...expiryField}
                      onChange={(event) => {
                        void expiryField.onChange(event);
                        form.setValue("selectedRightsExpiryInstant", "", { shouldDirty: true });
                        form.clearErrors(["rightsExpiresAt", "selectedRightsExpiryInstant"]);
                      }}
                      aria-invalid={Boolean(form.formState.errors.rightsExpiresAt)}
                      aria-describedby={`media-expiry-help-${productId}${form.formState.errors.rightsExpiresAt ? ` media-expiry-error-${productId}` : ""}`}
                    />
                    <FieldDescription id={`media-expiry-help-${productId}`}>
                      按当前设备时区（{timeZone}）填写；长期有效可留空。
                    </FieldDescription>
                    <FieldError
                      id={`media-expiry-error-${productId}`}
                      errors={[form.formState.errors.rightsExpiresAt]}
                    />
                  </Field>
                  {expiryChoices.length > 1 ? (
                    <Field
                      data-invalid={Boolean(form.formState.errors.selectedRightsExpiryInstant)}
                    >
                      <FieldLabel htmlFor={`media-expiry-occurrence-${productId}`}>
                        授权到期重复时间选择
                      </FieldLabel>
                      <NativeSelect
                        id={`media-expiry-occurrence-${productId}`}
                        {...form.register("selectedRightsExpiryInstant")}
                        onChange={(event) => {
                          form.setValue("selectedRightsExpiryInstant", event.target.value, {
                            shouldDirty: true,
                          });
                          form.clearErrors("selectedRightsExpiryInstant");
                        }}
                        aria-invalid={Boolean(form.formState.errors.selectedRightsExpiryInstant)}
                        aria-describedby={`media-occurrence-help-${productId}${form.formState.errors.selectedRightsExpiryInstant ? ` media-occurrence-error-${productId}` : ""}`}
                      >
                        <NativeSelectOption value="">请选择具体时刻</NativeSelectOption>
                        {expiryChoices.map((choice, index) => (
                          <NativeSelectOption key={choice.instant} value={choice.instant}>
                            {index === 0 ? "第一次" : "第二次"}（UTC{choice.offset}）
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                      <FieldDescription id={`media-occurrence-help-${productId}`}>
                        时钟回拨使此时间出现两次，请按授权证明选择具体时刻。
                      </FieldDescription>
                      <FieldError
                        id={`media-occurrence-error-${productId}`}
                        errors={[form.formState.errors.selectedRightsExpiryInstant]}
                      />
                    </Field>
                  ) : null}
                </FieldGroup>
              </FieldSet>
              {uploading ? (
                <Progress aria-label="产品媒体上传进度" value={uploadProgress}>
                  <ProgressLabel>上传私有素材</ProgressLabel>
                  <ProgressValue>{() => `${Math.round(uploadProgress)}%`}</ProgressValue>
                </Progress>
              ) : null}
            </FieldGroup>
          </FieldSet>
        </form>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3">
        <Button
          form={`register-product-media-${productId}`}
          type="submit"
          disabled={busy || !hasFile}
        >
          {uploading || pending ? (
            <Spinner aria-hidden="true" data-icon="inline-start" />
          ) : (
            <UploadCloudIcon data-icon="inline-start" />
          )}
          {uploading ? "上传中…" : pending ? "探测并登记中…" : "上传素材并提交审核"}
        </Button>
        {uploadError ? (
          <p className="text-sm text-destructive" aria-live="polite">
            {uploadError}
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

function ReviewForm({
  projectId,
  productId,
  asset,
}: {
  projectId: string;
  productId: string;
  asset: ProductMediaAsset;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    reviewProductMediaAction,
    initialProductMediaActionState,
  );
  const revoking = asset.review.status === "approved";
  const form = useForm<ProductMediaReviewForm>({
    resolver: zodResolver(productMediaReviewFormSchema),
    defaultValues: {
      projectId,
      productId,
      assetId: asset.id,
      ...(revoking ? { decision: "rejected" as const } : {}),
      evidenceRef: "",
      notes: "",
    },
  });
  useEffect(() => {
    if (state.status === "success") {
      form.reset(form.getValues());
      router.refresh();
    }
  }, [form, router, state.status]);
  function submit(values: ProductMediaReviewForm) {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    startTransition(() => action(data));
  }

  return (
    <form className="mt-4" onSubmit={form.handleSubmit(submit)}>
      <FieldGroup>
        {!revoking ? (
          <Field data-invalid={Boolean(form.formState.errors.decision)}>
            <FieldTitle id={`media-review-decision-${asset.id}-label`}>审核决定</FieldTitle>
            <Controller
              control={form.control}
              name="decision"
              render={({ field }) => (
                <RadioGroup
                  id={`media-review-decision-${asset.id}`}
                  disabled={pending}
                  aria-labelledby={`media-review-decision-${asset.id}-label`}
                  aria-invalid={Boolean(form.formState.errors.decision)}
                  value={field.value ?? null}
                  onValueChange={(next) => {
                    if (next) field.onChange(next);
                  }}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  <RadioGroupChoice value="approved" itemRef={field.ref} onBlur={field.onBlur}>
                    批准素材
                  </RadioGroupChoice>
                  <RadioGroupChoice value="rejected" onBlur={field.onBlur}>
                    拒绝素材
                  </RadioGroupChoice>
                </RadioGroup>
              )}
            />
            <FieldError errors={[form.formState.errors.decision]} />
          </Field>
        ) : (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>撤销已批准素材</AlertTitle>
            <AlertDescription>
              撤销后，该素材将无法继续用于制作视频。请选择新的审核依据并说明原因。
            </AlertDescription>
          </Alert>
        )}
        <Field data-invalid={Boolean(form.formState.errors.evidenceRef)}>
          <FieldLabel htmlFor={`media-review-evidence-${asset.id}`}>审核依据</FieldLabel>
          <EvidenceSelectField
            projectId={projectId}
            control={form.control}
            name="evidenceRef"
            id={`media-review-evidence-${asset.id}`}
          />
          <FieldError errors={[form.formState.errors.evidenceRef]} />
        </Field>
        <Field data-invalid={Boolean(form.formState.errors.notes)}>
          <FieldLabel htmlFor={`media-review-notes-${asset.id}`}>审核备注</FieldLabel>
          <Textarea id={`media-review-notes-${asset.id}`} rows={3} {...form.register("notes")} />
          <FieldError errors={[form.formState.errors.notes]} />
        </Field>
        <Button
          type="submit"
          variant={revoking || form.watch("decision") === "rejected" ? "destructive" : "default"}
          disabled={pending || (!revoking && !form.watch("decision"))}
        >
          {pending ? (
            <Spinner data-icon="inline-start" />
          ) : revoking || form.watch("decision") === "rejected" ? (
            <XCircleIcon data-icon="inline-start" />
          ) : (
            <CheckCircle2Icon data-icon="inline-start" />
          )}
          {revoking
            ? "撤销素材授权"
            : form.watch("decision") === "approved"
              ? "批准产品素材"
              : form.watch("decision") === "rejected"
                ? "拒绝产品素材"
                : "请先选择决定"}
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
      </FieldGroup>
    </form>
  );
}

function AssetCard({
  projectId,
  productId,
  asset,
  canReview,
}: {
  projectId: string;
  productId: string;
  asset: ProductMediaAsset;
  canReview: boolean;
}) {
  const generative = asset.rights.imageToVideoAllowed || asset.rights.referenceToVideoAllowed;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-md border bg-muted p-2">
              {asset.mediaType === "image" ? (
                <ImageIcon className="size-5" />
              ) : (
                <VideoIcon className="size-5" />
              )}
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base">{roleLabels[asset.semantic.role]}</CardTitle>
              <CardDescription>
                {originLabels[asset.origin]} · {mediaDimensions(asset)}
              </CardDescription>
            </div>
          </div>
          <Badge
            variant={
              asset.review.status === "approved"
                ? "secondary"
                : asset.review.status === "rejected"
                  ? "destructive"
                  : "outline"
            }
          >
            {reviewLabels[asset.review.status]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {asset.semantic.description ? (
          <p className="text-sm">{asset.semantic.description}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{asset.technical.contentType}</Badge>
          {asset.rights.editingAllowed ? <Badge variant="outline">可剪辑</Badge> : null}
          {asset.rights.publicDistributionAllowed ? (
            <Badge variant="outline">可公开发布</Badge>
          ) : null}
          {asset.rights.paidAdvertisingAllowed ? <Badge variant="outline">可付费广告</Badge> : null}
          {asset.rights.imageToVideoAllowed ? (
            <Badge variant="outline">
              <SparklesIcon />
              图生视频授权
            </Badge>
          ) : null}
          {asset.rights.referenceToVideoAllowed ? (
            <Badge variant="outline">
              <SparklesIcon />
              参考生成授权
            </Badge>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground">
          <p>原始素材记录：{asset.evidenceRef}</p>
          <p>授权证明：{asset.rights.rightsEvidenceRef}</p>
          {asset.rights.expiresAt ? (
            <p>授权到期：{formatRightsExpiry(asset.rights.expiresAt)}</p>
          ) : null}
          {asset.review.evidenceRef ? <p>审核依据：{asset.review.evidenceRef}</p> : null}
        </div>
        {generative ? (
          <Alert>
            <SparklesIcon />
            <AlertTitle>仅记录生成式使用权</AlertTitle>
            <AlertDescription>
              视频生成服务仍保持关闭；授权记录本身不会触发模型调用。
            </AlertDescription>
          </Alert>
        ) : null}
        {canReview && asset.review.status !== "rejected" ? (
          <ReviewForm
            key={asset.review.status}
            projectId={projectId}
            productId={productId}
            asset={asset}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ProductMediaPanel({
  projectId,
  productId,
  assets,
  assessment,
  canReview,
  canWrite,
}: {
  projectId: string;
  productId: string;
  assets: ProductMediaAsset[];
  assessment: VideoReadyAssessment;
  canReview: boolean;
  canWrite: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">
          <FilmIcon />
          产品媒体
        </Badge>
        <Badge variant={assessment.status === "ready" ? "default" : "outline"}>
          {readinessLabel(assessment.status)}
        </Badge>
        <Badge variant="outline">可剪辑 {assessment.editingEligibleAssetIds.length}</Badge>
      </div>
      <Alert variant={assessment.status === "not_ready" ? "destructive" : "default"}>
        {assessment.status === "ready" ? <ShieldCheckIcon /> : <CircleAlertIcon />}
        <AlertTitle>
          {assessment.status === "ready"
            ? "该产品已具备视频剪辑素材"
            : readinessLabel(assessment.status)}
        </AlertTitle>
        <AlertDescription>
          {assessment.status === "ready"
            ? `已有 ${assessment.editingEligibleAssetIds.length} 个审核通过且允许编辑、公开发布的素材。`
            : assessment.blockers.map((issue) => issue.message).join("；") || "等待产品媒体审核。"}
        </AlertDescription>
      </Alert>
      {assessment.warnings.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">提示</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {assessment.warnings.map((issue, index) => (
                <li key={`${issue.code}-${issue.assetId ?? index}`}>{issue.message}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      {canWrite ? <RegistrationForm projectId={projectId} productId={productId} /> : null}
      <div className="flex flex-col gap-3">
        {assets.length ? (
          assets.map((asset) => (
            <AssetCard
              key={asset.id}
              projectId={projectId}
              productId={productId}
              asset={asset}
              canReview={canWrite && canReview}
            />
          ))
        ) : (
          <Alert>
            <UploadCloudIcon />
            <AlertTitle>尚未登记可复用媒体</AlertTitle>
            <AlertDescription>
              上传真实产品图片或视频并登记逐素材权利后，管理员可进行独立媒体审核。
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
