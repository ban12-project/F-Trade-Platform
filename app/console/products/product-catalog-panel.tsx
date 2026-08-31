"use client";

import { useActionState, useEffect, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { BotIcon, FileCheck2Icon, PlusIcon, ShieldCheckIcon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createProductCatalogDraftAction, initialProductActionState } from "@/lib/actions/products";
import { productCatalogFormSchema } from "@/lib/form-schemas";
import type { ProductCatalogEntry } from "@/lib/products";

const productTypes = [
  { value: "clutch_disc", label: "离合器片" },
  { value: "clutch_cover", label: "离合器盖 / 压盘" },
  { value: "release_bearing", label: "分离轴承" },
  { value: "clutch_kit", label: "离合器套件" },
] as const;

type ProductCatalogFormValues = z.infer<typeof productCatalogFormSchema>;

function ProductTypeLabel({ value }: { value: string }) {
  return productTypes.find((type) => type.value === value)?.label ?? value;
}

function ProductStateLabel({ value }: { value: string }) {
  const labels: Record<string, string> = {
    PRODUCT_REVIEW_REQUIRED: "待 Gate 01 审核",
    PRODUCT_REVISION_REQUIRED: "待修订",
    PRODUCT_READY: "已通过 Gate 01",
  };
  return <Badge variant="secondary">{labels[value] ?? value}</Badge>;
}

export function ProductCatalogPanel({ entries, canReview }: { entries: ProductCatalogEntry[]; canReview: boolean }) {
  const [state, formAction, pending] = useActionState(createProductCatalogDraftAction, initialProductActionState);
  const [, startTransition] = useTransition();
  const form = useForm<ProductCatalogFormValues>({
    resolver: zodResolver(productCatalogFormSchema),
    defaultValues: {
      productName: "",
      productType: "clutch_disc",
      internalSku: "",
      oeNumbers: "",
      application: "",
      vehicleBrand: "",
      vehicleModel: "",
      clutchDiameterMm: "",
      splineCount: "",
      splineSize: "",
      frictionMaterial: "",
      sourceRef: "",
      evidenceRef: "",
    },
  });

  useEffect(() => {
    if (state.status === "success") form.reset();
  }, [form, state.status]);

  function onSubmit(values: ProductCatalogFormValues) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(values)) formData.set(key, value);
    startTransition(() => formAction(formData));
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-6 p-4 md:p-6 lg:p-8">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-2"><div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">产品资料</Badge>
          <Badge variant="outline">需要人工事实审核（Gate 01）</Badge>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-balance">离合器目录录入</h1>
        <p className="max-w-3xl text-muted-foreground">
          按目录中的图片、编号、原厂件编号（OE）、适配和规格录入。保存后只会创建待复核草稿；系统不会把目录内容自动认定为工程事实。
        </p>
        </div><LinkButton variant="outline" href="/console/product-agent"><BotIcon data-icon="inline-start" />从获授权资料导入</LinkButton>
      </header>

      <Alert>
        <ShieldCheckIcon />
        <AlertTitle>资料保管边界</AlertTitle>
        <AlertDescription>
          请填写 Private Blob 或受控系统中的脱敏来源与证据引用。不要填写本机路径、公开链接或把目录 PDF 上传到 Git。
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.72fr)]">
        <Card id="new-product">
          <CardHeader>
            <CardTitle>新建产品草稿</CardTitle>
            <CardDescription>参考目录的字段组织；每个已填写字段将绑定同一条初始证据引用，待人工逐项复核。</CardDescription>
          </CardHeader>
          <CardContent>
            <form autoComplete="off" onSubmit={form.handleSubmit(onSubmit)}>
              <FieldGroup>
                <FieldGroup className="grid gap-4 md:grid-cols-2">
                  <Field data-invalid={!!form.formState.errors.productName}>
                    <FieldLabel htmlFor="product-name">产品名称</FieldLabel>
                    <Input id="product-name" aria-invalid={!!form.formState.errors.productName} {...form.register("productName")} />
                    <FieldError errors={[form.formState.errors.productName]} />
                  </Field>
                  <Field data-invalid={!!form.formState.errors.productType}>
                    <FieldLabel htmlFor="product-type">产品类型</FieldLabel>
                    <Controller
                      control={form.control}
                      name="productType"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger id="product-type" aria-invalid={!!form.formState.errors.productType} className="w-full">
                            <SelectValue placeholder="选择类型…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {productTypes.map((type) => (
                                <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <FieldError errors={[form.formState.errors.productType]} />
                  </Field>
                </FieldGroup>

                <FieldGroup className="grid gap-4 md:grid-cols-2">
                  <Field data-invalid={!!form.formState.errors.internalSku}>
                    <FieldLabel htmlFor="internal-sku">内部编号</FieldLabel>
                    <Input id="internal-sku" aria-invalid={!!form.formState.errors.internalSku} {...form.register("internalSku")} />
                    <FieldError errors={[form.formState.errors.internalSku]} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="oe-numbers">OE / OEM 编号</FieldLabel>
                    <Input id="oe-numbers" placeholder="多个编号请用逗号分隔" {...form.register("oeNumbers")} />
                  </Field>
                </FieldGroup>

                <FieldSet>
                  <FieldLegend>适配信息</FieldLegend>
                  <FieldGroup className="grid gap-4 md:grid-cols-3">
                    <Field><FieldLabel htmlFor="application">适配说明</FieldLabel><Input id="application" {...form.register("application")} /></Field>
                    <Field><FieldLabel htmlFor="vehicle-brand">车辆品牌</FieldLabel><Input id="vehicle-brand" {...form.register("vehicleBrand")} /></Field>
                    <Field><FieldLabel htmlFor="vehicle-model">车型</FieldLabel><Input id="vehicle-model" {...form.register("vehicleModel")} /></Field>
                  </FieldGroup>
                </FieldSet>

                <FieldSet>
                  <FieldLegend>离合器规格</FieldLegend>
                  <FieldDescription>没有来源依据时，请留空。人工智能不能补齐字段。</FieldDescription>
                  <FieldGroup className="grid gap-4 md:grid-cols-2">
                    <Field data-invalid={!!form.formState.errors.clutchDiameterMm}>
                      <FieldLabel htmlFor="clutch-diameter">盘径（mm）</FieldLabel>
                      <Input id="clutch-diameter" inputMode="decimal" aria-invalid={!!form.formState.errors.clutchDiameterMm} {...form.register("clutchDiameterMm")} />
                      <FieldError errors={[form.formState.errors.clutchDiameterMm]} />
                    </Field>
                    <Field data-invalid={!!form.formState.errors.splineCount}>
                      <FieldLabel htmlFor="spline-count">花键数</FieldLabel>
                      <Input id="spline-count" inputMode="numeric" aria-invalid={!!form.formState.errors.splineCount} {...form.register("splineCount")} />
                      <FieldError errors={[form.formState.errors.splineCount]} />
                    </Field>
                    <Field><FieldLabel htmlFor="spline-size">花键尺寸</FieldLabel><Input id="spline-size" {...form.register("splineSize")} /></Field>
                    <Field><FieldLabel htmlFor="friction-material">摩擦材料</FieldLabel><Input id="friction-material" {...form.register("frictionMaterial")} /></Field>
                  </FieldGroup>
                </FieldSet>

                <FieldSet>
                  <FieldLegend>来源与证据</FieldLegend>
                  <FieldDescription>仅接受脱敏私有引用，例如 source-catalog-001 与 evidence-product-001。</FieldDescription>
                  <FieldGroup className="grid gap-4 md:grid-cols-2">
                    <Field data-invalid={!!form.formState.errors.sourceRef}>
                      <FieldLabel htmlFor="source-ref">来源引用</FieldLabel>
                      <Input id="source-ref" aria-invalid={!!form.formState.errors.sourceRef} {...form.register("sourceRef")} />
                      <FieldError errors={[form.formState.errors.sourceRef]} />
                    </Field>
                    <Field data-invalid={!!form.formState.errors.evidenceRef}>
                      <FieldLabel htmlFor="evidence-ref">字段证据引用</FieldLabel>
                      <Input id="evidence-ref" aria-invalid={!!form.formState.errors.evidenceRef} {...form.register("evidenceRef")} />
                      <FieldError errors={[form.formState.errors.evidenceRef]} />
                    </Field>
                  </FieldGroup>
                </FieldSet>
              </FieldGroup>
              <div className="mt-6 flex justify-end">
                <Button type="submit" disabled={pending}>
                  {pending ? <Spinner aria-hidden="true" data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
                  创建待复核草稿
                </Button>
              </div>
            </form>
          </CardContent>
          <CardFooter>正式发布、报价和交期不在此处生成；它们仍需相应人工 Gate。</CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>目录格式映射</CardTitle>
            <CardDescription>本轮仅实现可审计的结构化录入，不复制参考图册的真实字段值。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <div className="flex items-start gap-3"><FileCheck2Icon className="mt-0.5 shrink-0 text-muted-foreground" /><div><p className="font-medium">目录编号</p><p className="text-muted-foreground">映射为内部编号；必须通过来源证据确认。</p></div></div>
            <div className="flex items-start gap-3"><FileCheck2Icon className="mt-0.5 shrink-0 text-muted-foreground" /><div><p className="font-medium">原厂件编号、适配与规格</p><p className="text-muted-foreground">这些字段均可选填。缺失来源或证据时，系统会在人工事实审核中标记阻塞项。</p></div></div>
            <div className="flex items-start gap-3"><FileCheck2Icon className="mt-0.5 shrink-0 text-muted-foreground" /><div><p className="font-medium">产品图片</p><p className="text-muted-foreground">下一步接入受控 Private Blob evidence，不在表单中引用本机或公开文件。</p></div></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>最近录入</CardTitle>
            <CardDescription>所有条目初始状态均为待人工确认。</CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><FileCheck2Icon /></EmptyMedia>
                <EmptyTitle>尚无产品草稿</EmptyTitle>
                <EmptyDescription>从左侧录入第一条由来源证据支撑的产品草稿。</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>参考目录只能帮助组织字段，不能自动生成工程事实。</EmptyContent>
            </Empty>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>内部编号</TableHead><TableHead>产品名称</TableHead><TableHead>类型</TableHead><TableHead>状态</TableHead><TableHead>阻塞项</TableHead><TableHead>操作</TableHead></TableRow></TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">{entry.internalSku}</TableCell>
                    <TableCell>{entry.productName}</TableCell>
                    <TableCell><ProductTypeLabel value={entry.productType} /></TableCell>
                    <TableCell><ProductStateLabel value={entry.state} /></TableCell>
                    <TableCell>{entry.blockingFields.length === 0 ? "字段待 Gate 01 核验" : `${entry.blockingFields.length} 项待补齐/核验`}</TableCell>
                    <TableCell>
                      {entry.state === "PRODUCT_REVIEW_REQUIRED" && entry.approvalStatus === "pending" ? (
                        <LinkButton size="sm" variant="outline" href={`/console/products/${entry.id}`}>{canReview ? "确认" : "查看进度"}</LinkButton>
                      ) : entry.state === "PRODUCT_REVISION_REQUIRED" ? (
                        <LinkButton size="sm" variant="outline" href={`/console/products/${entry.id}/revise`}>修订</LinkButton>
                      ) : "无操作"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {state.status !== "idle" && (
        <Alert variant={state.status === "error" ? "destructive" : "default"}>
          <AlertTitle>{state.status === "success" ? "已保存" : "未能保存"}</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
