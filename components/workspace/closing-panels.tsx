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
import type { RfqEntry } from "@/lib/sales/store";
import type {
  PublicationCandidate,
  PublicationChannel,
  PublicationEntry,
} from "@/lib/social/publication-store";
import type { WorkspaceProductReference } from "@/lib/workspace/store";
import { useWorkspaceDirty } from "./dirty-state";

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
  return (
    (
      {
        QUOTE_REVIEW_REQUIRED: "等待 Gate 02",
        QUOTE_REVISION_REQUIRED: "待修订",
        QUOTE_APPROVED: "Gate 02 已批准",
        QUOTE_SENT: "已发送",
        FOLLOW_UP: "跟进中",
        OPPORTUNITY: "有效商机",
        DELIVERY_CONFIRMATION_PENDING: "等待 Gate 03",
        DELIVERY_CONFIRMATION_CONFIRMED: "交期已确认",
        DELIVERY_CONFIRMATION_REJECTED: "交期被拒绝",
      } as Record<string, string>
    )[state] ?? state
  );
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
          rfqId: rfqs[0]?.id ?? "",
          productId: products[0]?.id ?? "",
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
  }, [form, router, state.status]);
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
            <Field>
              <FieldLabel>RFQ Ready</FieldLabel>
              <Controller
                control={form.control}
                name="rfqId"
                render={({ field }) => (
                  <Select
                    items={Object.fromEntries(
                      rfqs.map((item) => [
                        item.id,
                        `${item.productType} · ${item.quantity ?? "数量待补"}`,
                      ]),
                    )}
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="选择 RFQ Ready" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {rfqs.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.productType} · {item.quantity}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field>
              <FieldLabel>Product Ready 引用</FieldLabel>
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
                    <SelectTrigger className="w-full">
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
                <Field>
                  <FieldLabel htmlFor={`currency-${entry?.id ?? "new"}`}>币种</FieldLabel>
                  <Input
                    id={`currency-${entry?.id ?? "new"}`}
                    maxLength={3}
                    {...form.register("currency")}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`moq-${entry?.id ?? "new"}`}>MOQ</FieldLabel>
                  <Input
                    id={`moq-${entry?.id ?? "new"}`}
                    inputMode="numeric"
                    {...form.register("moq")}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`lead-time-${entry?.id ?? "new"}`}>交期（天）</FieldLabel>
                  <Input
                    id={`lead-time-${entry?.id ?? "new"}`}
                    inputMode="numeric"
                    {...form.register("leadTimeDays")}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`terms-${entry?.id ?? "new"}`}>付款条件</FieldLabel>
                  <Textarea
                    id={`terms-${entry?.id ?? "new"}`}
                    rows={3}
                    {...form.register("paymentTerms")}
                  />
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
                <Field>
                  <FieldLabel htmlFor={`validity-${entry?.id ?? "new"}`}>有效期（天）</FieldLabel>
                  <Input
                    id={`validity-${entry?.id ?? "new"}`}
                    inputMode="numeric"
                    {...form.register("validityDays")}
                  />
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
          {entry ? "提交修订并再次送审" : "创建报价并提交 Gate 02"}
        </Button>
        <Message {...state} />
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
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);
  function submit(value: z.infer<typeof quotationDecisionFormSchema>) {
    const data = new FormData();
    for (const [key, item] of Object.entries(value)) data.set(key, item);
    startTransition(() => action(data));
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Gate 02 报价审核</CardTitle>
        <CardDescription>
          审核版本 {entry.version}。请核对全部人工商业条款，系统不会预选批准。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form id={`quote-decision-${entry.id}`} onSubmit={form.handleSubmit(submit)}>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.decision}>
              <FieldLabel>决定</FieldLabel>
              <Controller
                control={form.control}
                name="decision"
                render={({ field }) => (
                  <Select
                    items={{ approved: "批准人工报价", rejected: "退回人工报价" }}
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="请选择 Gate 02 决定" />
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
            <Field>
              <FieldLabel htmlFor={`quote-evidence-${entry.id}`}>审核证据</FieldLabel>
              <Input id={`quote-evidence-${entry.id}`} {...form.register("evidenceRef")} />
            </Field>
            <Field data-invalid={!!form.formState.errors.notes}>
              <FieldLabel htmlFor={`quote-notes-${entry.id}`}>
                备注{form.watch("decision") === "rejected" ? "（必填）" : ""}
              </FieldLabel>
              <Textarea id={`quote-notes-${entry.id}`} {...form.register("notes")} />
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
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);
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
            <Field>
              <FieldLabel htmlFor={`send-channel-${entry.id}`}>发送渠道</FieldLabel>
              <Input
                id={`send-channel-${entry.id}`}
                placeholder="sanitized-whatsapp"
                {...form.register("channelRef")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`send-ref-${entry.id}`}>外部发送凭证</FieldLabel>
              <Input
                id={`send-ref-${entry.id}`}
                placeholder="evidence-message-001"
                {...form.register("externalRef")}
              />
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
}: {
  projectId: string;
  rfqs: RfqEntry[];
  products: WorkspaceProductReference[];
  entries: QuotationEntry[];
  canReview: boolean;
}) {
  const ready = rfqs.filter((entry) => entry.state === "RFQ_READY");
  const revision = entries.find((entry) => entry.state === "QUOTE_REVISION_REQUIRED");
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">人工报价</Badge>
          <Badge variant="outline">Gate 02 受控</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          报价由人填写、由管理员审核，并且必须有外部发送凭证。
        </p>
      </div>
      {revision ? (
        <QuotationForm
          key={revision.id}
          projectId={projectId}
          rfqs={ready}
          products={products}
          entry={revision}
        />
      ) : (
        <QuotationForm key="new" projectId={projectId} rfqs={ready} products={products} />
      )}
      {entries.map((entry) => (
        <Card key={entry.id}>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle>
                  {entry.quotation.quote.currency} {entry.quotation.quote.unit_price}
                </CardTitle>
                <CardDescription>
                  MOQ {entry.quotation.quote.moq} · 交期 {entry.quotation.quote.lead_time_days} 天 ·
                  有效 {entry.quotation.quote.validity_days} 天
                </CardDescription>
              </div>
              <Badge variant="outline">{stateLabel(entry.state)}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm">付款条件：{entry.quotation.quote.payment_terms}</p>
          </CardContent>
          {canReview && entry.state === "QUOTE_REVIEW_REQUIRED" ? (
            <CardFooter className="block">
              <QuoteDecision
                key={`${entry.id}:${entry.version}:${entry.approvalId}`}
                projectId={projectId}
                entry={entry}
              />
            </CardFooter>
          ) : null}
          {entry.state === "QUOTE_APPROVED" ? (
            <CardFooter className="block">
              <QuoteSend projectId={projectId} entry={entry} />
            </CardFooter>
          ) : null}
        </Card>
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
  }, [form, router, state.status]);
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
            <Field>
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
                    <SelectTrigger id={`context-${entry.id}`} className="w-full">
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
            </Field>
            {requiresDeliveryConfirmation ? (
              entry.confirmedDelivery ? (
                <Alert>
                  <AlertTitle>
                    将插入已确认交期：{entry.confirmedDelivery.leadTimeDays} 天
                  </AlertTitle>
                  <AlertDescription>
                    Gate 03 有效至{" "}
                    {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(
                      new Date(entry.confirmedDelivery.validUntil),
                    )}
                    。交期句由服务端插入，请勿写入自由文本。
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert variant="destructive">
                  <AlertTitle>需要有效的 Gate 03</AlertTitle>
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
                不要在自由文本中填写交期；选择交期或样品场景后，系统只会插入当前有效的 Gate 03
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
            <Field>
              <FieldLabel htmlFor={`next-${entry.id}`}>下次跟进时间（可选）</FieldLabel>
              <Input
                id={`next-${entry.id}`}
                type="datetime-local"
                {...form.register("nextFollowUpAt")}
              />
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
          <p className="text-sm text-muted-foreground">等待有效的 Gate 03 后才能发送此场景。</p>
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
        <CardTitle>授权消息时间线</CardTitle>
        <CardDescription>仅当前项目成员可见；消息正文加密保存并按保留策略清理。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
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
              <p className="whitespace-pre-wrap text-sm">{message.body}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {new Intl.DateTimeFormat("zh-CN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(message.receivedAt)}
              </p>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">没有仍在保留期内的消息。</p>
        )}
      </CardContent>
    </Card>
  );
}

function LeadActions({ projectId, entry }: { projectId: string; entry: LeadEntry }) {
  const router = useRouter();
  const [deliveryState, deliveryAction, deliveryPending] = useActionState(
    requestDeliveryAction,
    initialClosingActionState,
  );
  const [opportunityState, opportunityAction, opportunityPending] = useActionState(
    confirmOpportunityAction,
    initialClosingActionState,
  );
  const [deliveryEvidence, setDeliveryEvidence] = useState("");
  const [opportunityEvidence, setOpportunityEvidence] = useState("");
  useEffect(() => {
    if (deliveryState.status === "success" || opportunityState.status === "success")
      router.refresh();
  }, [deliveryState.status, opportunityState.status, router]);
  function requestDelivery() {
    const parsed = deliveryRequestFormSchema.safeParse({
      projectId,
      leadId: entry.id,
      evidenceRef: deliveryEvidence,
    });
    if (!parsed.success) return;
    const data = new FormData();
    for (const [key, value] of Object.entries(parsed.data)) data.set(key, value);
    startTransition(() => deliveryAction(data));
  }
  function promote() {
    const parsed = opportunityDecisionFormSchema.safeParse({
      projectId,
      leadId: entry.id,
      evidenceRef: opportunityEvidence,
    });
    if (!parsed.success) return;
    const data = new FormData();
    for (const [key, value] of Object.entries(parsed.data)) data.set(key, value);
    startTransition(() => opportunityAction(data));
  }
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>申请交期确认</CardTitle>
          <CardDescription>客户询问交期时创建 Gate 03；未确认值不能进入承诺。</CardDescription>
        </CardHeader>
        <CardContent>
          <Field>
            <FieldLabel htmlFor={`delivery-evidence-${entry.id}`}>请求证据</FieldLabel>
            <Input
              id={`delivery-evidence-${entry.id}`}
              value={deliveryEvidence}
              onChange={(event) => setDeliveryEvidence(event.target.value)}
            />
          </Field>
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3">
          <Button
            variant="outline"
            disabled={deliveryPending || !deliveryEvidence}
            onClick={requestDelivery}
          >
            <Clock3Icon data-icon="inline-start" />
            创建 Gate 03 请求
          </Button>
          <Message {...deliveryState} />
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>有效商机</CardTitle>
          <CardDescription>评分仅是建议；只有 HOT 线索可由业务人员显式确认。</CardDescription>
        </CardHeader>
        <CardContent>
          <Field>
            <FieldLabel htmlFor={`opportunity-evidence-${entry.id}`}>商机确认凭据</FieldLabel>
            <Input
              id={`opportunity-evidence-${entry.id}`}
              value={opportunityEvidence}
              onChange={(event) => setOpportunityEvidence(event.target.value)}
            />
          </Field>
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3">
          <Button
            disabled={opportunityPending || entry.lead.score_band !== "HOT" || !opportunityEvidence}
            onClick={promote}
          >
            <CheckCircle2Icon data-icon="inline-start" />
            确认有效商机
          </Button>
          <Message {...opportunityState} />
        </CardFooter>
      </Card>
    </div>
  );
}

export function LeadPanel({ projectId, entries }: { projectId: string; entries: LeadEntry[] }) {
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
                {stateLabel(entry.state)} · {entry.lead.score_band ?? "COLD"} {entry.lead.score} 分
              </AlertTitle>
              <AlertDescription>
                {entry.state === "LEAD_RECEIVED"
                  ? "消息已安全关联。下一步请进入 RFQ 阶段录入询盘事实。"
                  : `下一动作：${entry.lead.next_action}${entry.lead.next_follow_up_at ? ` · ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.lead.next_follow_up_at))}` : ""}`}
              </AlertDescription>
            </Alert>
            <LeadTimeline entry={entry} />
            {entry.state === "FOLLOW_UP" ? (
              <>
                <FollowUpForm projectId={projectId} entry={entry} />
                <LeadActions projectId={projectId} entry={entry} />
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
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);
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
            <Field>
              <FieldLabel>决定</FieldLabel>
              <Controller
                control={form.control}
                name="decision"
                render={({ field }) => (
                  <Select
                    items={{ confirmed: "确认交期", rejected: "拒绝确认" }}
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="请选择 Gate 03 决定" />
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
            </Field>
            <Field data-invalid={!!form.formState.errors.leadTimeDays}>
              <FieldLabel htmlFor={`confirmed-days-${entry.id}`}>确认交期（天）</FieldLabel>
              <Input
                id={`confirmed-days-${entry.id}`}
                inputMode="numeric"
                disabled={form.watch("decision") !== "confirmed"}
                {...form.register("leadTimeDays")}
              />
              <FieldError errors={[form.formState.errors.leadTimeDays]} />
            </Field>
            <Field>
              <FieldLabel htmlFor={`delivery-decision-evidence-${entry.id}`}>审核证据</FieldLabel>
              <Input
                id={`delivery-decision-evidence-${entry.id}`}
                {...form.register("evidenceRef")}
              />
            </Field>
            <Field data-invalid={!!form.formState.errors.notes}>
              <FieldLabel htmlFor={`delivery-notes-${entry.id}`}>
                备注{form.watch("decision") === "rejected" ? "（必填）" : ""}
              </FieldLabel>
              <Textarea id={`delivery-notes-${entry.id}`} {...form.register("notes")} />
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
          <Badge variant="outline">Gate 03</Badge>
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
                关联线索：{String(entry.confirmation.related_entity_id ?? "未知")}
              </AlertDescription>
            </Alert>
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
            <EmptyDescription>从“跟进与商机”节点依据客户请求发起。</EmptyDescription>
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
  const selected = candidates.find((item) => item.id === form.watch("contentRef"));
  const [channelKey, setChannelKey] = useState(
    channels[0] ? `${channels[0].channelRef}\u001f${channels[0].accountRef}` : "",
  );
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);
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
      <Card>
        <CardHeader>
          <CardTitle>确认并提交发布</CardTitle>
          <CardDescription>
            核对最终载荷、渠道与账户。本次确认只授权这一条内容，不会授权后续自动发布。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form id="publication-confirmation" onSubmit={form.handleSubmit(submit)}>
            <FieldGroup>
              <Field>
                <FieldLabel>已批准内容或视频</FieldLabel>
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
                      <SelectTrigger className="w-full">
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
              </Field>
              {selected ? (
                <Alert>
                  <AlertTitle>最终载荷预览</AlertTitle>
                  <AlertDescription>{selected.preview}</AlertDescription>
                </Alert>
              ) : null}
              <Field>
                <FieldLabel>已启用渠道</FieldLabel>
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
                  <SelectTrigger className="w-full">
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
              <Field>
                <FieldLabel htmlFor="publication-confirmation-ref">逐帖人工确认凭据</FieldLabel>
                <Input id="publication-confirmation-ref" {...form.register("confirmationRef")} />
                <FieldDescription>使用脱敏引用；重复提交同一凭据只会返回原任务。</FieldDescription>
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
            {pending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
            确认并提交此条发布
          </Button>
          <Message {...state} />
        </CardFooter>
      </Card>
      {publications.length ? (
        <Card>
          <CardHeader>
            <CardTitle>最近发布记录</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {publications.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <span className="min-w-0 truncate text-sm">
                  {item.channelRef}
                  {item.externalPublicationRef
                    ? ` · ${item.externalPublicationRef}`
                    : " · 等待平台回执"}
                </span>
                <Badge variant="outline">{item.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
