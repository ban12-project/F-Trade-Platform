"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2Icon, ShieldCheckIcon, XCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useId } from "react";
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
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { RadioGroup, RadioGroupChoice } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { initialProductActionState } from "@/lib/action-states";
import { decideProductCatalogReviewAction } from "@/lib/actions/products";
import { productReviewFormSchema } from "@/lib/product/agent-review-forms";
import { productApprovalBlockingFields } from "@/lib/product/blocking-fields";
import type { ProductEvidencePreview } from "@/lib/product/evidence-preview";
import { productBlockerLabel } from "@/lib/product/fact-labels";
import { productReviewValue } from "@/lib/product/field-review";
import type { ProductCatalogDetail } from "@/lib/products";
import type { EvidenceOption } from "@/lib/workspace/access";
import { recordStateLabels } from "@/lib/workspace/library-model";
import { useWorkspaceDirty } from "./dirty-state";
import { StaticEvidenceCombobox } from "./evidence-select";
import { ProductDraftForm } from "./product-draft-form";
import { EvidenceLibrary } from "./product-evidence-library";
import { ProductFieldReview } from "./product-field-review";

type ReviewValues = z.infer<typeof productReviewFormSchema>;

function stateLabel(state: string) {
  return recordStateLabels[state] ?? "状态待核对";
}

export function ProductReview({
  projectId,
  detail,
  canReview,
  canWrite,
  evidenceOptions,
  sourceDocuments,
}: {
  projectId: string;
  detail: ProductCatalogDetail;
  canReview: boolean;
  canWrite: boolean;
  evidenceOptions: EvidenceOption[];
  sourceDocuments: ProductEvidencePreview[];
}) {
  const router = useRouter();
  const idPrefix = useId();
  const fieldId = (name: string) => `${idPrefix}-${name}`;
  const [state, action, pending] = useActionState(
    decideProductCatalogReviewAction,
    initialProductActionState,
  );
  const form = useForm<ReviewValues>({
    resolver: zodResolver(productReviewFormSchema),
    shouldFocusError: false,
    defaultValues: {
      productId: detail.id,
      reviewedVersion: String(detail.version),
      approvalId: detail.approvalId ?? "",
      evidenceRef: "",
      notes: "",
    },
  });
  const busy = !form.formState.isReady || pending;
  useWorkspaceDirty(`${idPrefix}-product-review-${detail.id}`, form.formState.isDirty);
  useEffect(() => {
    if (state.status === "success") {
      form.reset(form.getValues());
      router.refresh();
    }
  }, [form, router, state.status]);
  function submit(values: ReviewValues) {
    if (busy) return;
    const data = new FormData();
    data.set("projectId", projectId);
    for (const [key, value] of Object.entries(values))
      if (value !== undefined) data.set(key, value);
    startTransition(() => action(data));
  }
  const facts = (["product", "specifications", "commercial"] as const).flatMap((section) =>
    Object.entries(detail.draft[section] ?? {}).map(([field, value]) => ({
      path: `${section}.${field}`,
      value: productReviewValue(value),
      evidence: detail.draft.field_evidence[`${section}.${field}`] ?? "",
    })),
  );
  const canDecide =
    canWrite &&
    canReview &&
    detail.state === "PRODUCT_REVIEW_REQUIRED" &&
    detail.approvalStatus === "pending";
  const approvalBlockers = productApprovalBlockingFields(detail.draft);
  const canApprove = approvalBlockers.length === 0;
  const revisionState = detail.state === "PRODUCT_REVISION_REQUIRED";
  const reviewState = detail.state === "PRODUCT_REVIEW_REQUIRED";
  const decision = form.watch("decision");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{stateLabel(detail.state)}</Badge>
        <Badge variant="outline">{detail.internalSku}</Badge>
        <Badge variant="outline">第 {detail.version} 版</Badge>
      </div>
      {approvalBlockers.length ? (
        <Alert>
          <AlertTitle>先补齐核实所需资料</AlertTitle>
          <AlertDescription>
            {approvalBlockers.map(productBlockerLabel).join("；")}
            {revisionState
              ? "。请在下方修订表单补齐信息与来源资料后重新送审。"
              : reviewState
                ? "。当前版本暂不能批准，请先在下方选择「退回产品信息」并填写退回备注；退回进入「待修订」状态后，页面会出现修订表单，补齐资料并重新送审后再批准。"
                : "。请在退回备注中明确需要补充的来源，资料编辑者修订后重新送审。"}
          </AlertDescription>
        </Alert>
      ) : detail.blockingFields.length ? (
        <Alert>
          <AlertTitle>请重点核实完整适配信息</AlertTitle>
          <AlertDescription>
            当前记录未填写 OE
            编号，但已具备完整适配信息（适用范围、车辆品牌、车型）及来源。若核实适配关系准确，可直接批准；若需补充
            OE 编号或其他资料，请先退回进入「待修订」状态。
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
      {canWrite && detail.state === "PRODUCT_REVISION_REQUIRED" ? (
        <div className="flex flex-col gap-4">
          <ProductDraftForm
            projectId={projectId}
            detail={detail}
            evidenceOptions={evidenceOptions}
          />
          <EvidenceLibrary projectId={projectId} evidenceOptions={evidenceOptions} />
        </div>
      ) : null}
      <ProductFieldReview
        key={`${detail.id}-${detail.version}`}
        productName={detail.productName}
        facts={facts}
        sources={sourceDocuments}
      />
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
            <p>未提供实物图片。后续内容可使用文字排版，不能以生成图补充产品信息。</p>
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
            <form
              id={fieldId("product-review")}
              aria-busy={busy}
              onSubmit={form.handleSubmit(submit, (errors) => {
                const first = (
                  ["decision", "imageConsistencyConfirmed", "evidenceRef", "notes"] as const
                ).find((name) => errors[name]);
                if (first) form.setFocus(first);
              })}
            >
              <FieldSet disabled={busy}>
                <FieldGroup>
                  <Field data-invalid={!!form.formState.errors.decision}>
                    <FieldTitle id={fieldId("product-review-decision-label")}>决定</FieldTitle>
                    <Controller
                      control={form.control}
                      name="decision"
                      render={({ field }) => (
                        <RadioGroup
                          id={fieldId("product-review-decision")}
                          disabled={busy}
                          aria-labelledby={fieldId("product-review-decision-label")}
                          aria-invalid={!!form.formState.errors.decision}
                          aria-describedby={
                            form.formState.errors.decision ? fieldId("decision-error") : undefined
                          }
                          value={field.value ?? null}
                          onValueChange={(value) => {
                            if (!value || (value === "approved" && !canApprove)) return;
                            field.onChange(value);
                          }}
                          className="grid gap-2 sm:grid-cols-2"
                        >
                          <RadioGroupChoice
                            value="approved"
                            disabled={!canApprove}
                            itemRef={canApprove ? field.ref : undefined}
                            onBlur={field.onBlur}
                          >
                            批准产品信息
                          </RadioGroupChoice>
                          <RadioGroupChoice
                            value="rejected"
                            itemRef={!canApprove ? field.ref : undefined}
                            onBlur={field.onBlur}
                          >
                            退回产品信息
                          </RadioGroupChoice>
                        </RadioGroup>
                      )}
                    />
                    {!canApprove ? (
                      <FieldDescription>
                        当前版本存在待补齐项，暂不可选择「批准产品信息」。请先选择「退回产品信息」进入「待修订」状态，再通过修订表单补齐资料。
                      </FieldDescription>
                    ) : null}
                    <FieldError
                      id={fieldId("decision-error")}
                      errors={[form.formState.errors.decision]}
                    />
                  </Field>
                  {detail.sourceImages.length ? (
                    <Controller
                      control={form.control}
                      name="imageConsistencyConfirmed"
                      render={({ field }) => (
                        <Field
                          orientation="horizontal"
                          className="items-center justify-between rounded-lg border border-input p-3"
                        >
                          <FieldContent>
                            <FieldLabel htmlFor={fieldId("product-image-confirmation")}>
                              图片一致性
                            </FieldLabel>
                            <FieldDescription>
                              已核对全部原始图片，与当前产品一致。批准前必须开启确认；无法确认时请退回并说明原因。
                            </FieldDescription>
                          </FieldContent>
                          <Switch
                            id={fieldId("product-image-confirmation")}
                            ref={field.ref}
                            onBlur={field.onBlur}
                            disabled={busy}
                            checked={field.value === "true"}
                            onCheckedChange={(checked) =>
                              field.onChange(checked ? "true" : "false")
                            }
                          />
                        </Field>
                      )}
                    />
                  ) : null}
                  <Field data-invalid={!!form.formState.errors.evidenceRef}>
                    <FieldLabel htmlFor={fieldId("product-review-evidence")}>审核依据</FieldLabel>
                    <Controller
                      control={form.control}
                      name="evidenceRef"
                      render={({ field }) => (
                        <StaticEvidenceCombobox
                          id={fieldId("product-review-evidence")}
                          options={evidenceOptions}
                          value={field.value ?? ""}
                          disabled={busy}
                          invalid={!!form.formState.errors.evidenceRef}
                          aria-describedby={
                            form.formState.errors.evidenceRef
                              ? fieldId("evidence-error")
                              : undefined
                          }
                          placeholder="搜索或选择审核依据"
                          onBlur={field.onBlur}
                          inputRef={field.ref}
                          onValueChange={(value) => field.onChange(value)}
                        />
                      )}
                    />
                    <FieldError
                      id={fieldId("evidence-error")}
                      errors={[form.formState.errors.evidenceRef]}
                    />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.notes}>
                    <FieldLabel htmlFor={fieldId("product-review-notes")}>
                      审核备注{decision === "rejected" ? "（必填）" : ""}
                    </FieldLabel>
                    <Textarea
                      id={fieldId("product-review-notes")}
                      aria-invalid={!!form.formState.errors.notes}
                      aria-describedby={
                        form.formState.errors.notes ? fieldId("notes-error") : undefined
                      }
                      {...form.register("notes")}
                    />
                    <FieldError
                      id={fieldId("notes-error")}
                      errors={[form.formState.errors.notes]}
                    />
                  </Field>
                </FieldGroup>
              </FieldSet>
            </form>
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-3">
            <Button
              form={fieldId("product-review")}
              type="submit"
              variant={decision === "rejected" ? "destructive" : "default"}
              className="w-full sm:w-auto sm:self-start"
              disabled={
                busy ||
                !decision ||
                (decision === "approved" && !canApprove) ||
                !evidenceOptions.length
              }
            >
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : decision === "approved" ? (
                <CheckCircle2Icon data-icon="inline-start" />
              ) : (
                <XCircleIcon data-icon="inline-start" />
              )}
              {decision === "approved"
                ? "批准产品信息"
                : decision === "rejected"
                  ? "退回产品信息"
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
          <AlertTitle>
            {canWrite && canReview ? "审核请求需要核对" : "等待审核者核实产品"}
          </AlertTitle>
          <AlertDescription>
            {canWrite && canReview
              ? "当前记录没有有效的待审请求，请核对记录状态。"
              : "由有产品审核权限的项目编辑者核对当前版本。"}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
