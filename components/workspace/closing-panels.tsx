"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  CheckCircle2Icon,
  Clock3Icon,
  HandCoinsIcon,
  MessageSquareTextIcon,
  SendIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
import { PublicationReconciliationForm } from "@/components/workspace/publication-reconciliation-form";
import { initialClosingActionState } from "@/lib/action-states";
import {
  confirmOpportunityAction,
  confirmPublicationAction,
  decideDeliveryAction,
  decideQuotationAction,
  recordFollowUpAction,
  requestDeliveryAction,
  saveQuotationAction,
  sendQuotationAction,
} from "@/lib/actions/closing";
import {
  deliveryDecisionFormSchema,
  deliveryRequestFormSchema,
  followUpFormSchema,
  opportunityDecisionFormSchema,
  publicationConfirmationFormSchema,
  quotationDecisionFormSchema,
  quotationDraftFormSchema,
  quotationSendFormSchema,
} from "@/lib/form-schemas";
import type {
  DeliveryConfirmationEntry,
  LeadEntry,
  QuotationEntry,
} from "@/lib/sales/closing-store";
import { productTypeLabel, salesNextActionLabels, salesStateLabels } from "@/lib/sales/journey";
import type { RfqEntry } from "@/lib/sales/store";
import { publicationProgress } from "@/lib/social/publication-presentation";
import type {
  PublicationCandidate,
  PublicationChannel,
  PublicationEntry,
} from "@/lib/social/publication-store";
import { workspaceCreateHref, workspaceRecordHref } from "@/lib/workspace/navigation";
import type { WorkspaceProductReference } from "@/lib/workspace/store";
import { useWorkspaceDirty } from "./dirty-state";
import { WorkspaceLink } from "./workspace-link";

function Message({ status, message }: { status: string; message: string }) {
  return message ? (
    <p
      className={status === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
      aria-live="polite"
    >
      {message}
    </p>
  ) : null;
}
function stateLabel(state: string) {
  return salesStateLabels[state] ?? "查看记录";
}

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

const contexts = [
  ["quote_sent_unread", "报价未读"],
  ["quote_sent_read_no_reply", "已读未回复"],
  ["price_high", "反馈价格高"],
  ["purchase_later", "稍后采购"],
  ["asks_sample", "询问样品"],
  ["asks_lead_time", "询问交期"],
] as const;
const scoringRules = [
  ["active_inquiry", "主动询盘"],
  ["provides_oe_number", "提供 OE"],
  ["explicit_quantity", "明确数量"],
  ["target_quantity_range", "目标数量区间"],
  ["asks_sample", "询问样品"],
  ["asks_lead_time", "询问交期"],
  ["asks_payment_terms", "询问付款条件"],
  ["replies_again", "再次回复"],
] as const;

function FollowUpForm({ projectId, entry }: { projectId: string; entry: LeadEntry }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(recordFollowUpAction, initialClosingActionState);
  const form = useForm<z.infer<typeof followUpFormSchema>>({
    resolver: zodResolver(followUpFormSchema),
    defaultValues: {
      projectId,
      leadId: entry.id,
      context: entry.lead.follow_up_context ?? "quote_sent_unread",
      triggeredRules: entry.lead.score_reasons
        .map((item) => item.rule_id)
        .filter((item): item is z.infer<typeof followUpFormSchema>["triggeredRules"][number] =>
          scoringRules.some(([id]) => id === item),
        ),
      draft: "",
      confirmationRef: "",
      nextFollowUpAt: "",
    },
  });
  const context = form.watch("context");
  const requiresDeliveryConfirmation = context === "asks_lead_time" || context === "asks_sample";
  const canSend =
    entry.replyAvailable && (!requiresDeliveryConfirmation || Boolean(entry.confirmedDelivery));
  useWorkspaceDirty(`follow-up-${entry.id}`, form.formState.isDirty);
  useEffect(() => {
    if (state.status === "success") {
      form.reset({ ...form.getValues(), draft: "", confirmationRef: "" });
      router.refresh();
    }
  }, [form, router, state]);
  function submit(value: z.infer<typeof followUpFormSchema>) {
    const data = new FormData();
    for (const [key, item] of Object.entries(value)) {
      if (key === "triggeredRules") for (const rule of item as string[]) data.append(key, rule);
      else data.set(key, String(item));
    }
    startTransition(() => action(data));
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>人工跟进</CardTitle>
        <CardDescription>
          AI 建议只作为可编辑草稿。提交时系统会重新检查成员权限、渠道状态和 60
          分钟回复窗口；正文只加密保存在受限消息时间线中。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form id={`follow-up-${entry.id}`} onSubmit={form.handleSubmit(submit)}>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.context}>
              <FieldLabel htmlFor={`context-${entry.id}`}>当前场景</FieldLabel>
              <Controller
                control={form.control}
                name="context"
                render={({ field }) => (
                  <Select
                    items={Object.fromEntries(contexts)}
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger
                      aria-invalid={!!form.formState.errors.context}
                      id={`context-${entry.id}`}
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {contexts.map(([id, label]) => (
                          <SelectItem key={id} value={id}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError errors={[form.formState.errors.context]} />
            </Field>
            {requiresDeliveryConfirmation ? (
              entry.confirmedDelivery ? (
                <Alert>
                  <AlertTitle>
                    将插入已确认交期：{entry.confirmedDelivery.leadTimeDays} 天
                  </AlertTitle>
                  <AlertDescription>
                    交期确认有效至{" "}
                    {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(
                      new Date(entry.confirmedDelivery.validUntil),
                    )}
                    。交期句由服务端插入，请勿写入自由文本。
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert
                  variant="destructive"
                  className="*:data-[slot=alert-description]:text-destructive"
                >
                  <AlertTitle>需要工厂确认交期</AlertTitle>
                  <AlertDescription>
                    请先创建交期确认请求并等待管理员批准；未批准或过期的交期不能进入回复。
                  </AlertDescription>
                </Alert>
              )
            ) : null}
            <FieldSet>
              <FieldLegend>评分事实</FieldLegend>
              <FieldDescription>只勾选本轮消息中有可观察证据的行为。</FieldDescription>
              <FieldGroup>
                {scoringRules.map(([id, label]) => (
                  <Field key={id} orientation="horizontal">
                    <Controller
                      control={form.control}
                      name="triggeredRules"
                      render={({ field }) => (
                        <Checkbox
                          id={`${entry.id}-${id}`}
                          checked={field.value.includes(id)}
                          onCheckedChange={(checked) =>
                            field.onChange(
                              checked
                                ? [...field.value, id]
                                : field.value.filter((item) => item !== id),
                            )
                          }
                        />
                      )}
                    />
                    <FieldLabel htmlFor={`${entry.id}-${id}`}>{label}</FieldLabel>
                    <FieldError errors={[form.formState.errors.triggeredRules]} />
                  </Field>
                ))}
              </FieldGroup>
            </FieldSet>
            <Field data-invalid={!!form.formState.errors.draft}>
              <FieldLabel htmlFor={`draft-${entry.id}`}>待人工发送内容</FieldLabel>
              <Textarea
                id={`draft-${entry.id}`}
                rows={5}
                aria-invalid={!!form.formState.errors.draft}
                {...form.register("draft")}
              />
              <FieldDescription>
                不要在自由文本中填写交期；选择交期或样品场景后，系统只会插入当前有效的交期确认
                结果。
              </FieldDescription>
              <FieldError errors={[form.formState.errors.draft]} />
            </Field>
            <Field data-invalid={!!form.formState.errors.confirmationRef}>
              <FieldLabel htmlFor={`confirmation-${entry.id}`}>本次人工确认凭据</FieldLabel>
              <Input
                id={`confirmation-${entry.id}`}
                aria-invalid={!!form.formState.errors.confirmationRef}
                {...form.register("confirmationRef")}
              />
              <FieldDescription>
                每次发送使用一个脱敏证据引用；重复提交同一引用不会重复发送。
              </FieldDescription>
              <FieldError errors={[form.formState.errors.confirmationRef]} />
            </Field>
            <Field data-invalid={!!form.formState.errors.nextFollowUpAt}>
              <FieldLabel htmlFor={`next-${entry.id}`}>下次跟进时间（可选）</FieldLabel>
              <Input
                id={`next-${entry.id}`}
                type="datetime-local"
                {...form.register("nextFollowUpAt")}
                aria-invalid={!!form.formState.errors.nextFollowUpAt}
              />
              <FieldError errors={[form.formState.errors.nextFollowUpAt]} />
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3">
        <Button form={`follow-up-${entry.id}`} type="submit" disabled={pending || !canSend}>
          {pending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <MessageSquareTextIcon data-icon="inline-start" />
          )}
          人工确认并发送此回复
        </Button>
        {!entry.replyAvailable ? (
          <p className="text-sm text-muted-foreground">
            该线索未关联受控渠道会话，不能从应用内发送。
          </p>
        ) : requiresDeliveryConfirmation && !entry.confirmedDelivery ? (
          <p className="text-sm text-muted-foreground">等待有效的交期确认 后才能发送此场景。</p>
        ) : null}
        <Message {...state} />
      </CardFooter>
    </Card>
  );
}

function LeadTimeline({ entry }: { entry: LeadEntry }) {
  const statusLabel = {
    received: "已接收",
    queued: "等待发送",
    claimed: "发送中",
    sent: "已发送",
    failed: "发送失败",
    paused: "已暂停",
  } as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle>客户会话</CardTitle>
        <CardDescription>按时间展示当前客户仍在保留期内的最近 200 条消息。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {entry.timelineTruncated ? (
          <p className="text-sm text-muted-foreground">
            更早的消息未在此加载，当前显示最近 200 条。
          </p>
        ) : null}
        {entry.timeline.length ? (
          entry.timeline.map((message) => (
            <div
              key={message.id}
              className={`max-w-[90%] rounded-xl border p-3 ${message.direction === "outbound" ? "ml-auto bg-muted" : "mr-auto"}`}
            >
              <div className="mb-1 flex items-center justify-between gap-4 text-xs text-muted-foreground">
                <span>{message.direction === "outbound" ? "我方回复" : "客户消息"}</span>
                <span>{statusLabel[message.deliveryStatus]}</span>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {new Intl.DateTimeFormat("zh-CN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(message.receivedAt)}
              </p>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            {entry.replyAvailable
              ? "当前会话没有仍在保留期内的消息。"
              : "当前记录没有有效关联的客户会话，请核对来源。"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function LeadActions({
  projectId,
  entry,
  delivery,
}: {
  projectId: string;
  entry: LeadEntry;
  delivery?: DeliveryConfirmationEntry;
}) {
  const router = useRouter();
  const [deliveryState, deliveryAction, deliveryPending] = useActionState(
    requestDeliveryAction,
    initialClosingActionState,
  );
  const [opportunityState, opportunityAction, opportunityPending] = useActionState(
    confirmOpportunityAction,
    initialClosingActionState,
  );
  const deliveryForm = useForm<z.infer<typeof deliveryRequestFormSchema>>({
    resolver: zodResolver(deliveryRequestFormSchema),
    defaultValues: { projectId, leadId: entry.id, evidenceRef: "" },
  });
  const opportunityForm = useForm<z.infer<typeof opportunityDecisionFormSchema>>({
    resolver: zodResolver(opportunityDecisionFormSchema),
    defaultValues: { projectId, leadId: entry.id, evidenceRef: "" },
  });
  useWorkspaceDirty(`delivery-request-${entry.id}`, deliveryForm.formState.isDirty);
  useWorkspaceDirty(`opportunity-${entry.id}`, opportunityForm.formState.isDirty);
  useEffect(() => {
    if (deliveryState.status === "success") {
      deliveryForm.reset();
      router.refresh();
    }
  }, [deliveryForm, deliveryState, router]);
  useEffect(() => {
    if (opportunityState.status === "success") {
      opportunityForm.reset();
      router.refresh();
    }
  }, [opportunityForm, opportunityState, router]);
  return (
    <div className="space-y-4">
      <Collapsible
        defaultOpen={
          entry.lead.follow_up_context === "asks_lead_time" ||
          entry.lead.follow_up_context === "asks_sample"
        }
        className="rounded-xl border bg-card p-4"
      >
        <CollapsibleTrigger render={<Button variant="outline" className="w-full justify-start" />}>
          <Clock3Icon />
          客户询问交期或样品
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4">
          {delivery &&
          ["DELIVERY_CONFIRMATION_PENDING", "DELIVERY_CONFIRMATION_CONFIRMED"].includes(
            delivery.state,
          ) ? (
            <div className="space-y-3">
              <p className="text-sm">
                {stateLabel(delivery.state)}。
                {entry.confirmedDelivery
                  ? `当前有效交期为 ${entry.confirmedDelivery.leadTimeDays} 天。`
                  : delivery.state === "DELIVERY_CONFIRMATION_CONFIRMED"
                    ? "本次确认已过期或不再适用于该需求，请联系工厂重新核对。"
                    : "等待有交期审核权限的项目编辑者核实。"}
              </p>
              <WorkspaceLink
                href={workspaceRecordHref(projectId, "delivery", delivery.id)}
                className={buttonVariants({ variant: "outline" })}
              >
                查看交期确认
              </WorkspaceLink>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={deliveryForm.handleSubmit((values) => {
                const data = new FormData();
                for (const [key, value] of Object.entries(values)) data.set(key, value);
                startTransition(() => deliveryAction(data));
              })}
            >
              <p className="text-sm text-muted-foreground">
                客户需要交期或样品时，向工厂申请确认。未经确认的交期不能写入承诺。
              </p>
              {delivery?.reviewNotes ? (
                <p className="text-sm text-destructive">上次未通过：{delivery.reviewNotes}</p>
              ) : null}
              <Field data-invalid={!!deliveryForm.formState.errors.evidenceRef}>
                <FieldLabel htmlFor={`delivery-evidence-${entry.id}`}>请求证据</FieldLabel>
                <Input
                  id={`delivery-evidence-${entry.id}`}
                  {...deliveryForm.register("evidenceRef")}
                  aria-invalid={!!deliveryForm.formState.errors.evidenceRef}
                />
                <FieldError errors={[deliveryForm.formState.errors.evidenceRef]} />
              </Field>
              <Button type="submit" variant="outline" disabled={deliveryPending}>
                申请工厂确认交期
              </Button>
            </form>
          )}
          <Message {...deliveryState} />
          {deliveryState.status === "success" && deliveryState.id && !delivery ? (
            <WorkspaceLink
              href={workspaceRecordHref(projectId, "delivery", deliveryState.id)}
              className={buttonVariants({ variant: "outline" })}
            >
              查看交期确认
            </WorkspaceLink>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
      {entry.lead.score_band === "HOT" ? (
        <Card>
          <CardHeader>
            <CardTitle>确认有效商机</CardTitle>
            <CardDescription>
              当前客户符合评分条件。评分只是建议，请依据本次沟通事实作出确认。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              id={`opportunity-${entry.id}`}
              onSubmit={opportunityForm.handleSubmit((values) => {
                const data = new FormData();
                for (const [key, value] of Object.entries(values)) data.set(key, value);
                startTransition(() => opportunityAction(data));
              })}
            >
              <Field data-invalid={!!opportunityForm.formState.errors.evidenceRef}>
                <FieldLabel htmlFor={`opportunity-evidence-${entry.id}`}>商机确认凭据</FieldLabel>
                <Input
                  id={`opportunity-evidence-${entry.id}`}
                  {...opportunityForm.register("evidenceRef")}
                  aria-invalid={!!opportunityForm.formState.errors.evidenceRef}
                />
                <FieldError errors={[opportunityForm.formState.errors.evidenceRef]} />
              </Field>
            </form>
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-3">
            <Button type="submit" form={`opportunity-${entry.id}`} disabled={opportunityPending}>
              <CheckCircle2Icon />
              确认有效商机
            </Button>
            <Message {...opportunityState} />
          </CardFooter>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          商机尚待确认：继续记录有证据的客户行为，达到高意向条件后再由业务人员确认。
        </p>
      )}
    </div>
  );
}

export function LeadPanel({
  projectId,
  entries,
  deliveries = [],
}: {
  projectId: string;
  entries: LeadEntry[];
  deliveries?: DeliveryConfirmationEntry[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">跟进与商机</Badge>
          <Badge variant="outline">人工发送</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          规则给出建议和评分，人负责编辑与发送、交期请求和商机认定。禁止自动承诺价格、交期或样品。
        </p>
      </div>
      {entries.length ? (
        entries.map((entry) => (
          <div key={entry.id} className="flex flex-col gap-4">
            <Alert>
              <AlertTitle>
                {stateLabel(entry.state)} ·{" "}
                {entry.lead.score_band === "HOT"
                  ? "高意向"
                  : entry.lead.score_band === "WARM"
                    ? "有兴趣"
                    : "待了解"}{" "}
                {entry.lead.score} 分
              </AlertTitle>
              <AlertDescription>
                {entry.state === "LEAD_RECEIVED"
                  ? "下一步整理客户的产品、数量和目的地需求；相关需求和报价可从上方继续。"
                  : `下一动作：${salesNextActionLabels[entry.lead.next_action] ?? "查看客户最新消息并决定跟进事项"}${entry.lead.next_follow_up_at ? ` · ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.lead.next_follow_up_at))}` : ""}`}
              </AlertDescription>
            </Alert>
            <LeadTimeline entry={entry} />
            {entry.state === "FOLLOW_UP" ? (
              <>
                <FollowUpForm projectId={projectId} entry={entry} />
                <LeadActions
                  projectId={projectId}
                  entry={entry}
                  delivery={deliveries.find(
                    (item) =>
                      item.id === entry.lead.delivery_confirmation_ref &&
                      item.confirmation.related_entity_type === "rfq" &&
                      item.confirmation.related_entity_id === entry.lead.rfq_ref,
                  )}
                />
              </>
            ) : null}
          </div>
        ))
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquareTextIcon />
            </EmptyMedia>
            <EmptyTitle>还没有跟进线索</EmptyTitle>
            <EmptyDescription>
              先在全局待办中分流入站消息，或在报价发送时创建跟进线索。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}

function DeliveryDecision({
  projectId,
  entry,
}: {
  projectId: string;
  entry: DeliveryConfirmationEntry;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(decideDeliveryAction, initialClosingActionState);
  const form = useForm<z.infer<typeof deliveryDecisionFormSchema>>({
    resolver: zodResolver(deliveryDecisionFormSchema),
    defaultValues: {
      projectId,
      confirmationId: entry.id,
      evidenceRef: "",
      leadTimeDays: "",
      notes: "",
    },
  });
  useWorkspaceDirty(`delivery-decision-${entry.id}`, form.formState.isDirty);
  useEffect(() => {
    if (state.status === "success") {
      form.reset(form.getValues());
      router.refresh();
    }
  }, [form, router, state]);
  function submit(value: z.infer<typeof deliveryDecisionFormSchema>) {
    const data = new FormData();
    for (const [key, item] of Object.entries(value)) data.set(key, item);
    startTransition(() => action(data));
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Gate 03 交期决定</CardTitle>
        <CardDescription>系统不会预选决定；批准时必须填写人工确认的交期天数。</CardDescription>
      </CardHeader>
      <CardContent>
        <form id={`delivery-${entry.id}`} onSubmit={form.handleSubmit(submit)}>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.decision}>
              <FieldLabel htmlFor={`delivery-decision-${entry.id}-decision`}>决定</FieldLabel>
              <Controller
                control={form.control}
                name="decision"
                render={({ field }) => (
                  <Select
                    items={{ confirmed: "确认交期", rejected: "拒绝确认" }}
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger
                      aria-invalid={!!form.formState.errors.decision}
                      id={`delivery-decision-${entry.id}-decision`}
                      className="w-full"
                    >
                      <SelectValue placeholder="请选择交期决定" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="confirmed">确认交期</SelectItem>
                        <SelectItem value="rejected">拒绝确认</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError errors={[form.formState.errors.decision]} />
            </Field>
            <Field data-invalid={!!form.formState.errors.leadTimeDays}>
              <FieldLabel htmlFor={`confirmed-days-${entry.id}`}>确认交期（天）</FieldLabel>
              <Input
                id={`confirmed-days-${entry.id}`}
                inputMode="numeric"
                disabled={form.watch("decision") !== "confirmed"}
                {...form.register("leadTimeDays")}
                aria-invalid={!!form.formState.errors.leadTimeDays}
              />
              <FieldError errors={[form.formState.errors.leadTimeDays]} />
            </Field>
            <Field data-invalid={!!form.formState.errors.evidenceRef}>
              <FieldLabel htmlFor={`delivery-decision-evidence-${entry.id}`}>审核证据</FieldLabel>
              <Input
                id={`delivery-decision-evidence-${entry.id}`}
                {...form.register("evidenceRef")}
                aria-invalid={!!form.formState.errors.evidenceRef}
              />
              <FieldError errors={[form.formState.errors.evidenceRef]} />
            </Field>
            <Field data-invalid={!!form.formState.errors.notes}>
              <FieldLabel htmlFor={`delivery-notes-${entry.id}`}>
                备注{form.watch("decision") === "rejected" ? "（必填）" : ""}
              </FieldLabel>
              <Textarea
                id={`delivery-notes-${entry.id}`}
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
          form={`delivery-${entry.id}`}
          type="submit"
          variant={form.watch("decision") === "rejected" ? "destructive" : "default"}
          disabled={pending || !form.watch("decision")}
        >
          {pending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ShieldCheckIcon data-icon="inline-start" />
          )}
          {form.watch("decision") === "confirmed"
            ? "确认人工交期"
            : form.watch("decision") === "rejected"
              ? "拒绝交期确认"
              : "请先选择决定"}
        </Button>
        <Message {...state} />
      </CardFooter>
    </Card>
  );
}

export function DeliveryPanel({
  projectId,
  entries,
  canReview,
}: {
  projectId: string;
  entries: DeliveryConfirmationEntry[];
  canReview: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">交期确认</Badge>
          <Badge variant="outline">人工核实</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          只有管理员确认且有证据的交期才能用于客户回复。
        </p>
      </div>
      {entries.length ? (
        entries.map((entry) => (
          <div key={entry.id} className="flex flex-col gap-3">
            <Alert>
              <AlertTitle>{stateLabel(entry.state)}</AlertTitle>
              <AlertDescription>
                关联客户需求：{String(entry.confirmation.related_entity_id ?? "待核对")}
              </AlertDescription>
            </Alert>
            {entry.state === "DELIVERY_CONFIRMATION_CONFIRMED" ? (
              <p className="text-sm">
                工厂确认交期：{entry.confirmation.result?.confirmed_lead_time_days} 天 · 有效至{" "}
                {entry.confirmation.result?.valid_until &&
                Number.isFinite(Date.parse(entry.confirmation.result.valid_until))
                  ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(
                      new Date(entry.confirmation.result.valid_until),
                    )
                  : "待核对"}
                。是否可用于回复以当前有效性检查为准。
              </p>
            ) : null}
            {entry.state === "DELIVERY_CONFIRMATION_REJECTED" ? (
              <Alert
                variant="destructive"
                className="*:data-[slot=alert-description]:text-destructive"
              >
                <AlertTitle>工厂交期未获确认</AlertTitle>
                <AlertDescription>
                  {entry.reviewNotes || "请与审核者核对退回原因。"}
                </AlertDescription>
              </Alert>
            ) : null}
            {!canReview && entry.state === "DELIVERY_CONFIRMATION_PENDING" ? (
              <Alert>
                <AlertTitle>等待交期审核者处理</AlertTitle>
                <AlertDescription>由有交期审核权限的项目编辑者向工厂核实后确认。</AlertDescription>
              </Alert>
            ) : null}
            {canReview && entry.state === "DELIVERY_CONFIRMATION_PENDING" ? (
              <DeliveryDecision projectId={projectId} entry={entry} />
            ) : null}
          </div>
        ))
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Clock3Icon />
            </EmptyMedia>
            <EmptyTitle>没有交期确认请求</EmptyTitle>
            <EmptyDescription>在对应客户的跟进页按需申请工厂确认。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}

export function PublicationPanel({
  projectId,
  candidates,
  channels,
  publications,
}: {
  projectId: string;
  candidates: PublicationCandidate[];
  channels: PublicationChannel[];
  publications: PublicationEntry[];
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    confirmPublicationAction,
    initialClosingActionState,
  );
  const form = useForm<z.infer<typeof publicationConfirmationFormSchema>>({
    resolver: zodResolver(publicationConfirmationFormSchema),
    defaultValues: {
      projectId,
      previewDigest: candidates[0]?.previewDigest ?? "",
      contentRef: candidates[0]?.id ?? "",
      format: candidates[0]?.format ?? "text",
      channelRef: channels[0]?.channelRef ?? "",
      accountRef: channels[0]?.accountRef ?? "",
      confirmationRef: "",
    },
  });
  useWorkspaceDirty(
    `publication-${projectId}`,
    form.formState.isDirty && state.status !== "success",
  );
  const selected = candidates.find((item) => item.id === form.watch("contentRef"));
  const [channelKey, setChannelKey] = useState(
    channels[0] ? `${channels[0].channelRef}\u001f${channels[0].accountRef}` : "",
  );
  useEffect(() => {
    if (state.status === "success") {
      form.reset(form.getValues());
      router.refresh();
    }
  }, [form, router, state]);
  function submit(value: z.infer<typeof publicationConfirmationFormSchema>) {
    if (!selected) return;
    const data = new FormData();
    for (const [key, item] of Object.entries(value)) data.set(key, item);
    data.set("previewDigest", selected.previewDigest);
    startTransition(() => action(data));
  }
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">受控发布</Badge>
          <Badge variant="outline">逐帖人工确认</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          人工确认只提交一次发布任务；平台回执前不会显示为已发布，未知或失败结果会暂停渠道且不自动重试。
        </p>
      </div>
      {publications.map((item) => {
        const progress = publicationProgress(item.status, item.humanConfirmed);
        return (
          <Card key={item.id}>
            <CardHeader>
              <CardTitle>{progress.label}</CardTitle>
              <CardDescription>
                {item.channelRef} · {item.accountRef}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <p className="text-sm">{progress.detail}</p>
              {item.status === "unknown" && item.format === "text" ? (
                <PublicationReconciliationForm projectId={projectId} publicationId={item.id} />
              ) : null}
              {item.externalPublicationRef ? (
                <p className="break-all text-sm">发布凭证：{item.externalPublicationRef}</p>
              ) : null}
            </CardContent>
            <CardFooter>
              <WorkspaceLink
                href={workspaceRecordHref(
                  projectId,
                  item.format === "video" ? "video" : "content",
                  item.contentRef,
                )}
                className={buttonVariants({ variant: "outline" })}
              >
                查看发布内容
              </WorkspaceLink>
            </CardFooter>
          </Card>
        );
      })}
      {candidates.length ? (
        <Card>
          <CardHeader>
            <CardTitle>确认并提交发布</CardTitle>
            <CardDescription>
              核对最终载荷、渠道与账户。本次确认只授权这一条内容，不会授权后续自动发布。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!channels.length ? (
              <Alert className="mb-4">
                <AlertTitle>等待渠道管理员启用发布</AlertTitle>
                <AlertDescription>
                  当前没有可用渠道，请由管理员在账号与管理中核对授权和渠道状态。
                </AlertDescription>
              </Alert>
            ) : null}
            <form id="publication-confirmation" onSubmit={form.handleSubmit(submit)}>
              <FieldGroup>
                <Field data-invalid={!!form.formState.errors.contentRef}>
                  <FieldLabel htmlFor="publication-content">已批准内容或视频</FieldLabel>
                  <Controller
                    control={form.control}
                    name="contentRef"
                    render={({ field }) => (
                      <Select
                        items={Object.fromEntries(candidates.map((item) => [item.id, item.title]))}
                        value={field.value}
                        onValueChange={(value) => {
                          const item = candidates.find((candidate) => candidate.id === value);
                          field.onChange(value);
                          if (item) {
                            form.setValue("format", item.format);
                            form.setValue("previewDigest", item.previewDigest);
                          }
                        }}
                      >
                        <SelectTrigger
                          aria-invalid={!!form.formState.errors.contentRef}
                          id="publication-content"
                          className="w-full"
                        >
                          <SelectValue placeholder="没有可发布内容" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {candidates.map((item) => (
                              <SelectItem key={item.id} value={item.id}>
                                {item.title}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldError errors={[form.formState.errors.contentRef]} />
                </Field>
                {selected ? (
                  <Alert>
                    <AlertTitle>最终载荷预览</AlertTitle>
                    <AlertDescription>{selected.preview}</AlertDescription>
                  </Alert>
                ) : null}
                <Field>
                  <FieldLabel htmlFor="publication-channel">已启用渠道</FieldLabel>
                  <Select
                    items={Object.fromEntries(
                      channels.map((item) => [
                        `${item.channelRef}\u001f${item.accountRef}`,
                        `${item.channelRef} · ${item.accountRef}`,
                      ]),
                    )}
                    value={channelKey}
                    onValueChange={(value) => {
                      if (!value) return;
                      const channel = channels.find(
                        (item) => `${item.channelRef}\u001f${item.accountRef}` === value,
                      );
                      setChannelKey(value);
                      if (channel) {
                        form.setValue("channelRef", channel.channelRef);
                        form.setValue("accountRef", channel.accountRef);
                      }
                    }}
                  >
                    <SelectTrigger id="publication-channel" className="w-full">
                      <SelectValue placeholder="没有已启用渠道" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {channels.map((item) => {
                          const key = `${item.channelRef}\u001f${item.accountRef}`;
                          return (
                            <SelectItem key={key} value={key}>
                              {item.channelRef} · {item.accountRef}
                            </SelectItem>
                          );
                        })}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field data-invalid={!!form.formState.errors.confirmationRef}>
                  <FieldLabel htmlFor="publication-confirmation-ref">逐帖人工确认凭据</FieldLabel>
                  <Input
                    id="publication-confirmation-ref"
                    aria-invalid={!!form.formState.errors.confirmationRef}
                    {...form.register("confirmationRef")}
                  />
                  <FieldError errors={[form.formState.errors.confirmationRef]} />
                  <FieldDescription>
                    使用脱敏引用；重复提交同一凭据只会返回原任务。
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-3">
            <Button
              form="publication-confirmation"
              type="submit"
              disabled={pending || !candidates.length || !channels.length}
            >
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <SendIcon data-icon="inline-start" />
              )}
              确认并提交此条发布
            </Button>
            <Message {...state} />
          </CardFooter>
        </Card>
      ) : !publications.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>尚无可发布内容</EmptyTitle>
            <EmptyDescription>
              完成当前内容的人工审核后，再核对渠道与最终文案并确认发布。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
    </div>
  );
}
