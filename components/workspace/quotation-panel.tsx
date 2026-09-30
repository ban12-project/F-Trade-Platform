"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { HandCoinsIcon, SendIcon, ShieldCheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
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
import type { QuotationEntry } from "@/lib/sales/closing-store";
import { productTypeLabel } from "@/lib/sales/journey";
import type { RfqEntry } from "@/lib/sales/store";
import { workspaceCreateHref, workspaceRecordHref } from "@/lib/workspace/navigation";
import type { WorkspaceProductReference } from "@/lib/workspace/types";
import { useWorkspaceDirty } from "./dirty-state";
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
        },
  });
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
    for (const [key, item] of Object.entries(value)) data.set(key, item);
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
        <form id={`quotation-${entry?.id ?? "new"}`} onSubmit={form.handleSubmit(submit)}>
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
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger
                      aria-invalid={!!form.formState.errors.rfqId}
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
              <FieldError errors={[form.formState.errors.rfqId]} />
            </Field>
            <Field data-invalid={!!form.formState.errors.productId}>
              <FieldLabel htmlFor={`quotation-product-${entry?.id ?? "new"}`}>报价产品</FieldLabel>
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
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger
                      aria-invalid={!!form.formState.errors.productId}
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
              <FieldError errors={[form.formState.errors.productId]} />
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
                    {...form.register("unitPrice")}
                  />
                  <FieldError errors={[form.formState.errors.unitPrice]} />
                </Field>
                <Field data-invalid={!!form.formState.errors.currency}>
                  <FieldLabel htmlFor={`currency-${entry?.id ?? "new"}`}>币种</FieldLabel>
                  <Input
                    id={`currency-${entry?.id ?? "new"}`}
                    maxLength={3}
                    {...form.register("currency")}
                    aria-invalid={!!form.formState.errors.currency}
                  />
                  <FieldError errors={[form.formState.errors.currency]} />
                </Field>
                <Field data-invalid={!!form.formState.errors.moq}>
                  <FieldLabel htmlFor={`moq-${entry?.id ?? "new"}`}>MOQ</FieldLabel>
                  <Input
                    id={`moq-${entry?.id ?? "new"}`}
                    inputMode="numeric"
                    {...form.register("moq")}
                    aria-invalid={!!form.formState.errors.moq}
                  />
                  <FieldError errors={[form.formState.errors.moq]} />
                </Field>
                <Field data-invalid={!!form.formState.errors.leadTimeDays}>
                  <FieldLabel htmlFor={`lead-time-${entry?.id ?? "new"}`}>交期（天）</FieldLabel>
                  <Input
                    id={`lead-time-${entry?.id ?? "new"}`}
                    inputMode="numeric"
                    {...form.register("leadTimeDays")}
                    aria-invalid={!!form.formState.errors.leadTimeDays}
                  />
                  <FieldError errors={[form.formState.errors.leadTimeDays]} />
                </Field>
                <Field data-invalid={!!form.formState.errors.paymentTerms}>
                  <FieldLabel htmlFor={`terms-${entry?.id ?? "new"}`}>付款条件</FieldLabel>
                  <Textarea
                    id={`terms-${entry?.id ?? "new"}`}
                    rows={3}
                    {...form.register("paymentTerms")}
                    aria-invalid={!!form.formState.errors.paymentTerms}
                  />
                  <FieldError errors={[form.formState.errors.paymentTerms]} />
                </Field>
                <Field data-invalid={!!form.formState.errors.evidenceRef}>
                  <FieldLabel htmlFor={`quotation-source-${entry?.id ?? "new"}`}>
                    报价依据
                  </FieldLabel>
                  <Input
                    id={`quotation-source-${entry?.id ?? "new"}`}
                    placeholder="evidence-quotation-001"
                    aria-invalid={!!form.formState.errors.evidenceRef}
                    {...form.register("evidenceRef")}
                  />
                  <FieldDescription>
                    填写本次人工商业条款的依据引用；修订时重新填写。
                  </FieldDescription>
                  <FieldError errors={[form.formState.errors.evidenceRef]} />
                </Field>
                <Field data-invalid={!!form.formState.errors.validityDays}>
                  <FieldLabel htmlFor={`validity-${entry?.id ?? "new"}`}>有效期（天）</FieldLabel>
                  <Input
                    id={`validity-${entry?.id ?? "new"}`}
                    inputMode="numeric"
                    {...form.register("validityDays")}
                    aria-invalid={!!form.formState.errors.validityDays}
                  />
                  <FieldError errors={[form.formState.errors.validityDays]} />
                </Field>
              </FieldGroup>
            </FieldSet>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3">
        <Button
          form={`quotation-${entry?.id ?? "new"}`}
          type="submit"
          disabled={pending || !rfqs.length || !products.length}
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
    defaultValues: {
      projectId,
      quotationId: entry.id,
      reviewedVersion: String(entry.version),
      approvalId: entry.approvalId ?? "",
      evidenceRef: "",
      notes: "",
    },
  });
  useWorkspaceDirty(`quote-decision-${entry.id}`, form.formState.isDirty);
  useEffect(() => {
    if (state.status === "success") {
      form.reset(form.getValues());
      router.refresh();
    }
  }, [form, router, state]);
  function submit(value: z.infer<typeof quotationDecisionFormSchema>) {
    const data = new FormData();
    for (const [key, item] of Object.entries(value)) data.set(key, item);
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
        <form id={`quote-decision-${entry.id}`} onSubmit={form.handleSubmit(submit)}>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.decision}>
              <FieldLabel htmlFor={`quote-decision-${entry.id}-decision`}>决定</FieldLabel>
              <Controller
                control={form.control}
                name="decision"
                render={({ field }) => (
                  <Select
                    items={{ approved: "批准人工报价", rejected: "退回人工报价" }}
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger
                      aria-invalid={!!form.formState.errors.decision}
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
              <FieldError errors={[form.formState.errors.decision]} />
            </Field>
            <Field data-invalid={!!form.formState.errors.evidenceRef}>
              <FieldLabel htmlFor={`quote-evidence-${entry.id}`}>审核证据</FieldLabel>
              <Input
                id={`quote-evidence-${entry.id}`}
                {...form.register("evidenceRef")}
                aria-invalid={!!form.formState.errors.evidenceRef}
              />
              <FieldError errors={[form.formState.errors.evidenceRef]} />
            </Field>
            <Field data-invalid={!!form.formState.errors.notes}>
              <FieldLabel htmlFor={`quote-notes-${entry.id}`}>
                备注{form.watch("decision") === "rejected" ? "（必填）" : ""}
              </FieldLabel>
              <Textarea
                id={`quote-notes-${entry.id}`}
                {...form.register("notes")}
                aria-invalid={!!form.formState.errors.notes}
              />
              <FieldError errors={[form.formState.errors.notes]} />
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3">
        <Button
          form={`quote-decision-${entry.id}`}
          type="submit"
          variant={form.watch("decision") === "rejected" ? "destructive" : "default"}
          disabled={pending || !form.watch("decision")}
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
  useWorkspaceDirty(`quote-send-${entry.id}`, form.formState.isDirty);
  useEffect(() => {
    if (state.status === "success") {
      form.reset(form.getValues());
      router.refresh();
    }
  }, [form, router, state]);
  function submit(value: z.infer<typeof quotationSendFormSchema>) {
    const data = new FormData();
    for (const [key, item] of Object.entries(value)) data.set(key, item);
    startTransition(() => action(data));
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>登记报价已发送</CardTitle>
        <CardDescription>
          先在受控渠道完成发送，再用平台回执或脱敏消息引用登记；缺少凭证时不能进入已发送。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form id={`quote-send-${entry.id}`} onSubmit={form.handleSubmit(submit)}>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.channelRef}>
              <FieldLabel htmlFor={`send-channel-${entry.id}`}>发送渠道</FieldLabel>
              <Input
                id={`send-channel-${entry.id}`}
                placeholder="sanitized-whatsapp"
                {...form.register("channelRef")}
                aria-invalid={!!form.formState.errors.channelRef}
              />
              <FieldError errors={[form.formState.errors.channelRef]} />
            </Field>
            <Field data-invalid={!!form.formState.errors.externalRef}>
              <FieldLabel htmlFor={`send-ref-${entry.id}`}>外部发送凭证</FieldLabel>
              <Input
                id={`send-ref-${entry.id}`}
                placeholder="evidence-message-001"
                {...form.register("externalRef")}
                aria-invalid={!!form.formState.errors.externalRef}
              />
              <FieldError errors={[form.formState.errors.externalRef]} />
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3">
        <Button form={`quote-send-${entry.id}`} type="submit" disabled={pending}>
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
            <AlertTitle>{!ready.length ? "先确认客户需求" : "先添加报价产品"}</AlertTitle>
            <AlertDescription>
              {!ready.length
                ? "客户需求确认完整后，才能填写正式报价。"
                : "在下方引用已核实产品后，即可填写人工商业条款。"}
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
            <QuoteSend projectId={projectId} entry={entry} />
          ) : null}
        </div>
      ))}
    </div>
  );
}
