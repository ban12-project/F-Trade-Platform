import type { ReactNode } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";

import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProductCatalogDetail } from "@/lib/products";
import type { ProductCatalogForm } from "@/lib/product/catalog-form-schema";

export type ProductValues = ProductCatalogForm;

const productTypes = [
  ["clutch_disc", "离合器片"],
  ["clutch_cover", "离合器盖 / 压盘"],
  ["release_bearing", "分离轴承"],
  ["clutch_kit", "离合器套件"],
] as const;

export const emptyProduct: ProductValues = {
  productName: "",
  productNameEvidenceRef: "",
  productType: "clutch_disc",
  productTypeEvidenceRef: "",
  internalSku: "",
  internalSkuEvidenceRef: "",
  oeNumbers: "",
  oeNumbersEvidenceRef: "",
  application: "",
  applicationEvidenceRef: "",
  vehicleBrand: "",
  vehicleBrandEvidenceRef: "",
  vehicleModel: "",
  vehicleModelEvidenceRef: "",
  clutchDiameterMm: "",
  clutchDiameterMmEvidenceRef: "",
  splineCount: "",
  splineCountEvidenceRef: "",
  splineSize: "",
  splineSizeEvidenceRef: "",
  frictionMaterial: "",
  frictionMaterialEvidenceRef: "",
  sourceRef: "",
};

function textValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function evidence(detail: ProductCatalogDetail, path: string) {
  return detail.draft.field_evidence[path] ?? "";
}

export function productDraftValues(detail: ProductCatalogDetail): ProductValues {
  const product = detail.draft.product;
  const specifications = detail.draft.specifications ?? {};
  return {
    productName: textValue(product.product_name),
    productNameEvidenceRef: evidence(detail, "product.product_name"),
    productType: (product.product_type as ProductValues["productType"]) ?? "clutch_disc",
    productTypeEvidenceRef: evidence(detail, "product.product_type"),
    internalSku: textValue(product.internal_sku),
    internalSkuEvidenceRef: evidence(detail, "product.internal_sku"),
    oeNumbers: Array.isArray(product.oe_numbers)
      ? product.oe_numbers.filter((value): value is string => typeof value === "string").join(", ")
      : "",
    oeNumbersEvidenceRef: evidence(detail, "product.oe_numbers"),
    application: textValue(product.application),
    applicationEvidenceRef: evidence(detail, "product.application"),
    vehicleBrand: textValue(product.vehicle_brand),
    vehicleBrandEvidenceRef: evidence(detail, "product.vehicle_brand"),
    vehicleModel: textValue(product.vehicle_model),
    vehicleModelEvidenceRef: evidence(detail, "product.vehicle_model"),
    clutchDiameterMm: textValue(specifications.clutch_diameter_mm),
    clutchDiameterMmEvidenceRef: evidence(detail, "specifications.clutch_diameter_mm"),
    splineCount: textValue(specifications.spline_count),
    splineCountEvidenceRef: evidence(detail, "specifications.spline_count"),
    splineSize: textValue(specifications.spline_size),
    splineSizeEvidenceRef: evidence(detail, "specifications.spline_size"),
    frictionMaterial: textValue(specifications.friction_material),
    frictionMaterialEvidenceRef: evidence(detail, "specifications.friction_material"),
    sourceRef: detail.draft.source_ref,
  };
}

function EvidenceInput({
  form,
  name,
  label,
  id,
  required = false,
}: {
  form: UseFormReturn<ProductValues>;
  name:
    | "productNameEvidenceRef"
    | "productTypeEvidenceRef"
    | "internalSkuEvidenceRef"
    | "oeNumbersEvidenceRef"
    | "applicationEvidenceRef"
    | "vehicleBrandEvidenceRef"
    | "vehicleModelEvidenceRef"
    | "clutchDiameterMmEvidenceRef"
    | "splineCountEvidenceRef"
    | "splineSizeEvidenceRef"
    | "frictionMaterialEvidenceRef";
  label: string;
  id: string;
  required?: boolean;
}) {
  const error = form.formState.errors[name];
  return <Field data-invalid={Boolean(error)}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Input
      id={id}
      placeholder="evidence-product-001"
      aria-invalid={Boolean(error)}
      required={required}
      {...form.register(name)}
    />
    <FieldError errors={[error]} />
  </Field>;
}

function FactPair({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">{children}</div>;
}

export function ProductFields({ form }: { form: UseFormReturn<ProductValues> }) {
  return <FieldGroup>
    <FieldSet>
      <FieldLegend>核心产品身份</FieldLegend>
      <FieldDescription>每个事实必须绑定自己的私有证据；相同来源可以重复填写同一 evidence 引用，但系统不会自动复制。</FieldDescription>
      <FieldGroup>
        <FactPair>
          <Field data-invalid={Boolean(form.formState.errors.productName)}>
            <FieldLabel htmlFor="product-name">产品名称</FieldLabel>
            <Input id="product-name" aria-invalid={Boolean(form.formState.errors.productName)} {...form.register("productName")} />
            <FieldError errors={[form.formState.errors.productName]} />
          </Field>
          <EvidenceInput form={form} name="productNameEvidenceRef" label="产品名称证据" id="product-name-evidence" required />
        </FactPair>

        <FactPair>
          <Field data-invalid={Boolean(form.formState.errors.productType)}>
            <FieldLabel>产品类型</FieldLabel>
            <Controller control={form.control} name="productType" render={({ field }) => <Select
              items={Object.fromEntries(productTypes)}
              value={field.value}
              onValueChange={(value) => value && field.onChange(value)}
            >
              <SelectTrigger className="w-full" aria-invalid={Boolean(form.formState.errors.productType)}><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{productTypes.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>} />
            <FieldError errors={[form.formState.errors.productType]} />
          </Field>
          <EvidenceInput form={form} name="productTypeEvidenceRef" label="产品类型证据" id="product-type-evidence" required />
        </FactPair>

        <FactPair>
          <Field data-invalid={Boolean(form.formState.errors.internalSku)}>
            <FieldLabel htmlFor="internal-sku">内部编号</FieldLabel>
            <Input id="internal-sku" aria-invalid={Boolean(form.formState.errors.internalSku)} {...form.register("internalSku")} />
            <FieldError errors={[form.formState.errors.internalSku]} />
          </Field>
          <EvidenceInput form={form} name="internalSkuEvidenceRef" label="内部编号证据" id="internal-sku-evidence" required />
        </FactPair>

        <FactPair>
          <Field data-invalid={Boolean(form.formState.errors.oeNumbers)}>
            <FieldLabel htmlFor="oe-numbers">OE / OEM 编号</FieldLabel>
            <Input id="oe-numbers" placeholder="多个编号用逗号分隔" aria-invalid={Boolean(form.formState.errors.oeNumbers)} {...form.register("oeNumbers")} />
            <FieldError errors={[form.formState.errors.oeNumbers]} />
          </Field>
          <EvidenceInput form={form} name="oeNumbersEvidenceRef" label="OE / OEM 编号证据" id="oe-numbers-evidence" />
        </FactPair>
      </FieldGroup>
    </FieldSet>

    <FieldSet>
      <FieldLegend>适配信息</FieldLegend>
      <FieldDescription>OE 缺失时，应用说明、车辆品牌和车型必须全部有值并分别绑定证据，才能通过 Gate 01。</FieldDescription>
      <FieldGroup>
        <FactPair>
          <Field><FieldLabel htmlFor="application">适配说明</FieldLabel><Input id="application" {...form.register("application")} /></Field>
          <EvidenceInput form={form} name="applicationEvidenceRef" label="适配说明证据" id="application-evidence" />
        </FactPair>
        <FactPair>
          <Field><FieldLabel htmlFor="vehicle-brand">车辆品牌</FieldLabel><Input id="vehicle-brand" {...form.register("vehicleBrand")} /></Field>
          <EvidenceInput form={form} name="vehicleBrandEvidenceRef" label="车辆品牌证据" id="vehicle-brand-evidence" />
        </FactPair>
        <FactPair>
          <Field><FieldLabel htmlFor="vehicle-model">车型</FieldLabel><Input id="vehicle-model" {...form.register("vehicleModel")} /></Field>
          <EvidenceInput form={form} name="vehicleModelEvidenceRef" label="车型证据" id="vehicle-model-evidence" />
        </FactPair>
      </FieldGroup>
    </FieldSet>

    <FieldSet>
      <FieldLegend>离合器规格</FieldLegend>
      <FieldDescription>没有来源依据时，事实和对应证据都留空；AI 不能补齐。</FieldDescription>
      <FieldGroup>
        <FactPair>
          <Field data-invalid={Boolean(form.formState.errors.clutchDiameterMm)}>
            <FieldLabel htmlFor="clutch-diameter">盘径（mm）</FieldLabel>
            <Input id="clutch-diameter" inputMode="decimal" aria-invalid={Boolean(form.formState.errors.clutchDiameterMm)} {...form.register("clutchDiameterMm")} />
            <FieldError errors={[form.formState.errors.clutchDiameterMm]} />
          </Field>
          <EvidenceInput form={form} name="clutchDiameterMmEvidenceRef" label="盘径证据" id="clutch-diameter-evidence" />
        </FactPair>
        <FactPair>
          <Field data-invalid={Boolean(form.formState.errors.splineCount)}>
            <FieldLabel htmlFor="spline-count">花键数</FieldLabel>
            <Input id="spline-count" inputMode="numeric" aria-invalid={Boolean(form.formState.errors.splineCount)} {...form.register("splineCount")} />
            <FieldError errors={[form.formState.errors.splineCount]} />
          </Field>
          <EvidenceInput form={form} name="splineCountEvidenceRef" label="花键数证据" id="spline-count-evidence" />
        </FactPair>
        <FactPair>
          <Field><FieldLabel htmlFor="spline-size">花键尺寸</FieldLabel><Input id="spline-size" {...form.register("splineSize")} /></Field>
          <EvidenceInput form={form} name="splineSizeEvidenceRef" label="花键尺寸证据" id="spline-size-evidence" />
        </FactPair>
        <FactPair>
          <Field><FieldLabel htmlFor="friction-material">摩擦材料</FieldLabel><Input id="friction-material" {...form.register("frictionMaterial")} /></Field>
          <EvidenceInput form={form} name="frictionMaterialEvidenceRef" label="摩擦材料证据" id="friction-material-evidence" />
        </FactPair>
      </FieldGroup>
    </FieldSet>

    <FieldSet>
      <FieldLegend>来源</FieldLegend>
      <FieldDescription>来源引用标识整份资料；字段证据仍以上述逐项映射为准。</FieldDescription>
      <Field data-invalid={Boolean(form.formState.errors.sourceRef)}>
        <FieldLabel htmlFor="source-ref">来源引用</FieldLabel>
        <Input id="source-ref" placeholder="source-catalog-001" aria-invalid={Boolean(form.formState.errors.sourceRef)} {...form.register("sourceRef")} />
        <FieldError errors={[form.formState.errors.sourceRef]} />
      </Field>
    </FieldSet>
  </FieldGroup>;
}
