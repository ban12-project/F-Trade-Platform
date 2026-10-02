"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Clock3Icon, ShieldCheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect } from "react";
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import { decideDeliveryAction } from "@/lib/actions/closing";
import { deliveryDecisionFormSchema } from "@/lib/form-schemas";
import type { DeliveryConfirmationEntry } from "@/lib/sales/closing-store";
import { useWorkspaceDirty } from "./dirty-state";
import {
  SubmissionFeedback as Message,
  salesRecordStateLabel as stateLabel,
} from "./submission-feedback";

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
