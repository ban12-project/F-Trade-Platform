"use client";

import { useActionState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftIcon, RotateCcwIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { initialProductActionState, reviseProductCatalogDraftAction } from "@/lib/actions/products";
import { productCatalogFormSchema } from "@/lib/form-schemas";
import type { ProductCatalogDetail } from "@/lib/products";

const productTypes = [
  { value: "clutch_disc", label: "离合器片" },
  { value: "clutch_cover", label: "离合器盖 / 压盘" },
  { value: "release_bearing", label: "分离轴承" },
  { value: "clutch_kit", label: "离合器套件" },
] as const;

type ProductCatalogFormValues = z.infer<typeof productCatalogFormSchema>;

function textValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function ProductRevisionPanel({ product }: { product: ProductCatalogDetail }) {
  const [state, formAction, pending] = useActionState(reviseProductCatalogDraftAction, initialProductActionState);
  const [, startTransition] = useTransition();
  const draftProduct = product.draft.product;
  const specifications = product.draft.specifications ?? {};
  const form = useForm<ProductCatalogFormValues>({
    resolver: zodResolver(productCatalogFormSchema),
    defaultValues: {
      productName: textValue(draftProduct.product_name),
      productType: (draftProduct.product_type as ProductCatalogFormValues["productType"]) ?? "clutch_disc",
      internalSku: textValue(draftProduct.internal_sku),
      oeNumbers: Array.isArray(draftProduct.oe_numbers) ? draftProduct.oe_numbers.filter((value): value is string => typeof value === "string").join(", ") : "",
      application: textValue(draftProduct.application),
      vehicleBrand: textValue(draftProduct.vehicle_brand),
      vehicleModel: textValue(draftProduct.vehicle_model),
      clutchDiameterMm: textValue(specifications.clutch_diameter_mm),
      splineCount: textValue(specifications.spline_count),
      splineSize: textValue(specifications.spline_size),
      frictionMaterial: textValue(specifications.friction_material),
      sourceRef: product.draft.source_ref,
      evidenceRef: product.draft.evidence_refs[0] ?? "",
    },
  });

  function onSubmit(values: ProductCatalogFormValues) {
    const formData = new FormData();
    formData.set("productId", product.id);
    for (const [key, value] of Object.entries(values)) formData.set(key, value);
    startTransition(() => formAction(formData));
  }

  if (product.state !== "PRODUCT_REVISION_REQUIRED") {
    return <main className="mx-auto min-h-svh w-full max-w-4xl p-6"><Alert><AlertTitle>当前无需修订</AlertTitle><AlertDescription>该产品未处于待修订状态。</AlertDescription></Alert></main>;
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-3">
        <Button className="w-fit" size="sm" variant="ghost" render={<Link href={`/console/products/${product.id}`} />}><ArrowLeftIcon data-icon="inline-start" />返回审核</Button>
        <h1 className="text-2xl font-semibold tracking-tight">修订产品草稿</h1>
        <p className="text-muted-foreground">仅补录或更正有来源依据的字段；提交后会重新创建一条待处理的 Gate 01 审核。</p>
      </header>
      <Alert><ShieldCheckIcon /><AlertTitle>不得以猜测补齐</AlertTitle><AlertDescription>拒绝原因应由审核备注和受控证据处理。每个已填写字段必须有可复核来源。</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle>{product.internalSku}</CardTitle><CardDescription>原草稿会被新修订稿替换为当前版本，历史决定保留在审批与事件记录中。</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <FieldGroup>
              <FieldGroup className="grid gap-4 md:grid-cols-2">
                <Field data-invalid={!!form.formState.errors.productName}><FieldLabel htmlFor="product-name">产品名称</FieldLabel><Input id="product-name" aria-invalid={!!form.formState.errors.productName} {...form.register("productName")} /><FieldError errors={[form.formState.errors.productName]} /></Field>
                <Field data-invalid={!!form.formState.errors.productType}><FieldLabel>产品类型</FieldLabel><Controller control={form.control} name="productType" render={({ field }) => <Select value={field.value} onValueChange={field.onChange}><SelectTrigger className="w-full" aria-invalid={!!form.formState.errors.productType}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{productTypes.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}</SelectGroup></SelectContent></Select>} /><FieldError errors={[form.formState.errors.productType]} /></Field>
              </FieldGroup>
              <FieldGroup className="grid gap-4 md:grid-cols-2">
                <Field data-invalid={!!form.formState.errors.internalSku}><FieldLabel htmlFor="internal-sku">内部编号</FieldLabel><Input id="internal-sku" aria-invalid={!!form.formState.errors.internalSku} {...form.register("internalSku")} /><FieldError errors={[form.formState.errors.internalSku]} /></Field>
                <Field><FieldLabel htmlFor="oe-numbers">OE / OEM 编号</FieldLabel><Input id="oe-numbers" {...form.register("oeNumbers")} /></Field>
              </FieldGroup>
              <FieldSet><FieldLegend>适配信息</FieldLegend><FieldGroup className="grid gap-4 md:grid-cols-3"><Field><FieldLabel htmlFor="application">适配说明</FieldLabel><Input id="application" {...form.register("application")} /></Field><Field><FieldLabel htmlFor="vehicle-brand">车辆品牌</FieldLabel><Input id="vehicle-brand" {...form.register("vehicleBrand")} /></Field><Field><FieldLabel htmlFor="vehicle-model">车型</FieldLabel><Input id="vehicle-model" {...form.register("vehicleModel")} /></Field></FieldGroup></FieldSet>
              <FieldSet><FieldLegend>离合器规格</FieldLegend><FieldDescription>若无来源依据请留空。</FieldDescription><FieldGroup className="grid gap-4 md:grid-cols-2"><Field data-invalid={!!form.formState.errors.clutchDiameterMm}><FieldLabel htmlFor="clutch-diameter">盘径（mm）</FieldLabel><Input id="clutch-diameter" inputMode="decimal" aria-invalid={!!form.formState.errors.clutchDiameterMm} {...form.register("clutchDiameterMm")} /><FieldError errors={[form.formState.errors.clutchDiameterMm]} /></Field><Field data-invalid={!!form.formState.errors.splineCount}><FieldLabel htmlFor="spline-count">花键数</FieldLabel><Input id="spline-count" inputMode="numeric" aria-invalid={!!form.formState.errors.splineCount} {...form.register("splineCount")} /><FieldError errors={[form.formState.errors.splineCount]} /></Field><Field><FieldLabel htmlFor="spline-size">花键尺寸</FieldLabel><Input id="spline-size" {...form.register("splineSize")} /></Field><Field><FieldLabel htmlFor="friction-material">摩擦材料</FieldLabel><Input id="friction-material" {...form.register("frictionMaterial")} /></Field></FieldGroup></FieldSet>
              <FieldSet><FieldLegend>来源与证据</FieldLegend><FieldGroup className="grid gap-4 md:grid-cols-2"><Field data-invalid={!!form.formState.errors.sourceRef}><FieldLabel htmlFor="source-ref">来源引用</FieldLabel><Input id="source-ref" aria-invalid={!!form.formState.errors.sourceRef} {...form.register("sourceRef")} /><FieldError errors={[form.formState.errors.sourceRef]} /></Field><Field data-invalid={!!form.formState.errors.evidenceRef}><FieldLabel htmlFor="evidence-ref">字段证据引用</FieldLabel><Input id="evidence-ref" aria-invalid={!!form.formState.errors.evidenceRef} {...form.register("evidenceRef")} /><FieldError errors={[form.formState.errors.evidenceRef]} /></Field></FieldGroup></FieldSet>
              <div className="flex justify-end"><Button type="submit" disabled={pending}><RotateCcwIcon data-icon="inline-start" />提交修订并送审</Button></div>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter>修订提交不会自动批准产品。</CardFooter>
      </Card>
      {state.status !== "idle" && <Alert variant={state.status === "error" ? "destructive" : "default"}><AlertTitle>{state.status === "success" ? "已提交" : "未能提交"}</AlertTitle><AlertDescription>{state.message}</AlertDescription></Alert>}
    </main>
  );
}
