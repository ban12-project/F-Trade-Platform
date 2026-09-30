"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, RotateCcwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { initialProductActionState } from "@/lib/action-states";
import {
  createProductCatalogDraftAction,
  reviseProductCatalogDraftAction,
} from "@/lib/actions/products";
import { productCatalogFormSchema } from "@/lib/product/catalog-form-schema";
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
  const revising = detail?.state === "PRODUCT_REVISION_REQUIRED";
  const [state, action, pending] = useActionState(
    revising ? reviseProductCatalogDraftAction : createProductCatalogDraftAction,
    initialProductActionState,
  );
  const form = useForm<ProductValues>({
    resolver: zodResolver(productCatalogFormSchema),
    defaultValues: detail ? productDraftValues(detail) : emptyProduct,
  });
  useWorkspaceDirty(`product-draft-${detail?.id ?? "new"}`, form.formState.isDirty);
  useEffect(() => {
    if (state.status === "success") {
      form.reset(revising ? form.getValues() : emptyProduct);
      router.refresh();
    }
  }, [form, revising, router, state.status]);
  useCreatedRecord(projectId, "product", state.status, state.productId, !revising);
  function submit(values: ProductValues) {
    const data = new FormData();
    data.set("projectId", projectId);
    if (detail) data.set("productId", detail.id);
    for (const [key, value] of Object.entries(values))
      if (value !== undefined) data.set(key, value);
    startTransition(() => action(data));
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
        id={revising ? "revise-product" : "create-product"}
        onSubmit={form.handleSubmit(submit)}
        noValidate
      >
        <CardContent>
          <ProductFields form={form} evidenceOptions={evidenceOptions} />
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
