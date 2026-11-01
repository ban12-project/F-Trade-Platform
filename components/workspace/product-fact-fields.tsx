import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Controller, type UseFormReturn, useFormState, useWatch } from "react-hook-form";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { kitContentValues, type ProductCatalogForm } from "@/lib/product/catalog-form-schema";
import { isProductEvidenceLocationRef } from "@/lib/product/retained-evidence";
import type { ProductCatalogDetail } from "@/lib/products";
import type { EvidenceOption } from "@/lib/workspace/access";

export type ProductValues = ProductCatalogForm;
type EvidenceFieldName = Extract<keyof ProductValues, `${string}EvidenceRef`>;
const EvidenceOptionsContext = createContext<EvidenceOption[]>([]);

const productEvidenceBindings = [
  ["productName", "productNameEvidenceRef", "产品名称"],
  ["productType", "productTypeEvidenceRef", "产品类型"],
  ["internalSku", "internalSkuEvidenceRef", "内部编号"],
  ["oeNumbers", "oeNumbersEvidenceRef", "OE / OEM 编号"],
  ["application", "applicationEvidenceRef", "适配说明"],
  ["vehicleBrand", "vehicleBrandEvidenceRef", "车辆品牌"],
  ["vehicleModel", "vehicleModelEvidenceRef", "车型"],
  ["clutchDiameterMm", "clutchDiameterMmEvidenceRef", "离合器直径"],
  ["splineCount", "splineCountEvidenceRef", "花键齿数"],
  ["splineSize", "splineSizeEvidenceRef", "花键尺寸"],
  ["frictionMaterial", "frictionMaterialEvidenceRef", "摩擦材料"],
  ["kitContents", "kitContentsEvidenceRef", "套件组成"],
  ["grossWeightKg", "grossWeightKgEvidenceRef", "毛重"],
  ["netWeightKg", "netWeightKgEvidenceRef", "净重"],
  ["packageSize", "packageSizeEvidenceRef", "包装尺寸"],
  ["moq", "moqEvidenceRef", "MOQ"],
  ["estimatedLeadTimeDays", "estimatedLeadTimeDaysEvidenceRef", "预计交期"],
  ["packaging", "packagingEvidenceRef", "包装方式"],
  ["supportedCustomization", "supportedCustomizationEvidenceRef", "定制能力"],
  ["sampleAvailable", "sampleAvailableEvidenceRef", "样品可用性"],
] as const satisfies ReadonlyArray<readonly [keyof ProductValues, EvidenceFieldName, string]>;

const productTypes = [
  ["clutch_disc", "离合器片"],
  ["clutch_cover", "离合器盖 / 压盘"],
  ["release_bearing", "分离轴承"],
  ["clutch_kit", "离合器套件"],
] as const;

const kitContentLabels: Record<(typeof kitContentValues)[number], string> = {
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
      ? specifications.kit_contents
          .filter((value): value is (typeof kitContentValues)[number] =>
            kitContentValues.includes(value as (typeof kitContentValues)[number]),
          )
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
    sampleAvailable:
      commercial.sample_available === true
        ? "yes"
        : commercial.sample_available === false
          ? "no"
          : "",
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
  name: EvidenceFieldName | "sourceRef";
  label: string;
  id: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const error = form.formState.errors[name];
  const options = useContext(EvidenceOptionsContext);
  const originalRef = form.formState.defaultValues?.[name];
  const retainedRef =
    isProductEvidenceLocationRef(originalRef) || (name === "sourceRef" && originalRef)
      ? originalRef
      : undefined;
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <Select
            value={field.value}
            onValueChange={(value) => field.onChange(value ?? "")}
            disabled={disabled || (!options.length && !retainedRef)}
          >
            <SelectTrigger
              id={id}
              className="min-h-11 w-full"
              aria-invalid={Boolean(error)}
              aria-required={required}
            >
              <SelectValue>
                {options.find((option) => option.id === field.value)
                  ? `${options.find((option) => option.id === field.value)!.sourceLabel} · ${field.value.slice(-8)}`
                  : field.value === retainedRef && retainedRef
                    ? "保留原来源资料"
                    : "选择已上传资料"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {retainedRef ? <SelectItem value={retainedRef}>保留原来源资料</SelectItem> : null}
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.sourceLabel} ·{" "}
                    {
                      { internal: "内部资料", confidential: "保密资料", restricted: "受限资料" }[
                        option.classification
                      ]
                    }{" "}
                    · {option.id.slice(-8)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      />
      {!options.length && !retainedRef ? (
        <FieldDescription>
          请先通过智能导入或资料库上传文件，再选择对应的来源资料。
        </FieldDescription>
      ) : null}
      <FieldError errors={[error]} />
    </Field>
  );
}

function FactPair({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">{children}</div>;
}

export function ProductFields({
  form,
  evidenceOptions,
}: {
  form: UseFormReturn<ProductValues>;
  evidenceOptions: EvidenceOption[];
}) {
  const idPrefix = useId();
  const fieldId = (name: string) => `${idPrefix}-${name}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const { errors, submitCount } = useFormState({ control: form.control });
  const [batchEvidence, setBatchEvidence] = useState("");
  const [batchTargets, setBatchTargets] = useState<Set<EvidenceFieldName>>(() => new Set());
  const values = useWatch({ control: form.control });
  const productType = values.productType;
  const kitDisabled = productType !== "clutch_kit";
  const visibleBindings = useMemo(
    () =>
      productEvidenceBindings.filter(([valueName]) => valueName !== "kitContents" || !kitDisabled),
    [kitDisabled],
  );
  const completed = visibleBindings.filter(
    ([valueName, evidenceName]) =>
      String(values[valueName] ?? "").trim() && String(values[evidenceName] ?? "").trim(),
  ).length;
  const completion = Math.round((completed / visibleBindings.length) * 100);
  const errorEntries = Object.entries(errors).filter(([, error]) => Boolean(error));
  useEffect(() => {
    if (!submitCount || !errorEntries.length) return;
    requestAnimationFrame(() =>
      rootRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus(),
    );
  }, [errorEntries.length, submitCount]);
  const eligibleBatchTargets = visibleBindings.filter(([valueName]) =>
    String(values[valueName] ?? "").trim(),
  );
  function toggleBatchTarget(name: EvidenceFieldName, checked: boolean) {
    setBatchTargets((current) => {
      const next = new Set(current);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  }
  function applyBatchEvidence() {
    if (!batchEvidence || !batchTargets.size) return;
    for (const name of batchTargets)
      form.setValue(name, batchEvidence, { shouldDirty: true, shouldValidate: true });
    setBatchTargets(new Set());
  }
  return (
    <EvidenceOptionsContext.Provider value={evidenceOptions}>
      <div ref={rootRef} className="flex flex-col gap-5">
        <Progress value={completion}>
          <ProgressLabel>产品信息与来源填写进度</ProgressLabel>
          <ProgressValue />
        </Progress>
        {submitCount > 0 && errorEntries.length ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>还有 {errorEntries.length} 项需要处理</AlertTitle>
            <AlertDescription>
              已定位到第一处未完成项。请补充信息和来源资料后再提交。
            </AlertDescription>
          </Alert>
        ) : null}
        <FieldSet>
          <FieldLegend>为多项信息选择同一份资料</FieldLegend>
          <FieldDescription>选择来源资料，再勾选需要使用这份资料的产品信息。</FieldDescription>
          <FieldGroup>
            <Field>
              <FieldLabel>来源资料</FieldLabel>
              <Select
                value={batchEvidence}
                onValueChange={(value) => setBatchEvidence(value ?? "")}
              >
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue placeholder="选择已上传资料" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {evidenceOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.sourceLabel} · {option.id.slice(-8)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <FieldSet>
              <FieldLegend>目标字段</FieldLegend>
              <FieldGroup>
                {eligibleBatchTargets.map(([, evidenceName, label]) => (
                  <Field key={evidenceName} orientation="horizontal">
                    <Checkbox
                      id={fieldId(`batch-${evidenceName}`)}
                      checked={batchTargets.has(evidenceName)}
                      onCheckedChange={(checked) =>
                        toggleBatchTarget(evidenceName, checked === true)
                      }
                    />
                    <FieldLabel htmlFor={fieldId(`batch-${evidenceName}`)}>{label}</FieldLabel>
                  </Field>
                ))}
              </FieldGroup>
            </FieldSet>
            <Button
              type="button"
              variant="outline"
              disabled={!batchEvidence || !batchTargets.size}
              onClick={applyBatchEvidence}
            >
              应用到 {batchTargets.size} 个目标字段
            </Button>
          </FieldGroup>
        </FieldSet>
        <FieldGroup>
          <FieldSet>
            <FieldLegend>核心产品身份</FieldLegend>
            <FieldDescription>
              每项产品信息都要选择来源资料。同一份资料支持多项信息时，可以重复选择。
            </FieldDescription>
            <FieldGroup>
              <FactPair>
                <Field data-invalid={Boolean(form.formState.errors.productName)}>
                  <FieldLabel htmlFor={fieldId("product-name")}>产品名称</FieldLabel>
                  <Input
                    id={fieldId("product-name")}
                    aria-invalid={Boolean(form.formState.errors.productName)}
                    {...form.register("productName")}
                  />
                  <FieldError errors={[form.formState.errors.productName]} />
                </Field>
                <EvidenceInput
                  form={form}
                  name="productNameEvidenceRef"
                  label="产品名称来源"
                  id={fieldId("product-name-evidence")}
                  required
                />
              </FactPair>

              <FactPair>
                <Field data-invalid={Boolean(form.formState.errors.productType)}>
                  <FieldLabel htmlFor={fieldId("product-type")}>产品类型</FieldLabel>
                  <Controller
                    control={form.control}
                    name="productType"
                    render={({ field }) => (
                      <Select
                        items={Object.fromEntries(productTypes)}
                        value={field.value}
                        onValueChange={(value) => {
                          if (!value) return;
                          field.onChange(value);
                          if (value !== "clutch_kit") {
                            form.setValue("kitContents", "", {
                              shouldDirty: true,
                              shouldValidate: true,
                            });
                            form.setValue("kitContentsEvidenceRef", "", {
                              shouldDirty: true,
                              shouldValidate: true,
                            });
                          }
                        }}
                      >
                        <SelectTrigger
                          id={fieldId("product-type")}
                          className="w-full"
                          aria-invalid={Boolean(form.formState.errors.productType)}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {productTypes.map(([value, label]) => (
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
                <EvidenceInput
                  form={form}
                  name="productTypeEvidenceRef"
                  label="产品类型来源"
                  id={fieldId("product-type-evidence")}
                  required
                />
              </FactPair>

              <FactPair>
                <Field data-invalid={Boolean(form.formState.errors.internalSku)}>
                  <FieldLabel htmlFor={fieldId("internal-sku")}>内部编号</FieldLabel>
                  <Input
                    id={fieldId("internal-sku")}
                    aria-invalid={Boolean(form.formState.errors.internalSku)}
                    {...form.register("internalSku")}
                  />
                  <FieldError errors={[form.formState.errors.internalSku]} />
                </Field>
                <EvidenceInput
                  form={form}
                  name="internalSkuEvidenceRef"
                  label="内部编号来源"
                  id={fieldId("internal-sku-evidence")}
                  required
                />
              </FactPair>

              <FactPair>
                <Field data-invalid={Boolean(form.formState.errors.oeNumbers)}>
                  <FieldLabel htmlFor={fieldId("oe-numbers")}>OE / OEM 编号</FieldLabel>
                  <Input
                    id={fieldId("oe-numbers")}
                    placeholder="多个编号用逗号分隔"
                    aria-invalid={Boolean(form.formState.errors.oeNumbers)}
                    {...form.register("oeNumbers")}
                  />
                  <FieldError errors={[form.formState.errors.oeNumbers]} />
                </Field>
                <EvidenceInput
                  form={form}
                  name="oeNumbersEvidenceRef"
                  label="OE / OEM 编号来源"
                  id={fieldId("oe-numbers-evidence")}
                />
              </FactPair>
            </FieldGroup>
          </FieldSet>

          <FieldSet>
            <FieldLegend>适配信息</FieldLegend>
            <FieldDescription>
              没有 OE 编号时，请填写适配说明、车辆品牌和车型，并为每项选择来源资料。
            </FieldDescription>
            <FieldGroup>
              <FactPair>
                <Field data-invalid={Boolean(form.formState.errors.application)}>
                  <FieldLabel htmlFor={fieldId("application")}>适配说明</FieldLabel>
                  <Input
                    id={fieldId("application")}
                    aria-invalid={Boolean(form.formState.errors.application)}
                    {...form.register("application")}
                  />
                  <FieldError errors={[form.formState.errors.application]} />
                </Field>
                <EvidenceInput
                  form={form}
                  name="applicationEvidenceRef"
                  label="适配说明来源"
                  id={fieldId("application-evidence")}
                />
              </FactPair>
              <FactPair>
                <Field data-invalid={Boolean(form.formState.errors.vehicleBrand)}>
                  <FieldLabel htmlFor={fieldId("vehicle-brand")}>车辆品牌</FieldLabel>
                  <Input
                    id={fieldId("vehicle-brand")}
                    aria-invalid={Boolean(form.formState.errors.vehicleBrand)}
                    {...form.register("vehicleBrand")}
                  />
                  <FieldError errors={[form.formState.errors.vehicleBrand]} />
                </Field>
                <EvidenceInput
                  form={form}
                  name="vehicleBrandEvidenceRef"
                  label="车辆品牌来源"
                  id={fieldId("vehicle-brand-evidence")}
                />
              </FactPair>
              <FactPair>
                <Field data-invalid={Boolean(form.formState.errors.vehicleModel)}>
                  <FieldLabel htmlFor={fieldId("vehicle-model")}>车型</FieldLabel>
                  <Input
                    id={fieldId("vehicle-model")}
                    aria-invalid={Boolean(form.formState.errors.vehicleModel)}
                    {...form.register("vehicleModel")}
                  />
                  <FieldError errors={[form.formState.errors.vehicleModel]} />
                </Field>
                <EvidenceInput
                  form={form}
                  name="vehicleModelEvidenceRef"
                  label="车型来源"
                  id={fieldId("vehicle-model-evidence")}
                />
              </FactPair>
            </FieldGroup>
          </FieldSet>

          <FieldSet>
            <FieldLegend>离合器规格</FieldLegend>
            <FieldDescription>
              没有来源资料时，请将信息及来源都留空，待工厂确认后补充。
            </FieldDescription>
            <FieldGroup>
              <FactPair>
                <Field data-invalid={Boolean(form.formState.errors.clutchDiameterMm)}>
                  <FieldLabel htmlFor={fieldId("clutch-diameter")}>盘径（mm）</FieldLabel>
                  <Input
                    id={fieldId("clutch-diameter")}
                    inputMode="decimal"
                    aria-invalid={Boolean(form.formState.errors.clutchDiameterMm)}
                    {...form.register("clutchDiameterMm")}
                  />
                  <FieldError errors={[form.formState.errors.clutchDiameterMm]} />
                </Field>
                <EvidenceInput
                  form={form}
                  name="clutchDiameterMmEvidenceRef"
                  label="盘径来源"
                  id={fieldId("clutch-diameter-evidence")}
                />
              </FactPair>
              <FactPair>
                <Field data-invalid={Boolean(form.formState.errors.splineCount)}>
                  <FieldLabel htmlFor={fieldId("spline-count")}>花键数</FieldLabel>
                  <Input
                    id={fieldId("spline-count")}
                    inputMode="numeric"
                    aria-invalid={Boolean(form.formState.errors.splineCount)}
                    {...form.register("splineCount")}
                  />
                  <FieldError errors={[form.formState.errors.splineCount]} />
                </Field>
                <EvidenceInput
                  form={form}
                  name="splineCountEvidenceRef"
                  label="花键数来源"
                  id={fieldId("spline-count-evidence")}
                />
              </FactPair>
              <FactPair>
                <Field data-invalid={Boolean(form.formState.errors.splineSize)}>
                  <FieldLabel htmlFor={fieldId("spline-size")}>花键尺寸</FieldLabel>
                  <Input
                    id={fieldId("spline-size")}
                    aria-invalid={Boolean(form.formState.errors.splineSize)}
                    {...form.register("splineSize")}
                  />
                  <FieldError errors={[form.formState.errors.splineSize]} />
                </Field>
                <EvidenceInput
                  form={form}
                  name="splineSizeEvidenceRef"
                  label="花键尺寸来源"
                  id={fieldId("spline-size-evidence")}
                />
              </FactPair>
              <FactPair>
                <Field data-invalid={Boolean(form.formState.errors.frictionMaterial)}>
                  <FieldLabel htmlFor={fieldId("friction-material")}>摩擦材料</FieldLabel>
                  <Input
                    id={fieldId("friction-material")}
                    aria-invalid={Boolean(form.formState.errors.frictionMaterial)}
                    {...form.register("frictionMaterial")}
                  />
                  <FieldError errors={[form.formState.errors.frictionMaterial]} />
                </Field>
                <EvidenceInput
                  form={form}
                  name="frictionMaterialEvidenceRef"
                  label="摩擦材料来源"
                  id={fieldId("friction-material-evidence")}
                />
              </FactPair>
            </FieldGroup>
          </FieldSet>

          <FieldSet>
            <FieldLegend>套件与包装规格</FieldLegend>
            <FieldDescription>
              套件组成仅对“离合器套件”开放；重量和包装尺寸仍需工厂资料或人工确认。
            </FieldDescription>
            <FieldGroup>
              <FactPair>
                <Field data-invalid={Boolean(form.formState.errors.kitContents)}>
                  <FieldLabel>套件组成</FieldLabel>
                  <Controller
                    control={form.control}
                    name="kitContents"
                    render={({ field }) => (
                      <ToggleGroup
                        value={field.value ? field.value.split(",").filter(Boolean) : []}
                        onValueChange={(value) => field.onChange(value.join(","))}
                        variant="outline"
                        className="flex-wrap justify-start"
                        disabled={kitDisabled}
                      >
                        {kitContentValues.map((value) => (
                          <ToggleGroupItem key={value} value={value}>
                            {kitContentLabels[value]}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    )}
                  />
                  <FieldDescription>
                    {kitDisabled ? "先将产品类型切换为离合器套件。" : "只记录资料明确列出的组成。"}
                  </FieldDescription>
                  <FieldError errors={[form.formState.errors.kitContents]} />
                </Field>
                <EvidenceInput
                  form={form}
                  name="kitContentsEvidenceRef"
                  label="套件组成来源"
                  id={fieldId("kit-contents-evidence")}
                  disabled={kitDisabled}
                />
              </FactPair>
              <FactPair>
                <Field data-invalid={Boolean(form.formState.errors.grossWeightKg)}>
                  <FieldLabel htmlFor={fieldId("gross-weight")}>毛重（kg）</FieldLabel>
                  <Input
                    id={fieldId("gross-weight")}
                    inputMode="decimal"
                    aria-invalid={Boolean(form.formState.errors.grossWeightKg)}
                    {...form.register("grossWeightKg")}
                  />
                  <FieldError errors={[form.formState.errors.grossWeightKg]} />
                </Field>
                <EvidenceInput
                  form={form}
                  name="grossWeightKgEvidenceRef"
                  label="毛重来源"
                  id={fieldId("gross-weight-evidence")}
                />
              </FactPair>
              <FactPair>
                <Field data-invalid={Boolean(form.formState.errors.netWeightKg)}>
                  <FieldLabel htmlFor={fieldId("net-weight")}>净重（kg）</FieldLabel>
                  <Input
                    id={fieldId("net-weight")}
                    inputMode="decimal"
                    aria-invalid={Boolean(form.formState.errors.netWeightKg)}
                    {...form.register("netWeightKg")}
                  />
                  <FieldError errors={[form.formState.errors.netWeightKg]} />
                </Field>
                <EvidenceInput
                  form={form}
                  name="netWeightKgEvidenceRef"
                  label="净重来源"
                  id={fieldId("net-weight-evidence")}
                />
              </FactPair>
              <FactPair>
                <Field data-invalid={Boolean(form.formState.errors.packageSize)}>
                  <FieldLabel htmlFor={fieldId("package-size")}>包装尺寸</FieldLabel>
                  <Input
                    id={fieldId("package-size")}
                    placeholder="40 × 40 × 12 cm"
                    aria-invalid={Boolean(form.formState.errors.packageSize)}
                    {...form.register("packageSize")}
                  />
                  <FieldError errors={[form.formState.errors.packageSize]} />
                </Field>
                <EvidenceInput
                  form={form}
                  name="packageSizeEvidenceRef"
                  label="包装尺寸来源"
                  id={fieldId("package-size-evidence")}
                />
              </FactPair>
            </FieldGroup>
          </FieldSet>

          <FieldSet>
            <FieldLegend>商业信息</FieldLegend>
            <FieldDescription>
              起订量、预计交期、包装、定制和样品情况都需要来源资料，不能仅凭经验或图片填写。
            </FieldDescription>
            <FieldGroup>
              <FactPair>
                <Field data-invalid={Boolean(form.formState.errors.moq)}>
                  <FieldLabel htmlFor={fieldId("product-moq")}>最小起订量（MOQ）</FieldLabel>
                  <Input
                    id={fieldId("product-moq")}
                    inputMode="numeric"
                    aria-invalid={Boolean(form.formState.errors.moq)}
                    {...form.register("moq")}
                  />
                  <FieldError errors={[form.formState.errors.moq]} />
                </Field>
                <EvidenceInput
                  form={form}
                  name="moqEvidenceRef"
                  label="最小起订量来源"
                  id={fieldId("moq-evidence")}
                />
              </FactPair>
              <FactPair>
                <Field data-invalid={Boolean(form.formState.errors.estimatedLeadTimeDays)}>
                  <FieldLabel htmlFor={fieldId("lead-time-days")}>预计交期（天）</FieldLabel>
                  <Input
                    id={fieldId("lead-time-days")}
                    inputMode="numeric"
                    aria-invalid={Boolean(form.formState.errors.estimatedLeadTimeDays)}
                    {...form.register("estimatedLeadTimeDays")}
                  />
                  <FieldError errors={[form.formState.errors.estimatedLeadTimeDays]} />
                </Field>
                <EvidenceInput
                  form={form}
                  name="estimatedLeadTimeDaysEvidenceRef"
                  label="预计交期来源"
                  id={fieldId("lead-time-evidence")}
                />
              </FactPair>
              <FactPair>
                <Field data-invalid={Boolean(form.formState.errors.packaging)}>
                  <FieldLabel htmlFor={fieldId("packaging")}>包装方式</FieldLabel>
                  <Input
                    id={fieldId("packaging")}
                    aria-invalid={Boolean(form.formState.errors.packaging)}
                    {...form.register("packaging")}
                  />
                  <FieldError errors={[form.formState.errors.packaging]} />
                </Field>
                <EvidenceInput
                  form={form}
                  name="packagingEvidenceRef"
                  label="包装方式来源"
                  id={fieldId("packaging-evidence")}
                />
              </FactPair>
              <FactPair>
                <Field data-invalid={Boolean(form.formState.errors.supportedCustomization)}>
                  <FieldLabel htmlFor={fieldId("supported-customization")}>支持定制</FieldLabel>
                  <Input
                    id={fieldId("supported-customization")}
                    placeholder="Logo, color box"
                    aria-invalid={Boolean(form.formState.errors.supportedCustomization)}
                    {...form.register("supportedCustomization")}
                  />
                  <FieldError errors={[form.formState.errors.supportedCustomization]} />
                </Field>
                <EvidenceInput
                  form={form}
                  name="supportedCustomizationEvidenceRef"
                  label="支持定制来源"
                  id={fieldId("supported-customization-evidence")}
                />
              </FactPair>
              <FactPair>
                <Field data-invalid={Boolean(form.formState.errors.sampleAvailable)}>
                  <FieldLabel>样品可用性</FieldLabel>
                  <Controller
                    control={form.control}
                    name="sampleAvailable"
                    render={({ field }) => (
                      <ToggleGroup
                        value={field.value ? [field.value] : []}
                        onValueChange={(value) => field.onChange(value[0] ?? "")}
                        variant="outline"
                      >
                        <ToggleGroupItem value="yes">可提供样品</ToggleGroupItem>
                        <ToggleGroupItem value="no">暂不提供样品</ToggleGroupItem>
                      </ToggleGroup>
                    )}
                  />
                  <FieldDescription>未取得明确资料时保持未选择。</FieldDescription>
                  <FieldError errors={[form.formState.errors.sampleAvailable]} />
                </Field>
                <EvidenceInput
                  form={form}
                  name="sampleAvailableEvidenceRef"
                  label="样品可用性来源"
                  id={fieldId("sample-available-evidence")}
                />
              </FactPair>
            </FieldGroup>
          </FieldSet>

          <FieldSet>
            <FieldLegend>来源</FieldLegend>
            <FieldDescription>
              选择本产品的主要来源资料；各项参数仍需分别选择对应来源。
            </FieldDescription>
            <EvidenceInput
              form={form}
              name="sourceRef"
              label="主要来源资料"
              id={fieldId("source-ref")}
            />
          </FieldSet>
        </FieldGroup>
      </div>
    </EvidenceOptionsContext.Provider>
  );
}
