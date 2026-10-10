"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, RotateCcwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useId, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { initialProductActionState } from "@/lib/action-states";
import {
  createProductCatalogDraftAction,
  type ProductActionState,
  reviseProductCatalogDraftAction,
} from "@/lib/actions/products";
import { productCatalogFormSchema } from "@/lib/product/catalog-form-schema";
import { productImageFormSchema } from "@/lib/product/source-image-contracts";
import { uploadProductDocument } from "@/lib/product/upload-document-client";
import type { ProductCatalogDetail } from "@/lib/products";
import type { EvidenceOption } from "@/lib/workspace/access";
import { workspaceRecordHref } from "@/lib/workspace/navigation";
import { useWorkspaceDirty } from "./dirty-state";
import {
  emptyProduct,
  ProductFields,
  type ProductValues,
  productDraftValues,
} from "./product-fact-fields";
import { useCreatedRecord } from "./use-created-record";
import { WorkspaceLink as Link } from "./workspace-link";

export function ProductDraftForm({
  projectId,
  detail,
  evidenceOptions,
}: {
  projectId: string;
  detail?: ProductCatalogDetail;
  evidenceOptions: EvidenceOption[];
}) {
  const router = useRouter();
  const formId = useId();
  const imageId = `${formId}-manual-product-images`;
  const revising = detail?.state === "PRODUCT_REVISION_REQUIRED";
  const imageRef = useRef<HTMLInputElement>(null);
  const images = useForm<{ imageFiles: File[] }>({
    resolver: zodResolver(productImageFormSchema),
    defaultValues: { imageFiles: [] },
  });
  const [state, action, pending] = useActionState(
    async (previous: ProductActionState, input: { values: ProductValues; imageFiles: File[] }) => {
      try {
        const data = new FormData();
        data.set("projectId", projectId);
        if (detail) data.set("productId", detail.id);
        for (const [key, value] of Object.entries(input.values))
          if (value !== undefined) data.set(key, value);
        for (const image of productImageFormSchema.parse(input).imageFiles)
          data.append(
            "imageReceiptId",
            await uploadProductDocument(image, projectId, "agent_image"),
          );
        return revising
          ? await reviseProductCatalogDraftAction(previous, data)
          : await createProductCatalogDraftAction(previous, data);
      } catch {
        return {
          status: "error" as const,
          message: "无法保存资料和图片，请检查文件、登录与项目权限后重试。",
        };
      }
    },
    initialProductActionState,
  );
  const form = useForm<ProductValues>({
    resolver: zodResolver(productCatalogFormSchema),
    defaultValues: detail ? productDraftValues(detail) : emptyProduct,
  });
  useWorkspaceDirty(`${formId}-product-draft-${detail?.id ?? "new"}`, form.formState.isDirty);
  useWorkspaceDirty(`${formId}-product-images-${detail?.id ?? "new"}`, images.formState.isDirty);
  useEffect(() => {
    if (state.status === "success") {
      form.reset(revising ? form.getValues() : emptyProduct);
      images.reset({ imageFiles: [] });
      if (imageRef.current) imageRef.current.value = "";
      router.refresh();
    }
  }, [form, images, revising, router, state.status]);
  useCreatedRecord(projectId, "product", state.status, state.productId, !revising);
  async function submit(values: ProductValues) {
    if (!(await images.trigger())) return;
    startTransition(() => action({ values, imageFiles: images.getValues().imageFiles }));
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{revising ? "修订产品草稿" : "手动新建产品草稿"}</CardTitle>
        <CardDescription>
          {revising
            ? "只更正有来源依据的字段及其独立证据，提交后重新送交人工核实。"
            : "每个事实独立绑定已持久化证据；保存后只创建待审核记录。"}
        </CardDescription>
      </CardHeader>
      <form
        id={`${formId}-${revising ? "revise-product" : "create-product"}`}
        onSubmit={form.handleSubmit(submit)}
        noValidate
      >
        <CardContent>
          <ProductFields form={form} evidenceOptions={evidenceOptions} />
          <FieldGroup className="mt-4">
            <Field data-invalid={!!images.formState.errors.imageFiles} data-disabled={pending}>
              <FieldLabel htmlFor={imageId}>产品图片（可选）</FieldLabel>
              <Controller
                control={images.control}
                name="imageFiles"
                render={({ field }) => (
                  <Input
                    ref={(input) => {
                      imageRef.current = input;
                      field.ref(input);
                    }}
                    id={imageId}
                    name={field.name}
                    type="file"
                    accept=".png,.jpg,.jpeg"
                    multiple
                    disabled={pending}
                    onBlur={field.onBlur}
                    aria-invalid={!!images.formState.errors.imageFiles}
                    onChange={(event) => field.onChange(Array.from(event.target.files ?? []))}
                  />
                )}
              />
              <FieldDescription>
                {revising
                  ? `已有 ${detail.sourceImages.length} 张，新增后共最多 4 张。`
                  : "最多 4 张 PNG / JPEG，每张不超过 5 MiB。"}
                图片随草稿私有保存，须核对与当前产品一致，不能证明尺寸、OE 或材料。
              </FieldDescription>
              <FieldError errors={[images.formState.errors.imageFiles]} />
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3">
          <Button type="submit" disabled={pending || !evidenceOptions.length}>
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : revising ? (
              <RotateCcwIcon data-icon="inline-start" />
            ) : (
              <PlusIcon data-icon="inline-start" />
            )}
            {revising ? "提交修订并送审" : "创建待审核草稿"}
          </Button>
          {state.status === "success" && state.productId && !revising ? (
            <Button
              render={<Link href={workspaceRecordHref(projectId, "product", state.productId)} />}
              variant="outline"
            >
              打开产品草稿
            </Button>
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
      </form>
    </Card>
  );
}
