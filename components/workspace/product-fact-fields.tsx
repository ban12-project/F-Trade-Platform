import type { ReactNode } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";

import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ProductCatalogDetail } from "@/lib/products";
import { kitContentValues, type ProductCatalogForm } from "@/lib/product/catalog-form-schema";

export type ProductValues = ProductCatalogForm;
type EvidenceFieldName = Extract<keyof ProductValues, `${string}EvidenceRef`>;

const productTypes = [
  ["clutch_disc", "离合器片"],
  ["clutch_cover", "离合器盖 / 压盘"],
  ["release_bearing", "分离轴承"],
  ["clutch_kit", "离合器套件"],
] as const;

const kitContentLabels: Record<typeof kitContentValues[number], string> = {
  clutch_disc: "离合器片",
  pressure_plate: "压盘",
  release_bearing: "分离轴承",
};

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
  kitContents: "",
  kitContentsEvidenceRef: "",
  grossWeightKg: "",
  grossWeightKgEvidenceRef: "",
  netWeightKg: "",
  netWeightKgEvidenceRef: "",
  packageSize: "",
  packageSizeEvidenceRef: "",
  moq: "",
  moqEvidenceRef: "",
  estimatedLeadTimeDays: "",
  estimatedLeadTimeDaysEvidenceRef: "",
  packaging: "",
  packagingEvidenceRef: "",
  supportedCustomization: "",
  supportedCustomizationEvidenceRef: "",
  sampleAvailable: "",
  sampleAvailableEvidenceRef: "",
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
  const commercial = detail.draft.commercial ?? {};
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
    kitContents: Array.isArray(specifications.kit_contents)
      ? specifications.kit_contents.filter((value): value is typeof kitContentValues[number] =>
          kitContentValues.includes(value as typeof kitContentValues[number]))
        .join(",")
      : "",
    kitContentsEvidenceRef: evidence(detail, "specifications.kit_contents"),
    grossWeightKg: textValue(specifications.gross_weight_kg),
    grossWeightKgEvidenceRef: evidence(detail, "specifications.gross_weight_kg"),
    netWeightKg: textValue(specifications.net_weight_kg),
    netWeightKgEvidenceRef: evidence(detail, "specifications.net_weight_kg"),
    packageSize: textValue(specifications.package_size),
    packageSizeEvidenceRef: evidence(detail, "specifications.package_size"),
    moq: textValue(commercial.moq),
    moqEvidenceRef: evidence(detail, "commercial.moq"),
    estimatedLeadTimeDays: textValue(commercial.estimated_lead_time_days),
    estimatedLeadTimeDaysEvidenceRef: evidence(detail, "commercial.estimated_lead_time_days"),
    packaging: textValue(commercial.packaging),
    packagingEvidenceRef: evidence(detail, "commercial.packaging"),
    supportedCustomization: textValue(commercial.supported_customization),
    supportedCustomizationEvidenceRef: evidence(detail, "commercial.supported_customization"),
    sampleAvailable: commercial.sample_available === true ? "yes" : commercial.sample_available === false ? "no" : "",
    sampleAvailableEvidenceRef: evidence(detail, "commercial.sample_available"),
    sourceRef: detail.draft.source_ref,
  };
}

function EvidenceInput({
  form,
  name,
  label,
  id,
  required = false,
  disabled = false,
}: {
  form: UseFormReturn<ProductValues>;
  name: EvidenceFieldName;
  label: string;
  id: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const error = form.formState.errors[name];
  return <Field data-invalid={Boolean(error)}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Input
      id={id}
      placeholder="evidence-product-001"
      aria-invalid={Boolean(error)}
      required={required}
      disabled={disabled}
      {...form.register(name)}
    />
    <FieldError errors={[error]} />
  </Field>;
}

function FactPair({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">{children}</div>;
}

export function ProductFields({ form }: { form: UseFormReturn<ProductValues> }) {
  const productType = form.watch("productType");
  const kitDisabled = productType !== "clutch_kit";
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
              onValueChange={(value) => {
                if (!value) return;
                field.onChange(value);
                if (value !== "clutch_kit") {
                  form.setValue("kitContents", "", { shouldDirty: true, shouldValidate: true });
                  form.setValue("kitContentsEvidenceRef", "", { shouldDirty: true, shouldValidate: true });
                }
              }}
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
      <FieldLegend>套件与包装规格</FieldLegend>
      <FieldDescription>套件组成仅对“离合器套件”开放；重量和包装尺寸仍需工厂资料或人工确认。</FieldDescription>
      <FieldGroup>
        <FactPair>
          <Field data-invalid={Boolean(form.formState.errors.kitContents)}>
            <FieldLabel>套件组成</FieldLabel>
            <Controller control={form.control} name="kitContents" render={({ field }) => <ToggleGroup
              value={field.value ? field.value.split(",").filter(Boolean) : []}
              onValueChange={(value) => field.onChange(value.join(","))}
              variant="outline"
              className="flex-wrap justify-start"
              disabled={kitDisabled}
            >
              {kitContentValues.map((value) => <ToggleGroupItem key={value} value={value}>{kitContentLabels[value]}</ToggleGroupItem>)}
            </ToggleGroup>} />
            <FieldDescription>{kitDisabled ? "先将产品类型切换为离合器套件。" : "只记录资料明确列出的组成。"}</FieldDescription>
            <FieldError errors={[form.formState.errors.kitContents]} />
          </Field>
          <EvidenceInput form={form} name="kitContentsEvidenceRef" label="套件组成证据" id="kit-contents-evidence" disabled={kitDisabled} />
        </FactPair>
        <FactPair>
          <Field data-invalid={Boolean(form.formState.errors.grossWeightKg)}><FieldLabel htmlFor="gross-weight">毛重（kg）</FieldLabel><Input id="gross-weight" inputMode="decimal" {...form.register("grossWeightKg")} /><FieldError errors={[form.formState.errors.grossWeightKg]} /></Field>
          <EvidenceInput form={form} name="grossWeightKgEvidenceRef" label="毛重证据" id="gross-weight-evidence" />
        </FactPair>
        <FactPair>
          <Field data-invalid={Boolean(form.formState.errors.netWeightKg)}><FieldLabel htmlFor="net-weight">净重（kg）</FieldLabel><Input id="net-weight" inputMode="decimal" {...form.register("netWeightKg")} /><FieldError errors={[form.formState.errors.netWeightKg]} /></Field>
          <EvidenceInput form={form} name="netWeightKgEvidenceRef" label="净重证据" id="net-weight-evidence" />
        </FactPair>
        <FactPair>
          <Field><FieldLabel htmlFor="package-size">包装尺寸</FieldLabel><Input id="package-size" placeholder="40 × 40 × 12 cm" {...form.register("packageSize")} /></Field>
          <EvidenceInput form={form} name="packageSizeEvidenceRef" label="包装尺寸证据" id="package-size-evidence" />
        </FactPair>
      </FieldGroup>
    </FieldSet>

    <FieldSet>
      <FieldLegend>商业信息</FieldLegend>
      <FieldDescription>MOQ、交期、包装、定制和样品状态都会进入 ProductReady；不得根据经验或图片推断。</FieldDescription>
      <FieldGroup>
        <FactPair>
          <Field data-invalid={Boolean(form.formState.errors.moq)}><FieldLabel htmlFor="product-moq">最小起订量（MOQ）</FieldLabel><Input id="product-moq" inputMode="numeric" {...form.register("moq")} /><FieldError errors={[form.formState.errors.moq]} /></Field>
          <EvidenceInput form={form} name="moqEvidenceRef" label="最小起订量证据" id="moq-evidence" />
        </FactPair>
        <FactPair>
          <Field data-invalid={Boolean(form.formState.errors.estimatedLeadTimeDays)}><FieldLabel htmlFor="lead-time-days">预计交期（天）</FieldLabel><Input id="lead-time-days" inputMode="numeric" {...form.register("estimatedLeadTimeDays")} /><FieldError errors={[form.formState.errors.estimatedLeadTimeDays]} /></Field>
          <EvidenceInput form={form} name="estimatedLeadTimeDaysEvidenceRef" label="预计交期证据" id="lead-time-evidence" />
        </FactPair>
        <FactPair>
          <Field><FieldLabel htmlFor="packaging">包装方式</FieldLabel><Input id="packaging" {...form.register("packaging")} /></Field>
          <EvidenceInput form={form} name="packagingEvidenceRef" label="包装方式证据" id="packaging-evidence" />
        </FactPair>
        <FactPair>
          <Field><FieldLabel htmlFor="supported-customization">支持定制</FieldLabel><Input id="supported-customization" placeholder="Logo, color box" {...form.register("supportedCustomization")} /></Field>
          <EvidenceInput form={form} name="supportedCustomizationEvidenceRef" label="支持定制证据" id="supported-customization-evidence" />
        </FactPair>
        <FactPair>
          <Field data-invalid={Boolean(form.formState.errors.sampleAvailable)}>
            <FieldLabel>样品可用性</FieldLabel>
            <Controller control={form.control} name="sampleAvailable" render={({ field }) => <ToggleGroup
              value={field.value ? [field.value] : []}
              onValueChange={(value) => field.onChange(value[0] ?? "")}
              variant="outline"
            >
              <ToggleGroupItem value="yes">可提供样品</ToggleGroupItem>
              <ToggleGroupItem value="no">暂不提供样品</ToggleGroupItem>
            </ToggleGroup>} />
            <FieldDescription>未取得明确资料时保持未选择。</FieldDescription>
            <FieldError errors={[form.formState.errors.sampleAvailable]} />
          </Field>
          <EvidenceInput form={form} name="sampleAvailableEvidenceRef" label="样品可用性证据" id="sample-available-evidence" />
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
