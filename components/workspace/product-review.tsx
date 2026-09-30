"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2Icon, ShieldCheckIcon, XCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect } from "react";
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import { Textarea } from "@/components/ui/textarea";
import { initialProductActionState } from "@/lib/action-states";
import { decideProductCatalogReviewAction } from "@/lib/actions/products";
import { productReviewFormSchema } from "@/lib/form-schemas";
import type { ProductEvidencePreview } from "@/lib/product/evidence-preview";
import { productBlockerLabel, productFactLabels } from "@/lib/product/fact-labels";
import type { ProductCatalogDetail } from "@/lib/products";
import type { EvidenceOption } from "@/lib/workspace/access";
import { recordStateLabels } from "@/lib/workspace/library-model";
import { useWorkspaceDirty } from "./dirty-state";
import { ProductDraftForm } from "./product-draft-form";
import { EvidenceLibrary } from "./product-evidence-library";
import { ProductEvidenceSources } from "./product-evidence-preview";

type ReviewValues = z.infer<typeof productReviewFormSchema>;

function stateLabel(state: string) {
  return recordStateLabels[state] ?? "状态待核对";
}

function textValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function ProductReview({
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
