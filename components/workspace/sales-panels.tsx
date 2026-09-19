"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  CheckCircle2Icon,
  FileSearchIcon,
  LinkIcon,
  PlusIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  startTransition,
  useActionState,
  useEffect,
  useState,
  useTransition,
} from "react";
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
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
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
import { createRfqAction, reviseRfqAction, submitRfqReadyAction } from "@/lib/actions/sales";
import { linkReadyProductToSalesProjectAction } from "@/lib/actions/workspace";
import type { ReadyProductContentSource } from "@/lib/content/store";
import { rfqFormSchema, rfqReadyFormSchema } from "@/lib/form-schemas";
import type { LeadEntry } from "@/lib/sales/closing-store";
import { rfqMissingLabel, salesStateLabels } from "@/lib/sales/journey";
import type { RfqEntry } from "@/lib/sales/store";
import { workspaceCreateHref, workspaceRecordHref } from "@/lib/workspace/navigation";
import type { WorkspaceProductReference } from "@/lib/workspace/store";
import { useWorkspaceDirty } from "./dirty-state";
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

function RfqForm({
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
          id={revising ? `revise-rfq-${entry!.id}` : "create-rfq"}
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
          form={revising ? `revise-rfq-${entry!.id}` : "create-rfq"}
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

function ReadyBoundary({ projectId, entry }: { projectId: string; entry: RfqEntry }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(submitRfqReadyAction, initialSalesActionState);
  const form = useForm<z.infer<typeof rfqReadyFormSchema>>({
    resolver: zodResolver(rfqReadyFormSchema),
    defaultValues: { projectId, rfqId: entry.id, evidenceRef: "" },
  });
  useWorkspaceDirty(`rfq-ready-${entry.id}`, form.formState.isDirty);
  useEffect(() => {
    if (state.status === "success") {
      form.reset();
      router.refresh();
    }
  }, [form, router, state]);
  if (entry.state === "RFQ_READY")
    return (
      <Alert>
        <CheckCircle2Icon />
        <AlertTitle>需求已确认完整</AlertTitle>
        <AlertDescription>可以由人工销售处理报价，报价仍需单独审核和登记发送。</AlertDescription>
      </Alert>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>确认需求完整</CardTitle>
        <CardDescription>
          {entry.missingFields.length
            ? `还需补充：${entry.missingFields.map(rfqMissingLabel).join("、")}`
            : "核对产品身份、数量和目的地后，确认交给人工销售报价。"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id={`rfq-ready-${entry.id}`}
          onSubmit={form.handleSubmit((values) => {
            const data = new FormData();
            for (const [key, value] of Object.entries(values))
              if (value !== undefined) data.set(key, value);
            startTransition(() => action(data));
          })}
        >
          <Field data-invalid={!!form.formState.errors.evidenceRef}>
            <FieldLabel htmlFor={`ready-${entry.id}`}>完整性确认凭据</FieldLabel>
            <Input
              id={`ready-${entry.id}`}
              {...form.register("evidenceRef")}
              aria-invalid={!!form.formState.errors.evidenceRef}
            />
            <FieldError errors={[form.formState.errors.evidenceRef]} />
          </Field>
        </form>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3">
        <Button
          type="submit"
          form={`rfq-ready-${entry.id}`}
          disabled={pending || entry.missingFields.length > 0}
        >
          <ShieldCheckIcon data-icon="inline-start" />
          确认需求完整
        </Button>
        {state.message ? (
          <p
            role="status"
            className={
              state.status === "error"
                ? "text-sm text-destructive"
                : "text-sm text-muted-foreground"
            }
          >
            {state.message}
          </p>
        ) : null}
      </CardFooter>
    </Card>
  );
}

export function RfqPanel({
  projectId,
  entries,
  selectedId,
  selectedLeadId,
  leads = [],
  mode = "collection",
  children,
}: {
  projectId: string;
  entries: RfqEntry[];
  selectedId?: string;
  selectedLeadId?: string;
  leads?: LeadEntry[];
  mode?: "create" | "collection";
  children?: ReactNode;
}) {
  const active = entries.find((entry) => entry.id === selectedId);
  if (active)
    return (
      <div className="flex flex-col gap-4">
        {children}
        <Card>
          <CardHeader>
            <CardTitle>客户需求</CardTitle>
            <CardDescription>
              {salesStateLabels[active.state]} ·{" "}
              {active.formValues.customerName || "客户名称待补充"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">
              {types.find(([type]) => type === active.productType)?.[1]} ·{" "}
              {active.formValues.oeNumber ||
                `${active.formValues.vehicleBrand} ${active.formValues.vehicleModel}`.trim() ||
                "产品身份待补充"}
            </p>
            <p className="text-sm">
              数量：{active.quantity ?? "待补充"} · 目的地：{active.destination ?? "待补充"}
            </p>
            <Progress aria-label="需求完整度" value={active.completenessScore}>
              <ProgressLabel>需求完整度</ProgressLabel>
              <ProgressValue>{() => `${active.completenessScore}%`}</ProgressValue>
            </Progress>
          </CardContent>
        </Card>
        {active.state === "RFQ_COLLECTING" ? (
          <RfqForm key={active.id} projectId={projectId} entry={active} leads={leads} />
        ) : null}
        <ReadyBoundary projectId={projectId} entry={active} />
      </div>
    );
  if (mode === "create" || selectedLeadId || !entries.length)
    return (
      <div className="space-y-4">
        {children}
        <RfqForm projectId={projectId} leads={leads} selectedLeadId={selectedLeadId} />
      </div>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>客户需求</CardTitle>
        <CardDescription>选择已有需求继续，或记录新的询盘。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {entries.map((entry) => (
          <WorkspaceLink
            key={entry.id}
            href={workspaceRecordHref(projectId, "rfq", entry.id)}
            className={buttonVariants({
              variant: "outline",
              className: "h-auto justify-start whitespace-normal py-3 text-left",
            })}
          >
            {entry.formValues.customerName || "客户需求"} · {entry.quantity ?? "数量待补"} ·{" "}
            {salesStateLabels[entry.state]}
          </WorkspaceLink>
        ))}
      </CardContent>
      <CardFooter>
        <WorkspaceLink href={workspaceCreateHref(projectId, "rfq")} className={buttonVariants({})}>
          记录新询盘
        </WorkspaceLink>
      </CardFooter>
    </Card>
  );
}

export function ProductReferencePanel({
  projectId,
  available,
  linked,
}: {
  projectId: string;
  available: ReadyProductContentSource[];
  linked: WorkspaceProductReference[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(
    available.find((item) => !linked.some((reference) => reference.id === item.id))?.id ?? "",
  );
  const [message, setMessage] = useState("");
  const [pending, startLink] = useTransition();
  const candidates = available.filter(
    (item) => !linked.some((reference) => reference.id === item.id),
  );
  const effectiveSelectedId = candidates.some((item) => item.id === selectedId)
    ? selectedId
    : (candidates[0]?.id ?? "");
  function link() {
    if (!effectiveSelectedId) return;
    startLink(async () => {
      const result = await linkReadyProductToSalesProjectAction(projectId, effectiveSelectedId);
      setMessage(result.message);
      if (result.status === "success") router.refresh();
    });
  }
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">产品引用</Badge>
          <Badge variant="outline">已核实产品</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          引用受控产品记录，不复制、不改写产品事实。
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>添加产品引用</CardTitle>
          <CardDescription>选择已核实产品，作为当前客户报价的产品依据。</CardDescription>
        </CardHeader>
        <CardContent>
          {candidates.length ? (
            <Field>
              <FieldLabel htmlFor="sales-product-reference">已核实产品</FieldLabel>
              <Select
                items={Object.fromEntries(
                  candidates.map((item) => [item.id, item.internalSku + " · " + item.productName]),
                )}
                value={effectiveSelectedId}
                onValueChange={(value) => value && setSelectedId(value)}
              >
                <SelectTrigger id="sales-product-reference" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {candidates.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.internalSku} · {item.productName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <p className="text-sm text-muted-foreground">没有可添加的已核实产品。</p>
          )}
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3">
          <Button disabled={pending || !effectiveSelectedId} onClick={link}>
            <LinkIcon data-icon="inline-start" />
            引用到当前项目
          </Button>
          {message ? (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {message}
            </p>
          ) : null}
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>已引用产品</CardTitle>
        </CardHeader>
        <CardContent>
          {linked.length ? (
            <div className="flex flex-col gap-2">
              {linked.map((item) => (
                <Card key={item.id} size="sm">
                  <CardHeader>
                    <CardTitle>{item.internalSku}</CardTitle>
                    <CardDescription>{item.productName}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileSearchIcon />
                </EmptyMedia>
                <EmptyTitle>尚未引用产品</EmptyTitle>
                <EmptyDescription>
                  RFQ 可先收集，但正式报价前必须由人工核对产品身份。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
