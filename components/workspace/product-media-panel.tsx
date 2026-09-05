"use client";

import { zodResolver } from "@hookform/resolvers/zod";
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
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import {
  type ProductMediaActionState,
  registerProductMediaAction,
  reviewProductMediaAction,
} from "@/lib/actions/product-media";
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
    ? "VideoReady"
    : status === "review_required"
      ? "等待媒体审核"
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
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [hasFile, setHasFile] = useState(false);
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
    },
  });
  useWorkspaceDirty(`product-media-${productId}`, form.formState.isDirty || hasFile || uploading);

  useEffect(() => {
    if (state.status !== "success") return;
    form.reset({ ...form.getValues(), description: "", tags: "" });
    if (fileRef.current) fileRef.current.value = "";
    setHasFile(false);
    setUploadProgress(0);
    router.refresh();
  }, [form, router, state.status]);

  async function submit(values: ProductMediaRegistrationFields) {
    const file = fileRef.current?.files?.[0];
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

  const busy = pending || uploading;
  return (
    <Card>
      <CardHeader>
        <CardTitle>登记可复用产品媒体</CardTitle>
        <CardDescription>
          源文件先直传 Private Blob，再由 Sandbox 的 ffprobe
          读取尺寸、时长、帧率和音轨。浏览器填写的技术参数不会被采信。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form id={`register-product-media-${productId}`} onSubmit={form.handleSubmit(submit)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`product-media-file-${productId}`}>图片或视频</FieldLabel>
              <Input
                ref={fileRef}
                id={`product-media-file-${productId}`}
                type="file"
                accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                required
                onChange={(event) => setHasFile(Boolean(event.target.files?.length))}
              />
              <FieldDescription>
                支持 JPG、PNG、WebP、MP4、MOV。视频最长 120 秒，登记后仍需独立媒体审核。
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel>素材来源</FieldLabel>
              <Controller
                control={form.control}
                name="origin"
                render={({ field }) => (
                  <Select items={originLabels} value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
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
              <FieldLabel>素材角色</FieldLabel>
              <Controller
                control={form.control}
                name="role"
                render={({ field }) => (
                  <Select items={roleLabels} value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
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
                        id={`media-product-visible-${productId}`}
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                  <FieldLabel htmlFor={`media-product-visible-${productId}`}>
                    产品清晰可见
                  </FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <Controller
                    control={form.control}
                    name="logoVisible"
                    render={({ field }) => (
                      <Checkbox
                        id={`media-logo-visible-${productId}`}
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                  <FieldLabel htmlFor={`media-logo-visible-${productId}`}>包含 Logo</FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <Controller
                    control={form.control}
                    name="textPresent"
                    render={({ field }) => (
                      <Checkbox
                        id={`media-text-present-${productId}`}
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                  <FieldLabel htmlFor={`media-text-present-${productId}`}>画面包含文字</FieldLabel>
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
                  <FieldLabel htmlFor={`media-rights-${productId}`}>权利证据引用</FieldLabel>
                  <Input
                    id={`media-rights-${productId}`}
                    placeholder="evidence-media-rights-001"
                    {...form.register("rightsEvidenceRef")}
                  />
                  <FieldError errors={[form.formState.errors.rightsEvidenceRef]} />
                </Field>
                <Field orientation="horizontal">
                  <Controller
                    control={form.control}
                    name="editingAllowed"
                    render={({ field }) => (
                      <Checkbox
                        id={`media-editing-${productId}`}
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                  <FieldLabel htmlFor={`media-editing-${productId}`}>允许剪辑</FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <Controller
                    control={form.control}
                    name="publicDistributionAllowed"
                    render={({ field }) => (
                      <Checkbox
                        id={`media-public-${productId}`}
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                  <FieldLabel htmlFor={`media-public-${productId}`}>允许公开发布</FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <Controller
                    control={form.control}
                    name="paidAdvertisingAllowed"
                    render={({ field }) => (
                      <Checkbox
                        id={`media-paid-${productId}`}
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                  <FieldLabel htmlFor={`media-paid-${productId}`}>允许付费广告</FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <Controller
                    control={form.control}
                    name="imageToVideoAllowed"
                    render={({ field }) => (
                      <Checkbox
                        id={`media-i2v-${productId}`}
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                  <FieldLabel htmlFor={`media-i2v-${productId}`}>允许图生视频</FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <Controller
                    control={form.control}
                    name="referenceToVideoAllowed"
                    render={({ field }) => (
                      <Checkbox
                        id={`media-r2v-${productId}`}
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                  <FieldLabel htmlFor={`media-r2v-${productId}`}>允许作为视频参考素材</FieldLabel>
                </Field>
                <Field data-invalid={Boolean(form.formState.errors.rightsExpiresAt)}>
                  <FieldLabel htmlFor={`media-expiry-${productId}`}>授权到期时间</FieldLabel>
                  <Input
                    id={`media-expiry-${productId}`}
                    type="datetime-local"
                    {...form.register("rightsExpiresAt")}
                  />
                  <FieldDescription>长期有效可留空。</FieldDescription>
                  <FieldError errors={[form.formState.errors.rightsExpiresAt]} />
                </Field>
              </FieldGroup>
            </FieldSet>
            {uploading ? (
              <Progress aria-label="产品媒体上传进度" value={uploadProgress}>
                <ProgressLabel>上传私有素材</ProgressLabel>
                <ProgressValue>{() => `${Math.round(uploadProgress)}%`}</ProgressValue>
              </Progress>
            ) : null}
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3">
        <Button
          form={`register-product-media-${productId}`}
          type="submit"
          disabled={busy || !hasFile}
        >
          {busy ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <UploadCloudIcon data-icon="inline-start" />
          )}
          {uploading ? "上传中…" : pending ? "探测并登记中…" : "上传并登记待审媒体"}
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
            <FieldLabel>审核决定</FieldLabel>
            <Controller
              control={form.control}
              name="decision"
              render={({ field }) => (
                <Select
                  items={{ approved: "批准素材", rejected: "拒绝素材" }}
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger
                    className="w-full"
                    aria-invalid={Boolean(form.formState.errors.decision)}
                  >
                    <SelectValue placeholder="请选择审核决定" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="approved">批准素材</SelectItem>
                      <SelectItem value="rejected">拒绝素材</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[form.formState.errors.decision]} />
          </Field>
        ) : (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>撤销已批准素材</AlertTitle>
            <AlertDescription>
              撤销后该素材会立即退出 VideoReady。必须填写新证据和原因。
            </AlertDescription>
          </Alert>
        )}
        <Field data-invalid={Boolean(form.formState.errors.evidenceRef)}>
          <FieldLabel htmlFor={`media-review-evidence-${asset.id}`}>审核证据</FieldLabel>
          <Input
            id={`media-review-evidence-${asset.id}`}
            placeholder="evidence-media-review-001"
            {...form.register("evidenceRef")}
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
          <p>源证据：{asset.evidenceRef}</p>
          <p>权利证据：{asset.rights.rightsEvidenceRef}</p>
          {asset.rights.expiresAt ? (
            <p>授权到期：{formatRightsExpiry(asset.rights.expiresAt)}</p>
          ) : null}
          {asset.review.evidenceRef ? <p>审核证据：{asset.review.evidenceRef}</p> : null}
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
          <ReviewForm projectId={projectId} productId={productId} asset={asset} />
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
}: {
  projectId: string;
  productId: string;
  assets: ProductMediaAsset[];
  assessment: VideoReadyAssessment;
  canReview: boolean;
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
      <RegistrationForm projectId={projectId} productId={productId} />
      <div className="flex flex-col gap-3">
        {assets.length ? (
          assets.map((asset) => (
            <AssetCard
              key={asset.id}
              projectId={projectId}
              productId={productId}
              asset={asset}
              canReview={canReview}
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
