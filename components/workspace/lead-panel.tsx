"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2Icon, Clock3Icon, MessageSquareTextIcon } from "lucide-react";
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
import { initialClosingActionState } from "@/lib/action-states";
import {
  confirmOpportunityAction,
  recordFollowUpAction,
  requestDeliveryAction,
} from "@/lib/actions/closing";
import {
  deliveryRequestFormSchema,
  followUpFormSchema,
  opportunityDecisionFormSchema,
} from "@/lib/form-schemas";
import type { DeliveryConfirmationEntry, LeadEntry } from "@/lib/sales/closing-store";
import { salesNextActionLabels } from "@/lib/sales/journey";
import { workspaceRecordHref } from "@/lib/workspace/navigation";
import { useWorkspaceDirty } from "./dirty-state";
import {
  SubmissionFeedback as Message,
  salesRecordStateLabel as stateLabel,
} from "./submission-feedback";
import { WorkspaceLink } from "./workspace-link";

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
          (delivery.state === "DELIVERY_CONFIRMATION_PENDING" ||
            (delivery.state === "DELIVERY_CONFIRMATION_CONFIRMED" && entry.confirmedDelivery)) ? (
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
                {delivery?.state === "DELIVERY_CONFIRMATION_CONFIRMED"
                  ? "上次交期确认已过期或不再适用于该需求，请重新申请工厂确认。"
                  : "客户需要交期或样品时，向工厂申请确认。未经确认的交期不能写入承诺。"}
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
