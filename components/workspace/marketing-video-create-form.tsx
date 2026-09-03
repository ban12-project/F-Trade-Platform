"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { uploadPresigned } from "@vercel/blob/client";
import { FilmIcon, ImageIcon, PlusIcon, UploadCloudIcon, VideoIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { createMarketingVideoDraftAction } from "@/lib/actions/marketing-video";
import { initialMarketingVideoActionState } from "@/lib/action-states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { createMarketingVideoUiFormSchema } from "@/lib/video/edit-contracts";
import type { ReadyVideoProductMediaOption } from "@/lib/video/product-media-sources";
import type { ReadyVideoProductSource } from "@/lib/video/store";
import { maximumVideoUploadBatchBytes, shouldUseMultipartVideoUpload, videoPresignedUploadPayloadSchema, videoUploadBlobPath } from "@/lib/video/upload-contracts";
import { useWorkspaceDirty } from "./dirty-state";

type CreateValues = z.infer<typeof createMarketingVideoUiFormSchema>;
type VideoProduct = ReadyVideoProductSource & { mediaOptions?: ReadyVideoProductMediaOption[] };

const roleLabels: Record<ReadyVideoProductMediaOption["role"], string> = {
  product_hero: "产品主图",
  product_detail: "产品细节",
  packaging: "包装",
  factory: "工厂",
  inspection: "检测",
  application: "应用场景",
  other: "其他",
};

function dimensions(option: ReadyVideoProductMediaOption) {
  const duration = option.durationMs === null ? "" : ` · ${(option.durationMs / 1_000).toFixed(1)} 秒`;
  return `${option.width}×${option.height}${duration}`;
}

function initialMediaIds(product: VideoProduct | undefined) {
  return product?.mediaOptions?.[0] ? [product.mediaOptions[0].id] : [];
}

export function MarketingVideoCreateForm({ projectId, products }: { projectId: string; products: VideoProduct[] }) {
  const router = useRouter();
  const filesRef = useRef<HTMLInputElement>(null);
  const uploadProgressRef = useRef<number[]>([]);
  const [hasFiles, setHasFiles] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [state, action, pending] = useActionState(createMarketingVideoDraftAction, initialMarketingVideoActionState);
  const firstProduct = products[0];
  const firstHasMedia = Boolean(firstProduct?.mediaOptions?.length);
  const form = useForm<CreateValues>({
    resolver: zodResolver(createMarketingVideoUiFormSchema),
    defaultValues: {
      projectId,
      productId: firstProduct?.id ?? "",
      factPath: firstProduct?.factOptions[0]?.value ?? "",
      objective: "Create a concise product inquiry video",
      targetAudience: "Overseas automotive parts distributors",
      platform: "facebook",
      sourceMode: firstHasMedia ? "product_media" : "upload",
      productMediaIds: firstHasMedia ? initialMediaIds(firstProduct) : [],
      rightsEvidenceRef: "",
    },
  });
  const sourceMode = form.watch("sourceMode");
  const selectedProductId = form.watch("productId");
  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? firstProduct;
  const mediaOptions = selectedProduct?.mediaOptions ?? [];
  const selectedMediaIds = form.watch("productMediaIds");
  useWorkspaceDirty("video-create", form.formState.isDirty || hasFiles || uploading);

  useEffect(() => {
    if (state.status !== "success") return;
    form.reset(form.getValues());
    if (filesRef.current) filesRef.current.value = "";
    setHasFiles(false);
    setUploadProgress(0);
    router.refresh();
  }, [form, router, state.status]);

  function selectSourceMode(value: string[]) {
    const next = value[0] as CreateValues["sourceMode"] | undefined;
    if (!next) return;
    form.setValue("sourceMode", next, { shouldDirty: true, shouldValidate: true });
    setUploadError("");
    if (next === "product_media") {
      form.setValue("rightsEvidenceRef", "", { shouldDirty: true, shouldValidate: true });
      form.setValue("productMediaIds", initialMediaIds(selectedProduct), { shouldDirty: true, shouldValidate: true });
      if (filesRef.current) filesRef.current.value = "";
      setHasFiles(false);
    } else {
      form.setValue("productMediaIds", [], { shouldDirty: true, shouldValidate: true });
    }
  }

  function selectProduct(productId: string, onChange: (value: string) => void) {
    onChange(productId);
    const product = products.find((item) => item.id === productId);
    form.setValue("factPath", product?.factOptions[0]?.value ?? "", { shouldDirty: true, shouldValidate: true });
    if (sourceMode === "product_media") {
      if (product?.mediaOptions?.length) {
        form.setValue("productMediaIds", initialMediaIds(product), { shouldDirty: true, shouldValidate: true });
      } else {
        form.setValue("sourceMode", "upload", { shouldDirty: true, shouldValidate: true });
        form.setValue("productMediaIds", [], { shouldDirty: true, shouldValidate: true });
      }
    }
  }

  function creationData(values: CreateValues) {
    const data = new FormData();
    data.set("projectId", values.projectId);
    data.set("productId", values.productId);
    data.set("factPath", values.factPath);
    data.set("objective", values.objective);
    data.set("targetAudience", values.targetAudience);
    data.set("platform", values.platform);
    data.set("sourceMode", values.sourceMode);
    data.set("productMediaIds", JSON.stringify(values.productMediaIds));
    data.set("rightsEvidenceRef", values.rightsEvidenceRef);
    return data;
  }

  async function submit(values: CreateValues) {
    setUploadError("");
    const data = creationData(values);
    if (values.sourceMode === "product_media") {
      startTransition(() => action(data));
      return;
    }

    const files = [...(filesRef.current?.files ?? [])];
    if (files.length < 1 || files.length > 3) {
      setUploadError("请选择 1–3 个营销素材。");
      return;
    }
    if (files.reduce((total, file) => total + file.size, 0) > maximumVideoUploadBatchBytes) {
      setUploadError("一次素材总计必须小于 3GB。");
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    uploadProgressRef.current = files.map(() => 0);
    const receiptIds: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
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
          onUploadProgress: ({ percentage }) => {
            uploadProgressRef.current[index] = percentage;
            setUploadProgress(uploadProgressRef.current.reduce((total, current) => total + current, 0) / files.length);
          },
        });
        receiptIds.push(receiptId);
      }
      data.set("receiptIds", JSON.stringify(receiptIds));
      startTransition(() => action(data));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "无法上传营销素材。");
    } finally {
      setUploading(false);
    }
  }

  if (!products.length) {
    return <Alert><AlertTitle>需要已核验产品</AlertTitle><AlertDescription>先在“产品资料”节点完成产品事实审核，再创建营销视频。</AlertDescription></Alert>;
  }

  const busy = pending || uploading;
  return <Card>
    <CardHeader>
      <CardTitle>新建 15 秒剪辑</CardTitle>
      <CardDescription>优先复用已审核产品媒体；也可以上传一次性素材。两种方式都不会调用视频生成模型。</CardDescription>
    </CardHeader>
    <CardContent>
      <form id="create-marketing-video" onSubmit={form.handleSubmit(submit)}>
        <FieldGroup>
          <Field>
            <FieldLabel>素材来源</FieldLabel>
            <Controller control={form.control} name="sourceMode" render={({ field }) => <ToggleGroup value={[field.value]} onValueChange={selectSourceMode} variant="outline" className="grid grid-cols-2">
              <ToggleGroupItem value="product_media" disabled={!mediaOptions.length}><FilmIcon />复用产品媒体</ToggleGroupItem>
              <ToggleGroupItem value="upload"><UploadCloudIcon />上传新素材</ToggleGroupItem>
            </ToggleGroup>} />
            <FieldDescription>{mediaOptions.length ? `当前产品有 ${mediaOptions.length} 个可复用媒体。` : "当前产品没有审核通过且仍在授权期内的可复用媒体。"}</FieldDescription>
          </Field>
          <Field data-invalid={Boolean(form.formState.errors.productId)}>
            <FieldLabel>已核验产品</FieldLabel>
            <Controller control={form.control} name="productId" render={({ field }) => <Select items={Object.fromEntries(products.map((product) => [product.id, `${product.productName} · ${product.internalSku}`]))} value={field.value} onValueChange={(value) => selectProduct(value, field.onChange)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{products.map((product) => <SelectItem key={product.id} value={product.id}>{product.productName} · {product.internalSku}</SelectItem>)}</SelectGroup></Select>} />
            <FieldError>{form.formState.errors.productId?.message}</FieldError>
          </Field>
          <Field data-invalid={Boolean(form.formState.errors.factPath)}>
            <FieldLabel>字幕可引用的事实</FieldLabel>
            <Controller control={form.control} name="factPath" render={({ field }) => <Select items={Object.fromEntries((selectedProduct?.factOptions ?? []).map((fact) => [fact.value, fact.label]))} value={field.value} onValueChange={field.onChange}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{selectedProduct?.factOptions.map((fact) => <SelectItem key={fact.value} value={fact.value}>{fact.label}</SelectItem>)}</SelectGroup></Select>} />
            <FieldError>{form.formState.errors.factPath?.message}</FieldError>
          </Field>
          <Field data-invalid={Boolean(form.formState.errors.objective)}><FieldLabel htmlFor="video-objective">视频目标</FieldLabel><Input id="video-objective" aria-invalid={Boolean(form.formState.errors.objective)} {...form.register("objective")} /><FieldError>{form.formState.errors.objective?.message}</FieldError></Field>
          <Field data-invalid={Boolean(form.formState.errors.targetAudience)}><FieldLabel htmlFor="video-audience">目标受众</FieldLabel><Input id="video-audience" aria-invalid={Boolean(form.formState.errors.targetAudience)} {...form.register("targetAudience")} /><FieldError>{form.formState.errors.targetAudience?.message}</FieldError></Field>
          <Field><FieldLabel>输出平台</FieldLabel><Controller control={form.control} name="platform" render={({ field }) => <ToggleGroup value={[field.value]} onValueChange={(value) => value[0] && field.onChange(value[0])} variant="outline" className="flex-wrap"><ToggleGroupItem value="facebook">Facebook</ToggleGroupItem><ToggleGroupItem value="instagram">Instagram</ToggleGroupItem><ToggleGroupItem value="tiktok">TikTok</ToggleGroupItem><ToggleGroupItem value="youtube">YouTube</ToggleGroupItem><ToggleGroupItem value="x">X</ToggleGroupItem></ToggleGroup>} /></Field>

          {sourceMode === "product_media" ? <FieldSet>
            <FieldLegend>可复用产品媒体（1–3 个）</FieldLegend>
            <FieldDescription>这里只显示已审核、未过期并允许剪辑和公开发布的素材；提交时服务端仍会重新锁定并校验。</FieldDescription>
            <Controller control={form.control} name="productMediaIds" render={({ field }) => <FieldGroup>
              {mediaOptions.map((option) => {
                const checked = field.value.includes(option.id);
                const disabled = !checked && field.value.length >= 3;
                return <Field key={option.id} orientation="horizontal" data-invalid={Boolean(form.formState.errors.productMediaIds)}>
                  <Checkbox
                    id={`video-product-media-${option.id}`}
                    checked={checked}
                    disabled={disabled || busy}
                    onCheckedChange={(next) => {
                      const ids = next ? [...field.value, option.id] : field.value.filter((id) => id !== option.id);
                      field.onChange(ids);
                    }}
                  />
                  <FieldLabel htmlFor={`video-product-media-${option.id}`} className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2"><span>{roleLabels[option.role]}</span><Badge variant="outline">{option.mediaType === "image" ? <ImageIcon /> : <VideoIcon />}{dimensions(option)}</Badge></span>
                    {option.description ? <span className="mt-1 block text-xs text-muted-foreground">{option.description}</span> : null}
                  </FieldLabel>
                </Field>;
              })}
              <FieldError>{form.formState.errors.productMediaIds?.message}</FieldError>
            </FieldGroup>} />
          </FieldSet> : <>
            <Field><FieldLabel htmlFor="video-assets">素材（1–3 个）</FieldLabel><Input ref={filesRef} id="video-assets" name="assets" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple required disabled={busy} onChange={(event) => { setHasFiles(Boolean(event.target.files?.length)); setUploadError(""); }} /><FieldDescription>素材以精确路径预签名 URL 直传私有 Blob；超过 100MB 自动分片。图片不超过 20MB，视频必须小于 1GB，源视频最长 120 秒。</FieldDescription></Field>
            <Field data-invalid={Boolean(form.formState.errors.rightsEvidenceRef)}><FieldLabel htmlFor="video-rights">素材权利证据</FieldLabel><Input id="video-rights" placeholder="evidence-rights-001" aria-invalid={Boolean(form.formState.errors.rightsEvidenceRef)} {...form.register("rightsEvidenceRef")} /><FieldError>{form.formState.errors.rightsEvidenceRef?.message}</FieldError></Field>
          </>}
          {uploading ? <Progress aria-label="素材上传进度" value={uploadProgress}><ProgressLabel>私有上传</ProgressLabel><ProgressValue>{() => `${Math.round(uploadProgress)}%`}</ProgressValue></Progress> : null}
        </FieldGroup>
      </form>
    </CardContent>
    <CardFooter className="flex-col items-stretch gap-3">
      <Button form="create-marketing-video" type="submit" disabled={busy}>
        <PlusIcon data-icon="inline-start" />
        {uploading ? "正在直传素材…" : pending ? "正在创建剪辑稿…" : sourceMode === "product_media" ? "复用媒体并生成 AI 初稿" : "上传并生成 AI 初稿"}
      </Button>
      {uploadError ? <p className="text-sm text-destructive" aria-live="polite">{uploadError}</p> : null}
      {state.message ? <p className={state.status === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"} aria-live="polite">{state.message}</p> : null}
    </CardFooter>
  </Card>;
}
