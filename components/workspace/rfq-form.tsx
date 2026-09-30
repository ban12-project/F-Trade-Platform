"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, RotateCcwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
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
import { createRfqAction, reviseRfqAction } from "@/lib/actions/sales";
import { rfqFormSchema } from "@/lib/form-schemas";
import type { LeadEntry } from "@/lib/sales/closing-store";
import type { RfqEntry } from "@/lib/sales/store";
import { workspaceRecordHref } from "@/lib/workspace/navigation";
import { useWorkspaceDirty } from "./dirty-state";
import { useCreatedRecord } from "./use-created-record";
import { WorkspaceLink } from "./workspace-link";

const types = [
  ["clutch_disc", "离合器片"],
  ["clutch_cover", "离合器盖 / 压盘"],
  ["release_bearing", "分离轴承"],
  ["clutch_kit", "离合器套件"],
] as const;
type RfqValues = z.infer<typeof rfqFormSchema>;
const emptyRfq: RfqValues = {
  leadId: "",
  customerName: "",
  customerCompany: "",
  customerCountry: "",
  productType: "clutch_kit",
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
  const revising = Boolean(entry);
  const [state, action, pending] = useActionState(
    revising ? reviseRfqAction : createRfqAction,
    initialSalesActionState,
  );
  const form = useForm<RfqValues>({
    resolver: zodResolver(rfqFormSchema),
    defaultValues: entry
      ? { ...entry.formValues, evidenceRef: "" }
      : { ...emptyRfq, leadId: selectedLeadId ?? "" },
  });
  useWorkspaceDirty(`rfq-${entry?.id ?? "new"}`, form.formState.isDirty);
  useEffect(() => {
    if (state.status === "success") {
      form.reset(revising ? form.getValues() : { ...emptyRfq, leadId: selectedLeadId ?? "" });
      router.refresh();
    }
  }, [form, revising, router, state, selectedLeadId]);
  useCreatedRecord(projectId, "rfq", state.status, state.rfqId, !revising);
  function submit(values: RfqValues) {
    const data = new FormData();
    data.set("projectId", projectId);
    if (entry) data.set("rfqId", entry.id);
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    startTransition(() => action(data));
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{revising ? "补充询盘" : "录入询盘"}</CardTitle>
        <CardDescription>
          先收齐产品身份、数量和目的地；本表单不接受价格、MOQ、交期或付款承诺。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id={revising ? `revise-rfq-${entry?.id}` : "create-rfq"}
          onSubmit={form.handleSubmit(submit)}
        >
          <FieldGroup>
            {!revising && leads.some((lead) => lead.state === "LEAD_RECEIVED") ? (
              <Field data-invalid={!!form.formState.errors.leadId}>
                <FieldLabel htmlFor="rfq-lead">来源客户会话（可选）</FieldLabel>
                <Controller
                  control={form.control}
                  name="leadId"
                  render={({ field }) => (
                    <Select
                      disabled={Boolean(selectedLeadId)}
                      value={field.value || "none"}
                      onValueChange={(value) => field.onChange(value === "none" ? "" : value)}
                    >
                      <SelectTrigger
                        aria-invalid={!!form.formState.errors.leadId}
                        id="rfq-lead"
                        className="min-h-11 w-full"
                      >
                        <SelectValue>
                          {field.value ? `客户会话 ${field.value.slice(0, 8)}` : "不关联客户会话"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="none">不关联客户会话</SelectItem>
                          {leads
                            .filter((lead) => lead.state === "LEAD_RECEIVED")
                            .map((lead) => (
                              <SelectItem key={lead.id} value={lead.id}>
                                {"客户会话 "}
                                {lead.id.slice(0, 8)}
                              </SelectItem>
                            ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldDescription>
                  明确选择后，报价发送会继续同一条线索，不会创建重复线索。
                </FieldDescription>
                <FieldError errors={[form.formState.errors.leadId]} />
              </Field>
            ) : null}
            <FieldSet>
              <FieldLegend>客户与需求</FieldLegend>
              <FieldGroup>
                <Field data-invalid={!!form.formState.errors.customerName}>
                  <FieldLabel htmlFor={`${entry?.id ?? "new"}-customer-name`}>客户名称</FieldLabel>
                  <Input
                    id={`${entry?.id ?? "new"}-customer-name`}
                    {...form.register("customerName")}
                    aria-invalid={!!form.formState.errors.customerName}
                  />
                  <FieldError errors={[form.formState.errors.customerName]} />
                </Field>
                <Field data-invalid={!!form.formState.errors.customerCompany}>
                  <FieldLabel htmlFor={`${entry?.id ?? "new"}-company`}>公司</FieldLabel>
                  <Input
                    id={`${entry?.id ?? "new"}-company`}
                    {...form.register("customerCompany")}
                    aria-invalid={!!form.formState.errors.customerCompany}
                  />
                  <FieldError errors={[form.formState.errors.customerCompany]} />
                </Field>
                <Field data-invalid={!!form.formState.errors.customerCountry}>
                  <FieldLabel htmlFor={`${entry?.id ?? "new"}-country`}>国家</FieldLabel>
                  <Input
                    id={`${entry?.id ?? "new"}-country`}
                    {...form.register("customerCountry")}
                    aria-invalid={!!form.formState.errors.customerCountry}
                  />
                  <FieldError errors={[form.formState.errors.customerCountry]} />
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
                        items={Object.fromEntries(types)}
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger
                          aria-invalid={!!form.formState.errors.productType}
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
                  <FieldError errors={[form.formState.errors.productType]} />
                </Field>
                <Field data-invalid={!!form.formState.errors.oeNumber}>
                  <FieldLabel htmlFor={`${entry?.id ?? "new"}-oe`}>OE / OEM 编号</FieldLabel>
                  <Input
                    id={`${entry?.id ?? "new"}-oe`}
                    {...form.register("oeNumber")}
                    aria-invalid={!!form.formState.errors.oeNumber}
                  />
                  <FieldError errors={[form.formState.errors.oeNumber]} />
                </Field>
                <Field data-invalid={!!form.formState.errors.vehicleBrand}>
                  <FieldLabel htmlFor={`${entry?.id ?? "new"}-brand`}>车辆品牌</FieldLabel>
                  <Input
                    id={`${entry?.id ?? "new"}-brand`}
                    {...form.register("vehicleBrand")}
                    aria-invalid={!!form.formState.errors.vehicleBrand}
                  />
                  <FieldError errors={[form.formState.errors.vehicleBrand]} />
                </Field>
                <Field data-invalid={!!form.formState.errors.vehicleModel}>
                  <FieldLabel htmlFor={`${entry?.id ?? "new"}-model`}>车型</FieldLabel>
                  <Input
                    id={`${entry?.id ?? "new"}-model`}
                    {...form.register("vehicleModel")}
                    aria-invalid={!!form.formState.errors.vehicleModel}
                  />
                  <FieldError errors={[form.formState.errors.vehicleModel]} />
                </Field>
                <Field data-invalid={!!form.formState.errors.quantity}>
                  <FieldLabel htmlFor={`${entry?.id ?? "new"}-quantity`}>数量</FieldLabel>
                  <Input
                    id={`${entry?.id ?? "new"}-quantity`}
                    inputMode="numeric"
                    {...form.register("quantity")}
                    aria-invalid={!!form.formState.errors.quantity}
                  />
                  <FieldError errors={[form.formState.errors.quantity]} />
                </Field>
                <Field data-invalid={!!form.formState.errors.destination}>
                  <FieldLabel htmlFor={`${entry?.id ?? "new"}-destination`}>
                    目的地国家或港口
                  </FieldLabel>
                  <Input
                    id={`${entry?.id ?? "new"}-destination`}
                    {...form.register("destination")}
                    aria-invalid={!!form.formState.errors.destination}
                  />
                  <FieldError errors={[form.formState.errors.destination]} />
                </Field>
              </FieldGroup>
            </FieldSet>
            <Field data-invalid={!!form.formState.errors.evidenceRef}>
              <FieldLabel htmlFor={`${entry?.id ?? "new"}-evidence`}>录入证据</FieldLabel>
              <Input
                id={`${entry?.id ?? "new"}-evidence`}
                placeholder="evidence-rfq-001"
                {...form.register("evidenceRef")}
                aria-invalid={!!form.formState.errors.evidenceRef}
              />
              <FieldError errors={[form.formState.errors.evidenceRef]} />
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3">
        <Button
          form={revising ? `revise-rfq-${entry?.id}` : "create-rfq"}
          type="submit"
          disabled={pending}
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
