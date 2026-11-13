"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, RotateCcwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
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
import { initialSalesActionState } from "@/lib/action-states";
import { createRfqAction, reviseRfqAction, suggestInquiryAction } from "@/lib/actions/sales";
import { inquirySuggestionRequestSchema, rfqFormSchema } from "@/lib/form-schemas";
import { updateRfqDraft } from "@/lib/rfq/assessment";
import {
  readRfqCustomerRequirements,
  rfqCustomerRequirements,
} from "@/lib/rfq/customer-requirements";
import { nextClarification } from "@/lib/sales/clarification";
import type { LeadEntry } from "@/lib/sales/closing-store";
import { type InquiryField, inquiryFieldLabels } from "@/lib/sales/inquiry-history";
import type { InquirySuggestion } from "@/lib/sales/inquiry-suggestions";
import { leadChoiceLabel } from "@/lib/sales/lead-choice-label";
import type { RfqEntry } from "@/lib/sales/store";
import { workspaceRecordHref } from "@/lib/workspace/navigation";
import { useWorkspaceDirty } from "./dirty-state";
import { EvidenceSelectField } from "./evidence-select";
import { useCreatedRecord } from "./use-created-record";
import { WorkspaceLink } from "./workspace-link";

const types = [
  ["", "待确认"],
  ["clutch_disc", "离合器片"],
  ["clutch_cover", "离合器盖 / 压盘"],
  ["release_bearing", "分离轴承"],
  ["clutch_kit", "离合器套件"],
] as const;
type RfqValues = z.input<typeof rfqFormSchema>;
const emptyRfq: RfqValues = {
  ...readRfqCustomerRequirements(undefined),
  leadId: "",
  customerName: "",
  customerCompany: "",
  customerCountry: "",
  productType: "",
  oeNumber: "",
  vehicleBrand: "",
  vehicleModel: "",
  quantity: "",
  destination: "",
  evidenceRef: "",
};

export function RfqForm({
  projectId,
  entry,
  leads,
  selectedLeadId,
}: {
  projectId: string;
  entry?: RfqEntry;
  leads: LeadEntry[];
  selectedLeadId?: string;
}) {
  const router = useRouter();
  const errorPrefix = useId();
  const revising = Boolean(entry);
  const [state, action, pending] = useActionState(
    revising ? reviseRfqAction : createRfqAction,
    initialSalesActionState,
  );
  const form = useForm<RfqValues, unknown, z.output<typeof rfqFormSchema>>({
    resolver: zodResolver(rfqFormSchema),
    defaultValues: entry
      ? { ...entry.formValues, evidenceRef: "" }
      : { ...emptyRfq, leadId: selectedLeadId ?? "" },
  });
  const busy = !form.formState.isReady || pending;
  function errorDescription(field: keyof RfqValues) {
    return form.formState.errors[field] ? `${errorPrefix}-${field}-error` : undefined;
  }
  const values = useWatch({ control: form.control });
  const leadLabels = new Map(leads.map((lead) => [lead.id, leadChoiceLabel(lead)]));
  const [suggesting, startSuggesting] = useTransition();
  const [suggestion, setSuggestion] = useState<InquirySuggestion | null>(null);
  const [suggestionMessage, setSuggestionMessage] = useState("");
  const suggestionRequest = useRef(0);
  const suggestionContext = `${projectId}:${entry?.id ?? "new"}:${values.leadId ?? ""}`;
  const suggestionContextRef = useRef(suggestionContext);
  useEffect(() => {
    suggestionContextRef.current = suggestionContext;
    setSuggestion(null);
    setSuggestionMessage("");
    suggestionRequest.current += 1;
    return () => {
      suggestionRequest.current += 1;
    };
  }, [suggestionContext]);
  const clarification = nextClarification(
    updateRfqDraft(
      {
        product: {
          product_type: values.productType,
          oe_number: values.oeNumber,
          vehicle_brand: values.vehicleBrand,
          vehicle_model: values.vehicleModel,
        },
        commercial: { quantity: Number(values.quantity), destination: values.destination },
      },
      {},
    ),
  );
  function suggestInquiry() {
    if (busy || suggesting) return;
    const parsed = inquirySuggestionRequestSchema.safeParse({
      projectId,
      leadId: form.getValues("leadId"),
    });
    if (!parsed.success) {
      setSuggestionMessage("请先选择来源客户会话。");
      return;
    }
    const requestId = ++suggestionRequest.current;
    const requestContext = suggestionContext;
    setSuggestionMessage("");
    startSuggesting(async () => {
      try {
        const result = await suggestInquiryAction(parsed.data);
        if (
          requestId !== suggestionRequest.current ||
          requestContext !== suggestionContextRef.current ||
          form.getValues("leadId") !== parsed.data.leadId
        )
          return;
        if (result.status === "error") {
          setSuggestionMessage(result.message);
          return;
        }
        // Read the current values after the response: edits made while waiting must also survive.
        let applied = 0;
        for (const [key, value] of Object.entries(result.suggestion.fields)) {
          const field = key as keyof InquirySuggestion["fields"];
          if (value && !form.getValues(field).trim()) {
            form.setValue(field, value, { shouldDirty: true, shouldValidate: true });
            applied += 1;
          }
        }
        setSuggestion(result.suggestion);
        setSuggestionMessage(
          applied
            ? `已整理 ${applied} 项建议到空白字段，请核对后保存。`
            : "没有可补入的明确需求；已有填写保持原样，请继续核对客户会话。",
        );
      } catch {
        if (requestId === suggestionRequest.current)
          setSuggestionMessage("无法整理客户需求，请稍后重试或手动录入。");
      }
    });
  }
  useWorkspaceDirty(`rfq-${entry?.id ?? "new"}`, form.formState.isDirty);
  useEffect(() => {
    if (state.status === "success") {
      form.reset(revising ? form.getValues() : { ...emptyRfq, leadId: selectedLeadId ?? "" });
      router.refresh();
    }
  }, [form, revising, router, state, selectedLeadId]);
  useCreatedRecord(projectId, "rfq", state.status, state.rfqId, !revising);
  function submit(values: RfqValues) {
    if (busy || suggesting) return;
    const data = new FormData();
    data.set("projectId", projectId);
    if (entry) data.set("rfqId", entry.id);
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) data.set(key, value);
    }
    startTransition(() => action(data));
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{revising ? "补充询盘" : "录入询盘"}</CardTitle>
        <CardDescription>
          先收齐产品身份、数量和目的地；本表单不接受价格、MOQ、工厂交期或付款承诺。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id={revising ? `revise-rfq-${entry?.id}` : "create-rfq"}
          aria-busy={busy}
          onSubmit={form.handleSubmit(submit)}
        >
          <FieldSet disabled={busy}>
            <FieldGroup>
              {!revising && leads.some((lead) => lead.state === "LEAD_RECEIVED") ? (
                <Field data-invalid={!!form.formState.errors.leadId}>
                  <FieldLabel htmlFor="rfq-lead">来源客户会话（可选）</FieldLabel>
                  <Controller
                    control={form.control}
                    name="leadId"
                    render={({ field }) => (
                      <Select
                        disabled={busy || Boolean(selectedLeadId)}
                        value={field.value || "none"}
                        onValueChange={(value) => field.onChange(value === "none" ? "" : value)}
                      >
                        <SelectTrigger
                          ref={field.ref}
                          onBlur={field.onBlur}
                          aria-invalid={!!form.formState.errors.leadId}
                          aria-describedby={errorDescription("leadId")}
                          id="rfq-lead"
                          className="min-h-11 w-full py-2 data-[size=default]:h-auto [&_[data-slot=select-value]]:line-clamp-none"
                        >
                          <SelectValue>
                            <span className="min-w-0 whitespace-normal wrap-anywhere text-left">
                              {field.value
                                ? (leadLabels.get(field.value) ?? "已选会话暂不可显示，请核对来源")
                                : "不关联客户会话"}
                            </span>
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="none">不关联客户会话</SelectItem>
                            {leads
                              .filter((lead) => lead.state === "LEAD_RECEIVED")
                              .map((lead) => (
                                <SelectItem
                                  key={lead.id}
                                  value={lead.id}
                                  className="min-h-11 [&>span]:min-w-0 [&>span]:shrink"
                                  title={lead.id}
                                >
                                  <span className="min-w-0 whitespace-normal wrap-anywhere">
                                    {leadLabels.get(lead.id)}
                                  </span>
                                </SelectItem>
                              ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldDescription>
                    摘要来自最近一条有效客户消息，仅用于识别会话；选择不会自动填写询盘。明确选择后，报价发送会继续同一条线索。
                  </FieldDescription>
                  <FieldError
                    id={errorDescription("leadId")}
                    errors={[form.formState.errors.leadId]}
                  />
                </Field>
              ) : null}
              {values.leadId ? (
                <FieldSet>
                  <FieldLegend>整理客户消息</FieldLegend>
                  <FieldDescription>
                    按规则汇总最近 30
                    条有效客户消息中的数量、目的地和产品身份，仅填入没有冲突的空白字段。客户提出的适配需求尚未核验，请逐项核对后保存。
                  </FieldDescription>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={suggesting || busy}
                    onClick={suggestInquiry}
                  >
                    {suggesting ? <Spinner /> : null}
                    从客户消息整理建议
                  </Button>
                  <WorkspaceLink
                    href={workspaceRecordHref(projectId, "lead", values.leadId)}
                    className="text-sm underline underline-offset-4"
                  >
                    查看客户会话
                  </WorkspaceLink>
                  {suggestionMessage ? (
                    <p role="status" className="text-sm">
                      {suggestionMessage}
                    </p>
                  ) : null}
                  {suggestion ? (
                    <>
                      <FieldDescription>
                        已整理 {suggestion.messages.length} 条有效客户消息。最新来源消息{" "}
                        {suggestion.source.messageId.slice(0, 8)} ·{" "}
                        {new Date(suggestion.source.receivedAt).toLocaleString("zh-CN")}
                      </FieldDescription>
                      {Object.entries(suggestion.fieldSources).map(([field, ids]) => (
                        <FieldDescription key={field}>
                          {inquiryFieldLabels[field as InquiryField]}来源：
                          {suggestion.messages
                            .filter((message) => ids?.includes(message.id))
                            .map(
                              (message) =>
                                `${message.id.slice(0, 8)} · ${new Date(message.receivedAt).toLocaleString("zh-CN")}`,
                            )
                            .join("、")}
                        </FieldDescription>
                      ))}
                      {suggestion.conflicts.length ? (
                        <FieldDescription>
                          需要人工核对：
                          {suggestion.conflicts
                            .map((field) => inquiryFieldLabels[field])
                            .join("、")}
                          。 消息包含不同值或不明确的表达，这些字段未自动补入。
                        </FieldDescription>
                      ) : null}
                      {suggestion.truncated ? (
                        <FieldDescription>
                          仅整理最近 30 条有效客户消息，较早消息未纳入；请结合完整会话核对。
                        </FieldDescription>
                      ) : null}
                    </>
                  ) : null}
                  {clarification.status === "clarification_required" ? (
                    <FieldDescription>可向客户补问：{clarification.message}</FieldDescription>
                  ) : (
                    <FieldDescription>
                      字段已完整；仍需保存并人工确认需求，才能交接报价。
                    </FieldDescription>
                  )}
                </FieldSet>
              ) : null}
              <FieldSet>
                <FieldLegend>客户与需求</FieldLegend>
                <FieldGroup>
                  <Field data-invalid={!!form.formState.errors.customerName}>
                    <FieldLabel htmlFor={`${entry?.id ?? "new"}-customer-name`}>
                      客户名称
                    </FieldLabel>
                    <Input
                      id={`${entry?.id ?? "new"}-customer-name`}
                      {...form.register("customerName")}
                      aria-invalid={!!form.formState.errors.customerName}
                      aria-describedby={errorDescription("customerName")}
                    />
                    <FieldError
                      id={errorDescription("customerName")}
                      errors={[form.formState.errors.customerName]}
                    />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.customerCompany}>
                    <FieldLabel htmlFor={`${entry?.id ?? "new"}-company`}>公司</FieldLabel>
                    <Input
                      id={`${entry?.id ?? "new"}-company`}
                      {...form.register("customerCompany")}
                      aria-invalid={!!form.formState.errors.customerCompany}
                      aria-describedby={errorDescription("customerCompany")}
                    />
                    <FieldError
                      id={errorDescription("customerCompany")}
                      errors={[form.formState.errors.customerCompany]}
                    />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.customerCountry}>
                    <FieldLabel htmlFor={`${entry?.id ?? "new"}-country`}>国家</FieldLabel>
                    <Input
                      id={`${entry?.id ?? "new"}-country`}
                      {...form.register("customerCountry")}
                      aria-invalid={!!form.formState.errors.customerCountry}
                      aria-describedby={errorDescription("customerCountry")}
                    />
                    <FieldError
                      id={errorDescription("customerCountry")}
                      errors={[form.formState.errors.customerCountry]}
                    />
                  </Field>
                </FieldGroup>
              </FieldSet>
              <FieldSet>
                <FieldLegend>产品与交付信息</FieldLegend>
                <FieldGroup>
                  <Field data-invalid={!!form.formState.errors.productType}>
                    <FieldLabel htmlFor={`${entry?.id ?? "new"}-product-type`}>产品类型</FieldLabel>
                    <Controller
                      control={form.control}
                      name="productType"
                      render={({ field }) => (
                        <Select
                          disabled={busy}
                          items={Object.fromEntries(types)}
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger
                            ref={field.ref}
                            onBlur={field.onBlur}
                            aria-invalid={!!form.formState.errors.productType}
                            aria-describedby={errorDescription("productType")}
                            id={`${entry?.id ?? "new"}-product-type`}
                            className="w-full"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {types.map(([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <FieldError
                      id={errorDescription("productType")}
                      errors={[form.formState.errors.productType]}
                    />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.oeNumber}>
                    <FieldLabel htmlFor={`${entry?.id ?? "new"}-oe`}>OE / OEM 编号</FieldLabel>
                    <Input
                      id={`${entry?.id ?? "new"}-oe`}
                      {...form.register("oeNumber")}
                      aria-invalid={!!form.formState.errors.oeNumber}
                      aria-describedby={errorDescription("oeNumber")}
                    />
                    <FieldError
                      id={errorDescription("oeNumber")}
                      errors={[form.formState.errors.oeNumber]}
                    />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.vehicleBrand}>
                    <FieldLabel htmlFor={`${entry?.id ?? "new"}-brand`}>车辆品牌</FieldLabel>
                    <Input
                      id={`${entry?.id ?? "new"}-brand`}
                      {...form.register("vehicleBrand")}
                      aria-invalid={!!form.formState.errors.vehicleBrand}
                      aria-describedby={errorDescription("vehicleBrand")}
                    />
                    <FieldError
                      id={errorDescription("vehicleBrand")}
                      errors={[form.formState.errors.vehicleBrand]}
                    />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.vehicleModel}>
                    <FieldLabel htmlFor={`${entry?.id ?? "new"}-model`}>车型</FieldLabel>
                    <Input
                      id={`${entry?.id ?? "new"}-model`}
                      {...form.register("vehicleModel")}
                      aria-invalid={!!form.formState.errors.vehicleModel}
                      aria-describedby={errorDescription("vehicleModel")}
                    />
                    <FieldError
                      id={errorDescription("vehicleModel")}
                      errors={[form.formState.errors.vehicleModel]}
                    />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.quantity}>
                    <FieldLabel htmlFor={`${entry?.id ?? "new"}-quantity`}>数量</FieldLabel>
                    <Input
                      id={`${entry?.id ?? "new"}-quantity`}
                      inputMode="numeric"
                      {...form.register("quantity")}
                      aria-invalid={!!form.formState.errors.quantity}
                      aria-describedby={errorDescription("quantity")}
                    />
                    <FieldError
                      id={errorDescription("quantity")}
                      errors={[form.formState.errors.quantity]}
                    />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.destination}>
                    <FieldLabel htmlFor={`${entry?.id ?? "new"}-destination`}>
                      目的地国家或港口
                    </FieldLabel>
                    <Input
                      id={`${entry?.id ?? "new"}-destination`}
                      {...form.register("destination")}
                      aria-invalid={!!form.formState.errors.destination}
                      aria-describedby={errorDescription("destination")}
                    />
                    <FieldError
                      id={errorDescription("destination")}
                      errors={[form.formState.errors.destination]}
                    />
                  </Field>
                </FieldGroup>
              </FieldSet>
              <FieldSet>
                <FieldLegend>客户补充需求（可选）</FieldLegend>
                <FieldDescription>
                  按客户原意记录，留待报价人员核对。车型、发动机和规格尚未核验；期望交付不是工厂交期承诺。
                </FieldDescription>
                <FieldGroup>
                  {rfqCustomerRequirements.map(({ field, label }) => (
                    <Field key={field} data-invalid={!!form.formState.errors[field]}>
                      <FieldLabel htmlFor={`${entry?.id ?? "new"}-${field}`}>{label}</FieldLabel>
                      <Input
                        id={`${entry?.id ?? "new"}-${field}`}
                        {...form.register(field)}
                        aria-invalid={!!form.formState.errors[field]}
                        aria-describedby={errorDescription(field)}
                      />
                      <FieldError
                        id={errorDescription(field)}
                        errors={[form.formState.errors[field]]}
                      />
                    </Field>
                  ))}
                </FieldGroup>
              </FieldSet>
              <Field data-invalid={!!form.formState.errors.evidenceRef}>
                <FieldLabel htmlFor={`${entry?.id ?? "new"}-evidence`}>客户需求来源</FieldLabel>
                <EvidenceSelectField
                  disabled={busy}
                  projectId={projectId}
                  control={form.control}
                  name="evidenceRef"
                  aria-describedby={errorDescription("evidenceRef")}
                  id={`${entry?.id ?? "new"}-evidence`}
                />
                <FieldError
                  id={errorDescription("evidenceRef")}
                  errors={[form.formState.errors.evidenceRef]}
                />
              </Field>
            </FieldGroup>
          </FieldSet>
        </form>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3">
        <Button
          form={revising ? `revise-rfq-${entry?.id}` : "create-rfq"}
          type="submit"
          disabled={busy || suggesting}
        >
          {pending ? (
            <Spinner data-icon="inline-start" />
          ) : revising ? (
            <RotateCcwIcon data-icon="inline-start" />
          ) : (
            <PlusIcon data-icon="inline-start" />
          )}
          {revising ? "保存补充资料" : "保存询盘"}
        </Button>
        {state.status === "success" && state.rfqId && !revising ? (
          <WorkspaceLink
            href={workspaceRecordHref(projectId, "rfq", state.rfqId)}
            className={buttonVariants({ variant: "outline" })}
          >
            打开客户需求
          </WorkspaceLink>
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
