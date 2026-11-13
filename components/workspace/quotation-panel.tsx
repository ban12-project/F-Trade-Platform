"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { HandCoinsIcon, SendIcon, ShieldCheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
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
import { initialClosingActionState } from "@/lib/action-states";
import {
  decideQuotationAction,
  saveQuotationAction,
  sendQuotationAction,
} from "@/lib/actions/closing";
import {
  quotationDecisionFormSchema,
  quotationDraftFormSchema,
  quotationSendFormSchema,
} from "@/lib/form-schemas";
import { rfqCustomerRequirements } from "@/lib/rfq/customer-requirements";
import type { QuotationEntry } from "@/lib/sales/closing-store";
import { productTypeLabel } from "@/lib/sales/journey";
import type { RfqEntry } from "@/lib/sales/store";
import { workspaceCreateHref, workspaceRecordHref } from "@/lib/workspace/navigation";
import type { WorkspaceProductReference } from "@/lib/workspace/types";
import { ApprovedQuotationPreview } from "./approved-quotation-preview";
import { useWorkspaceDirty } from "./dirty-state";
import { EvidenceSelectField } from "./evidence-select";
import {
  SubmissionFeedback as Message,
  salesRecordStateLabel as stateLabel,
} from "./submission-feedback";
import { useCreatedRecord } from "./use-created-record";
import { WorkspaceLink } from "./workspace-link";

type QuoteValues = z.infer<typeof quotationDraftFormSchema>;
function QuotationForm({
  projectId,
  rfqs,
  products,
  entry,
}: {
  projectId: string;
  rfqs: RfqEntry[];
  products: WorkspaceProductReference[];
  entry?: QuotationEntry;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveQuotationAction, initialClosingActionState);
  const form = useForm<QuoteValues>({
    resolver: zodResolver(quotationDraftFormSchema),
    defaultValues: entry
      ? {
          projectId,
          quotationId: entry.id,
          evidenceRef: "",
          rfqId: entry.quotation.rfq_id,
          productId: entry.productId,
          unitPrice: String(entry.quotation.quote.unit_price),
          currency: entry.quotation.quote.currency,
          moq: String(entry.quotation.quote.moq),
          leadTimeDays: String(entry.quotation.quote.lead_time_days),
          paymentTerms: entry.quotation.quote.payment_terms,
          validityDays: String(entry.quotation.quote.validity_days),
          validityStart: entry.quotation.quote.validity?.starts_on ?? "",
          validityEnd: entry.quotation.quote.validity?.expires_on ?? "",
          validityTimeZone: entry.quotation.quote.validity?.time_zone ?? "",
        }
      : {
          projectId,
          quotationId: "",
          evidenceRef: "",
          rfqId: rfqs.length === 1 ? rfqs[0].id : "",
          productId: products.length === 1 ? products[0].id : "",
          unitPrice: "",
          currency: "USD",
          moq: "",
          leadTimeDays: "",
          paymentTerms: "",
          validityDays: "30",
          validityStart: "",
          validityEnd: "",
          validityTimeZone: "",
        },
  });
  const selectedRfqId = useWatch({ control: form.control, name: "rfqId" });
  const selectedRfq = rfqs.find((rfq) => rfq.id === selectedRfqId);
  useWorkspaceDirty(`quotation-${entry?.id ?? "new"}`, form.formState.isDirty);
  useEffect(() => {
    if (state.status === "success") {
      form.reset(form.getValues());
      router.refresh();
    }
  }, [form, router, state]);
  useCreatedRecord(projectId, "quotation", state.status, state.id, !entry);
  function submit(value: QuoteValues) {
    const data = new FormData();
    for (const [key, item] of Object.entries(value)) data.set(key, item ?? "");
    startTransition(() => action(data));
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{entry ? "修订人工报价" : "创建人工报价"}</CardTitle>
        <CardDescription>
          价格、MOQ、交期、付款和有效期均由当前用户填写；AI 不生成这些工程或商业事实。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id={`quotation-${entry?.id ?? "new"}`}
          aria-busy={!form.formState.isReady || pending}
          onSubmit={form.handleSubmit(submit)}
        >
          <FieldSet disabled={!form.formState.isReady || pending} className="min-w-0">
            <FieldGroup>
              <Field data-invalid={!!form.formState.errors.rfqId}>
                <FieldLabel htmlFor={`quotation-rfq-${entry?.id ?? "new"}`}>客户需求</FieldLabel>
                <Controller
                  control={form.control}
                  name="rfqId"
                  render={({ field }) => (
                    <Select
                      disabled={Boolean(entry) || rfqs.length === 1}
                      items={Object.fromEntries(
                        rfqs.map((item) => [
                          item.id,
                          `${item.formValues.customerName || productTypeLabel(item.productType)} · ${item.quantity ?? "数量待补"}`,
                        ]),
                      )}
                      value={field.value ?? null}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger
                        aria-invalid={!!form.formState.errors.rfqId}
                        aria-describedby={
                          form.formState.errors.rfqId
                            ? `quotation-${entry?.id ?? "new"}-rfqId-error`
                            : undefined
                        }
                        id={`quotation-rfq-${entry?.id ?? "new"}`}
                        className="w-full"
                      >
                        <SelectValue placeholder="选择已确认需求" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {rfqs.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.formValues.customerName || productTypeLabel(item.productType)} ·{" "}
                              {item.quantity}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError
                  id={`quotation-${entry?.id ?? "new"}-rfqId-error`}
                  errors={[form.formState.errors.rfqId]}
                />
              </Field>
              {selectedRfq ? (
                <FieldSet>
                  <FieldLegend>所选客户需求</FieldLegend>
                  <FieldDescription>
                    以下是客户要求，不代表已核实产品信息或工厂承诺。请核对后填写报价。
                  </FieldDescription>
                  <dl className="grid gap-3 text-sm">
                    {[
                      ["产品类型", productTypeLabel(selectedRfq.productType)],
                      ["OE / OEM 编号", selectedRfq.formValues.oeNumber],
                      [
                        "车辆品牌与车型",
                        `${selectedRfq.formValues.vehicleBrand} ${selectedRfq.formValues.vehicleModel}`.trim(),
                      ],
                      ["数量", selectedRfq.quantity === null ? "" : String(selectedRfq.quantity)],
                      ["目的地", selectedRfq.destination],
                      ...rfqCustomerRequirements.map(({ field, label }) => [
                        label,
                        selectedRfq.formValues[field],
                      ]),
                    ].map(([label, value]) =>
                      value ? (
                        <div key={label} className="grid gap-1">
                          <dt className="text-muted-foreground">{label}</dt>
                          <dd className="whitespace-pre-wrap break-words">{value}</dd>
                        </div>
                      ) : null,
                    )}
                  </dl>
                  <WorkspaceLink href={workspaceRecordHref(projectId, "rfq", selectedRfq.id)}>
                    查看完整询盘
                  </WorkspaceLink>
                </FieldSet>
              ) : null}
              <Field data-invalid={!!form.formState.errors.productId}>
                <FieldLabel htmlFor={`quotation-product-${entry?.id ?? "new"}`}>
                  报价产品
                </FieldLabel>
                <Controller
                  control={form.control}
                  name="productId"
                  render={({ field }) => (
                    <Select
                      items={Object.fromEntries(
                        products.map((item) => [
                          item.id,
                          `${item.internalSku} · ${item.productName}`,
                        ]),
                      )}
                      value={field.value ?? null}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger
                        aria-invalid={!!form.formState.errors.productId}
                        aria-describedby={
                          form.formState.errors.productId
                            ? `quotation-${entry?.id ?? "new"}-productId-error`
                            : undefined
                        }
                        id={`quotation-product-${entry?.id ?? "new"}`}
                        className="w-full"
                      >
                        <SelectValue placeholder="选择已核验产品" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {products.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.internalSku} · {item.productName}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError
                  id={`quotation-${entry?.id ?? "new"}-productId-error`}
                  errors={[form.formState.errors.productId]}
                />
              </Field>
              <FieldSet>
                <FieldLegend>人工商业条款</FieldLegend>
                <FieldGroup>
                  <Field data-invalid={!!form.formState.errors.unitPrice}>
                    <FieldLabel htmlFor={`price-${entry?.id ?? "new"}`}>单价</FieldLabel>
                    <Input
                      id={`price-${entry?.id ?? "new"}`}
                      inputMode="decimal"
                      aria-invalid={!!form.formState.errors.unitPrice}
                      aria-describedby={
                        form.formState.errors.unitPrice
                          ? `quotation-${entry?.id ?? "new"}-unitPrice-error`
                          : undefined
                      }
                      {...form.register("unitPrice")}
                    />
                    <FieldError
                      id={`quotation-${entry?.id ?? "new"}-unitPrice-error`}
                      errors={[form.formState.errors.unitPrice]}
                    />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.currency}>
                    <FieldLabel htmlFor={`currency-${entry?.id ?? "new"}`}>币种</FieldLabel>
                    <Input
                      id={`currency-${entry?.id ?? "new"}`}
                      maxLength={3}
                      {...form.register("currency")}
                      aria-invalid={!!form.formState.errors.currency}
                      aria-describedby={
                        form.formState.errors.currency
                          ? `quotation-${entry?.id ?? "new"}-currency-error`
                          : undefined
                      }
                    />
                    <FieldError
                      id={`quotation-${entry?.id ?? "new"}-currency-error`}
                      errors={[form.formState.errors.currency]}
                    />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.moq}>
                    <FieldLabel htmlFor={`moq-${entry?.id ?? "new"}`}>最小起订量（MOQ）</FieldLabel>
                    <Input
                      id={`moq-${entry?.id ?? "new"}`}
                      inputMode="numeric"
                      {...form.register("moq")}
                      aria-invalid={!!form.formState.errors.moq}
                      aria-describedby={
                        form.formState.errors.moq
                          ? `quotation-${entry?.id ?? "new"}-moq-error`
                          : undefined
                      }
                    />
                    <FieldError
                      id={`quotation-${entry?.id ?? "new"}-moq-error`}
                      errors={[form.formState.errors.moq]}
                    />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.leadTimeDays}>
                    <FieldLabel htmlFor={`lead-time-${entry?.id ?? "new"}`}>交期（天）</FieldLabel>
                    <Input
                      id={`lead-time-${entry?.id ?? "new"}`}
                      inputMode="numeric"
                      {...form.register("leadTimeDays")}
                      aria-invalid={!!form.formState.errors.leadTimeDays}
                      aria-describedby={
                        form.formState.errors.leadTimeDays
                          ? `quotation-${entry?.id ?? "new"}-leadTimeDays-error`
                          : undefined
                      }
                    />
                    <FieldError
                      id={`quotation-${entry?.id ?? "new"}-leadTimeDays-error`}
                      errors={[form.formState.errors.leadTimeDays]}
                    />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.paymentTerms}>
                    <FieldLabel htmlFor={`terms-${entry?.id ?? "new"}`}>付款条件</FieldLabel>
                    <Textarea
                      id={`terms-${entry?.id ?? "new"}`}
                      rows={3}
                      {...form.register("paymentTerms")}
                      aria-invalid={!!form.formState.errors.paymentTerms}
                      aria-describedby={
                        form.formState.errors.paymentTerms
                          ? `quotation-${entry?.id ?? "new"}-paymentTerms-error`
                          : undefined
                      }
                    />
                    <FieldError
                      id={`quotation-${entry?.id ?? "new"}-paymentTerms-error`}
                      errors={[form.formState.errors.paymentTerms]}
                    />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.evidenceRef}>
                    <FieldLabel htmlFor={`quotation-source-${entry?.id ?? "new"}`}>
                      报价依据
                    </FieldLabel>
                    <EvidenceSelectField
                      projectId={projectId}
                      control={form.control}
                      name="evidenceRef"
                      aria-describedby={
                        form.formState.errors.evidenceRef
                          ? `quotation-${entry?.id ?? "new"}-evidenceRef-error`
                          : undefined
                      }
                      id={`quotation-source-${entry?.id ?? "new"}`}
                    />
                    <FieldDescription>
                      选择支持本次价格和交易条件的资料；修改报价时请重新选择。
                    </FieldDescription>
                    <FieldError
                      id={`quotation-${entry?.id ?? "new"}-evidenceRef-error`}
                      errors={[form.formState.errors.evidenceRef]}
                    />
                  </Field>
                  <FieldDescription id={`validity-help-${entry?.id ?? "new"}`}>
                    可补充人工确认的起止日期和时区；三项须一起填写，首尾日期均计入有效天数。留空表示日期尚未记录，不会自动推算。
                  </FieldDescription>
                  <Field data-invalid={!!form.formState.errors.validityStart}>
                    <FieldLabel htmlFor={`validityStart-${entry?.id ?? "new"}`}>
                      有效期起算日
                    </FieldLabel>
                    <Input
                      id={`validityStart-${entry?.id ?? "new"}`}
                      type="date"
                      {...form.register("validityStart")}
                      aria-invalid={!!form.formState.errors.validityStart}
                      aria-describedby={[
                        `validity-help-${entry?.id ?? "new"}`,
                        form.formState.errors.validityStart
                          ? `validityStart-error-${entry?.id ?? "new"}`
                          : undefined,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    />
                    <FieldError
                      id={`validityStart-error-${entry?.id ?? "new"}`}
                      errors={[form.formState.errors.validityStart]}
                    />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.validityEnd}>
                    <FieldLabel htmlFor={`validityEnd-${entry?.id ?? "new"}`}>
                      有效期截止日
                    </FieldLabel>
                    <Input
                      id={`validityEnd-${entry?.id ?? "new"}`}
                      type="date"
                      {...form.register("validityEnd")}
                      aria-invalid={!!form.formState.errors.validityEnd}
                      aria-describedby={[
                        `validity-help-${entry?.id ?? "new"}`,
                        form.formState.errors.validityEnd
                          ? `validityEnd-error-${entry?.id ?? "new"}`
                          : undefined,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    />
                    <FieldError
                      id={`validityEnd-error-${entry?.id ?? "new"}`}
                      errors={[form.formState.errors.validityEnd]}
                    />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.validityTimeZone}>
                    <FieldLabel htmlFor={`validityTimeZone-${entry?.id ?? "new"}`}>
                      有效期适用时区
                    </FieldLabel>
                    <Input
                      id={`validityTimeZone-${entry?.id ?? "new"}`}
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      {...form.register("validityTimeZone")}
                      aria-invalid={!!form.formState.errors.validityTimeZone}
                      aria-describedby={[
                        `validity-help-${entry?.id ?? "new"}`,
                        `validity-zone-help-${entry?.id ?? "new"}`,
                        form.formState.errors.validityTimeZone
                          ? `validityTimeZone-error-${entry?.id ?? "new"}`
                          : undefined,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    />
                    <FieldDescription id={`validity-zone-help-${entry?.id ?? "new"}`}>
                      填写双方确认的时区标识，例如 Asia/Shanghai 或
                      America/New_York；不会使用浏览器时区自动填写。
                    </FieldDescription>
                    <FieldError
                      id={`validityTimeZone-error-${entry?.id ?? "new"}`}
                      errors={[form.formState.errors.validityTimeZone]}
                    />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.validityDays}>
                    <FieldLabel htmlFor={`validity-${entry?.id ?? "new"}`}>有效期（天）</FieldLabel>
                    <Input
                      id={`validity-${entry?.id ?? "new"}`}
                      inputMode="numeric"
                      {...form.register("validityDays")}
                      aria-invalid={!!form.formState.errors.validityDays}
                      aria-describedby={[
                        `validity-help-${entry?.id ?? "new"}`,
                        form.formState.errors.validityDays
                          ? `validityDays-error-${entry?.id ?? "new"}`
                          : undefined,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    />
                    <FieldError
                      id={`validityDays-error-${entry?.id ?? "new"}`}
                      errors={[form.formState.errors.validityDays]}
                    />
                  </Field>
                </FieldGroup>
              </FieldSet>
            </FieldGroup>
          </FieldSet>
        </form>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3">
        <Button
          form={`quotation-${entry?.id ?? "new"}`}
          type="submit"
          disabled={!form.formState.isReady || pending || !rfqs.length || !products.length}
        >
          {pending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <HandCoinsIcon data-icon="inline-start" />
          )}
          {entry ? "提交修订并再次送审" : "创建报价并提交审核"}
        </Button>
        <Message {...state} />
        {state.status === "success" && state.id && !entry ? (
          <WorkspaceLink
            href={workspaceRecordHref(projectId, "quotation", state.id)}
            className={buttonVariants({ variant: "outline" })}
          >
            打开人工报价
          </WorkspaceLink>
        ) : null}
      </CardFooter>
    </Card>
  );
}

function QuoteDecision({ projectId, entry }: { projectId: string; entry: QuotationEntry }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(decideQuotationAction, initialClosingActionState);
  const form = useForm<z.infer<typeof quotationDecisionFormSchema>>({
    resolver: zodResolver(quotationDecisionFormSchema),
    shouldFocusError: false,
    defaultValues: {
      projectId,
      quotationId: entry.id,
      reviewedVersion: String(entry.version),
      approvalId: entry.approvalId ?? "",
      evidenceRef: "",
      notes: "",
    },
  });
  const busy = !form.formState.isReady || pending;
  useWorkspaceDirty(`quote-decision-${entry.id}`, form.formState.isDirty);
  useEffect(() => {
    if (state.status === "success") {
      form.reset(form.getValues());
      router.refresh();
    }
  }, [form, router, state]);
  function submit(value: z.infer<typeof quotationDecisionFormSchema>) {
    if (busy) return;
    const data = new FormData();
    for (const [key, item] of Object.entries(value)) data.set(key, item ?? "");
    startTransition(() => action(data));
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>人工报价审核</CardTitle>
        <CardDescription>
          审核版本 {entry.version}。请核对全部人工商业条款，系统不会预选批准。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          aria-busy={busy}
          id={`quote-decision-${entry.id}`}
          onSubmit={form.handleSubmit(submit, (errors) => {
            const first = (["decision", "evidenceRef", "notes"] as const).find(
              (name) => errors[name],
            );
            if (first) form.setFocus(first);
          })}
        >
          <FieldSet disabled={busy} className="min-w-0">
            <FieldGroup>
              <Field data-invalid={!!form.formState.errors.decision}>
                <FieldLabel htmlFor={`quote-decision-${entry.id}-decision`}>决定</FieldLabel>
                <Controller
                  control={form.control}
                  name="decision"
                  render={({ field }) => (
                    <Select
                      disabled={busy}
                      items={{ approved: "批准人工报价", rejected: "退回人工报价" }}
                      value={field.value ?? null}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger
                        ref={field.ref}
                        onBlur={field.onBlur}
                        aria-invalid={!!form.formState.errors.decision}
                        aria-describedby={
                          form.formState.errors.decision
                            ? `closing-review-${entry.id}-decision-error`
                            : undefined
                        }
                        id={`quote-decision-${entry.id}-decision`}
                        className="w-full"
                      >
                        <SelectValue placeholder="请选择审核决定" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="approved">批准人工报价</SelectItem>
                          <SelectItem value="rejected">退回人工报价</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError
                  id={`closing-review-${entry.id}-decision-error`}
                  errors={[form.formState.errors.decision]}
                />
              </Field>
              <Field data-invalid={!!form.formState.errors.evidenceRef}>
                <FieldLabel htmlFor={`quote-evidence-${entry.id}`}>审核依据</FieldLabel>
                <EvidenceSelectField
                  projectId={projectId}
                  control={form.control}
                  name="evidenceRef"
                  disabled={busy}
                  aria-describedby={
                    form.formState.errors.evidenceRef
                      ? `closing-review-${entry.id}-evidenceRef-error`
                      : undefined
                  }
                  id={`quote-evidence-${entry.id}`}
                />
                <FieldError
                  id={`closing-review-${entry.id}-evidenceRef-error`}
                  errors={[form.formState.errors.evidenceRef]}
                />
              </Field>
              <Field data-invalid={!!form.formState.errors.notes}>
                <FieldLabel htmlFor={`quote-notes-${entry.id}`}>
                  备注{form.watch("decision") === "rejected" ? "（必填）" : ""}
                </FieldLabel>
                <Textarea
                  id={`quote-notes-${entry.id}`}
                  {...form.register("notes")}
                  aria-invalid={!!form.formState.errors.notes}
                  aria-describedby={
                    form.formState.errors.notes
                      ? `closing-review-${entry.id}-notes-error`
                      : undefined
                  }
                />
                <FieldError
                  id={`closing-review-${entry.id}-notes-error`}
                  errors={[form.formState.errors.notes]}
                />
              </Field>
            </FieldGroup>
          </FieldSet>
        </form>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3">
        <Button
          form={`quote-decision-${entry.id}`}
          type="submit"
          variant={form.watch("decision") === "rejected" ? "destructive" : "default"}
          disabled={busy || !form.watch("decision")}
        >
          {pending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ShieldCheckIcon data-icon="inline-start" />
          )}
          {form.watch("decision") === "approved"
            ? "批准人工报价"
            : form.watch("decision") === "rejected"
              ? "退回人工报价"
              : "请先选择决定"}
        </Button>
        <Message {...state} />
      </CardFooter>
    </Card>
  );
}

function QuoteSend({ projectId, entry }: { projectId: string; entry: QuotationEntry }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(sendQuotationAction, initialClosingActionState);
  const form = useForm<z.infer<typeof quotationSendFormSchema>>({
    resolver: zodResolver(quotationSendFormSchema),
    defaultValues: { projectId, quotationId: entry.id, channelRef: "", externalRef: "" },
  });
  const busy = !form.formState.isReady || pending;
  useWorkspaceDirty(`quote-send-${entry.id}`, form.formState.isDirty);
  useEffect(() => {
    if (state.status === "success") {
      form.reset(form.getValues());
      router.refresh();
    }
  }, [form, router, state]);
  function submit(value: z.infer<typeof quotationSendFormSchema>) {
    if (busy) return;
    const data = new FormData();
    for (const [key, item] of Object.entries(value)) data.set(key, item ?? "");
    startTransition(() => action(data));
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>登记报价已发送</CardTitle>
        <CardDescription>
          请先发送报价，再填写发送渠道和平台消息编号或回执链接，登记发送结果。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form aria-busy={busy} id={`quote-send-${entry.id}`} onSubmit={form.handleSubmit(submit)}>
          <FieldSet disabled={busy} className="min-w-0">
            <FieldGroup>
              <Field data-invalid={!!form.formState.errors.channelRef}>
                <FieldLabel htmlFor={`send-channel-${entry.id}`}>发送渠道</FieldLabel>
                <Input
                  id={`send-channel-${entry.id}`}
                  placeholder="例如 WhatsApp 或电子邮件"
                  {...form.register("channelRef")}
                  aria-invalid={!!form.formState.errors.channelRef}
                />
                <FieldError errors={[form.formState.errors.channelRef]} />
              </Field>
              <Field data-invalid={!!form.formState.errors.externalRef}>
                <FieldLabel htmlFor={`send-ref-${entry.id}`}>平台消息编号或回执链接</FieldLabel>
                <Input
                  id={`send-ref-${entry.id}`}
                  placeholder="填写发送记录中的消息编号或回执链接"
                  {...form.register("externalRef")}
                  aria-invalid={!!form.formState.errors.externalRef}
                />
                <FieldError errors={[form.formState.errors.externalRef]} />
              </Field>
            </FieldGroup>
          </FieldSet>
        </form>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3">
        <Button form={`quote-send-${entry.id}`} type="submit" disabled={busy}>
          {pending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
          核验凭证并登记已发送
        </Button>
        <Message {...state} />
        {state.status === "success" && state.id ? (
          <WorkspaceLink
            href={workspaceRecordHref(projectId, "lead", state.id)}
            className={buttonVariants({ variant: "outline" })}
          >
            继续客户跟进
          </WorkspaceLink>
        ) : null}
      </CardFooter>
    </Card>
  );
}

export function QuotationPanel({
  projectId,
  rfqs,
  products,
  entries,
  canReview,
  showCreateForm = true,
  collection = false,
}: {
  projectId: string;
  rfqs: RfqEntry[];
  products: WorkspaceProductReference[];
  entries: QuotationEntry[];
  canReview: boolean;
  showCreateForm?: boolean;
  collection?: boolean;
}) {
  const ready = rfqs.filter((entry) => entry.state === "RFQ_READY");
  if (collection && entries.length)
    return (
      <Card>
        <CardHeader>
          <CardTitle>人工报价</CardTitle>
          <CardDescription>选择对应客户的报价继续处理。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {entries.map((entry) => (
            <WorkspaceLink
              key={entry.id}
              href={workspaceRecordHref(projectId, "quotation", entry.id)}
              className={buttonVariants({
                variant: "outline",
                className: "h-auto justify-start whitespace-normal py-3",
              })}
            >
              {entry.quotation.quote.currency} {entry.quotation.quote.unit_price} ·{" "}
              {stateLabel(entry.state)} · {entry.id.slice(0, 8)}
            </WorkspaceLink>
          ))}
        </CardContent>
        <CardFooter>
          <WorkspaceLink
            href={workspaceCreateHref(projectId, "quotation")}
            className={buttonVariants({})}
          >
            创建人工报价
          </WorkspaceLink>
        </CardFooter>
      </Card>
    );
  return (
    <div className="flex flex-col gap-4">
      {showCreateForm ? (
        ready.length && products.length ? (
          <QuotationForm key="new" projectId={projectId} rfqs={ready} products={products} />
        ) : (
          <Alert>
            <AlertTitle>
              {!ready.length && !products.length
                ? "先准备客户需求与报价产品"
                : !ready.length
                  ? "先确认客户需求"
                  : "先添加报价产品"}
            </AlertTitle>
            <AlertDescription>
              {!ready.length ? <p>客户需求确认完整后，才能填写正式报价。</p> : null}
              {!products.length ? (
                <p>
                  请在“添加已有产品”中关联已核实产品；若没有可添加产品，请先前往产品资料库完成资料核实。
                </p>
              ) : null}
            </AlertDescription>
            {!ready.length ? (
              <WorkspaceLink
                href={`/workspace/customers?project=${projectId}`}
                className={buttonVariants({ variant: "outline" })}
              >
                查看客户需求
              </WorkspaceLink>
            ) : null}
          </Alert>
        )
      ) : null}
      {entries.map((entry) => (
        <div key={entry.id} className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap justify-between gap-2">
                <CardTitle>
                  {entry.quotation.quote.currency} {entry.quotation.quote.unit_price}
                </CardTitle>
                <Badge variant="outline">
                  {stateLabel(entry.state)} · 版本 {entry.version}
                </Badge>
              </div>
              <CardDescription>
                MOQ {entry.quotation.quote.moq} · 交期 {entry.quotation.quote.lead_time_days} 天 ·
                有效 {entry.quotation.quote.validity_days} 天
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm">付款条件：{entry.quotation.quote.payment_terms}</p>
              <p className="text-sm">
                {entry.quotation.quote.validity
                  ? `有效日期：${entry.quotation.quote.validity.starts_on} 至 ${entry.quotation.quote.validity.expires_on}（包含首尾日期；${entry.quotation.quote.validity.time_zone}）`
                  : "有效日期：尚未记录，请人工确认。"}
              </p>
            </CardContent>
          </Card>
          {entry.state === "QUOTE_REVISION_REQUIRED" ? (
            <>
              <Alert
                variant="destructive"
                className="*:data-[slot=alert-description]:text-destructive"
              >
                <AlertTitle>报价被退回，请按意见修订</AlertTitle>
                <AlertDescription>
                  {entry.reviewNotes || "审核备注暂不可用，请与审核者核对需要修改的条款。"}
                </AlertDescription>
              </Alert>
              <QuotationForm
                key={`${entry.id}:${entry.version}`}
                projectId={projectId}
                rfqs={ready}
                products={products}
                entry={entry}
              />
            </>
          ) : null}
          {entry.state === "QUOTE_REVIEW_REQUIRED" ? (
            canReview && entry.approvalStatus === "pending" && entry.approvalId ? (
              <QuoteDecision
                key={`${entry.id}:${entry.version}:${entry.approvalId}`}
                projectId={projectId}
                entry={entry}
              />
            ) : (
              <Alert>
                <AlertTitle>{canReview ? "审核请求需核对" : "等待报价审核者处理"}</AlertTitle>
                <AlertDescription>
                  {canReview
                    ? "当前没有有效的待审请求，请刷新或联系项目负责人核对。"
                    : "有报价审核权限的项目编辑者需核对当前版本的全部人工商业条款。"}
                </AlertDescription>
              </Alert>
            )
          ) : null}
          {entry.state === "QUOTE_APPROVED" ? (
            <>
              <ApprovedQuotationPreview
                key={`${entry.id}:${entry.version}:${entry.approvalId}`}
                entry={entry}
                rfqs={rfqs}
                products={products}
              />
              <QuoteSend projectId={projectId} entry={entry} />
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}
