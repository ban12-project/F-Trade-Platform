"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { BotIcon, FilePenLineIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import {
  startTransition,
  useActionState,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useTransition,
} from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
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
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import { Textarea } from "@/components/ui/textarea";
import { initialContentActionState, initialContentAgentActionState } from "@/lib/action-states";
import { createContentDraftAction, reviseContentDraftAction } from "@/lib/actions/content";
import {
  type ContentAgentActionState,
  generateContentDraftAction,
} from "@/lib/actions/content-agent";
import type { ContentCatalogDetail, ReadyProductContentSource } from "@/lib/content/store";
import { contentAgentRequestSchema, contentDraftFormSchema } from "@/lib/form-schemas";
import { workspaceRecordHref } from "@/lib/workspace/navigation";
import { useWorkspaceDirty } from "./dirty-state";
import { useCreatedRecord } from "./use-created-record";
import { WorkspaceLink as Link } from "./workspace-link";

const contentTypes = [
  ["product", "产品推广"],
  ["factory_capability", "工厂能力"],
  ["industry_knowledge", "行业知识"],
] as const;
type ContentValues = z.infer<typeof contentDraftFormSchema>;

function defaultValues(products: ReadyProductContentSource[]): ContentValues {
  return {
    productId: products[0]?.id ?? "",
    contentType: "product",
    factPath: products[0]?.factOptions[0]?.path ?? "",
    objective: "Generate qualified distributor inquiries",
    targetCustomer: "Overseas automotive parts distributors",
    hook: "",
    body: "",
    callToAction: "",
    hashtags: "",
    visualInstruction: "",
  };
}

function valuesFromDetail(detail: ContentCatalogDetail): ContentValues {
  return {
    productId: detail.content.product_id,
    contentType: detail.content.content_type,
    factPath:
      detail.content.product_facts.find((fact) => fact.field !== "product.product_name")?.field ??
      detail.content.product_facts[0]?.field ??
      "product.product_name",
    objective: detail.content.objective,
    targetCustomer: detail.content.target_customer,
    hook: detail.content.hook,
    body: detail.content.body,
    callToAction: detail.content.call_to_action,
    hashtags: detail.content.hashtags.join(" "),
    visualInstruction: detail.content.visual_instruction,
  };
}

export function ContentDraftForm({
  projectId,
  products,
  detail,
}: {
  projectId: string;
  products: ReadyProductContentSource[];
  detail?: ContentCatalogDetail;
}) {
  const revising = detail?.state === "CONTENT_REVISION_REQUIRED";
  const [saveState, saveAction, saving] = useActionState(
    revising ? reviseContentDraftAction : createContentDraftAction,
    initialContentActionState,
  );
  const [aiState, setAiState] = useState<ContentAgentActionState>(initialContentAgentActionState);
  const [generating, startGenerating] = useTransition();
  const generationRequest = useRef(0);
  const generationContext = `${projectId}:${detail?.id ?? "new"}`;
  const generationContextRef = useRef(generationContext);
  useEffect(() => {
    generationContextRef.current = generationContext;
    generationRequest.current += 1;
    setAiState(initialContentAgentActionState);
    return () => {
      generationRequest.current += 1;
    };
  }, [generationContext]);
  const form = useForm<ContentValues>({
    resolver: zodResolver(contentDraftFormSchema),
    defaultValues: detail ? valuesFromDetail(detail) : defaultValues(products),
  });
  useWorkspaceDirty(`content-draft-${detail?.id ?? "new"}`, form.formState.isDirty);
  const productId = form.watch("productId");
  const product = products.find((item) => item.id === productId);
  const resetSavedDraft = useEffectEvent(() => {
    form.reset(revising ? form.getValues() : defaultValues(products));
  });
  useEffect(() => {
    // The Action revalidates the route. A new products array must not trigger
    // another refresh or reset a draft the user has started editing afterwards.
    if (saveState.status === "success") resetSavedDraft();
  }, [saveState]);
  useCreatedRecord(projectId, "content", saveState.status, saveState.contentId, !revising);
  function data(values: ContentValues) {
    const result = new FormData();
    result.set("projectId", projectId);
    if (detail) result.set("contentId", detail.id);
    for (const [key, value] of Object.entries(values)) result.set(key, value);
    return result;
  }
  function generate() {
    if (generating || saving) return;
    const values = form.getValues();
    const subset = contentAgentRequestSchema.safeParse({ ...values, projectId });
    if (!subset.success) {
      void form.trigger(["productId", "contentType", "factPath", "objective", "targetCustomer"]);
      setAiState({
        status: "error",
        message: subset.error.issues[0]?.message ?? "内容请求格式不正确。",
      });
      return;
    }
    const requestId = ++generationRequest.current;
    const requestContext = generationContext;
    setAiState(initialContentAgentActionState);
    startGenerating(async () => {
      try {
        const result = await generateContentDraftAction(
          initialContentAgentActionState,
          data(values),
        );
        if (
          requestId !== generationRequest.current ||
          requestContext !== generationContextRef.current
        )
          return;
        if (result.draft) {
          const current = form.getValues();
          if (
            Object.entries(values).some(
              ([key, value]) => current[key as keyof ContentValues] !== value,
            )
          ) {
            setAiState({
              status: "error",
              message: "生成期间产品选择或内容已更改，未覆盖当前填写。请按当前内容重新生成。",
            });
            return;
          }
          // Apply one matching draft; never mix a stale result with edits made while waiting.
          form.setValue("hook", result.draft.hook, { shouldDirty: true });
          form.setValue("body", result.draft.body, { shouldDirty: true });
          form.setValue("callToAction", result.draft.callToAction, { shouldDirty: true });
          form.setValue("hashtags", result.draft.hashtags.join(" "), { shouldDirty: true });
          form.setValue("visualInstruction", result.draft.visualInstruction, { shouldDirty: true });
        }
        setAiState(result);
      } catch {
        if (requestId === generationRequest.current)
          setAiState({ status: "error", message: "无法生成内容初稿，请稍后重试或手动填写。" });
      }
    });
  }
  if (!products.length)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FilePenLineIcon />
          </EmptyMedia>
          <EmptyTitle>当前项目没有已核验产品</EmptyTitle>
          <EmptyDescription>先核实产品资料，再使用有来源的事实制作内容。</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<Link href={`/workspace/products?project=${projectId}`} />}>
            查看产品资料
          </Button>
        </EmptyContent>
      </Empty>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{revising ? "修订内容草稿" : "新建待审内容"}</CardTitle>
        <CardDescription>AI 只能使用所选的已核验事实；人工仍需检查文案和视觉说明。</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id={revising ? "revise-content" : "create-content"}
          onSubmit={form.handleSubmit((values) => {
            if (!generating && !saving) startTransition(() => saveAction(data(values)));
          })}
        >
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.productId}>
              <FieldLabel htmlFor="content-source-product">产品</FieldLabel>
              <Controller
                control={form.control}
                name="productId"
                render={({ field }) => (
                  <Select
                    items={Object.fromEntries(
                      products.map((item) => [
                        item.id,
                        `${item.internalSku} · ${item.productName}`,
                      ]),
                    )}
                    value={field.value}
                    onValueChange={(value) => {
                      field.onChange(value);
                      form.setValue(
                        "factPath",
                        products.find((item) => item.id === value)?.factOptions[0]?.path ?? "",
                      );
                    }}
                    disabled={revising}
                  >
                    <SelectTrigger id="content-source-product" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {products.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.internalSku} · {item.productName}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError errors={[form.formState.errors.productId]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="content-kind">内容类型</FieldLabel>
              <Controller
                control={form.control}
                name="contentType"
                render={({ field }) => (
                  <Select
                    items={Object.fromEntries(contentTypes)}
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger id="content-kind" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {contentTypes.map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field data-invalid={!!form.formState.errors.factPath}>
              <FieldLabel htmlFor="content-source-fact">允许引用的产品事实</FieldLabel>
              <Controller
                control={form.control}
                name="factPath"
                render={({ field }) => (
                  <Select
                    items={Object.fromEntries(
                      (product?.factOptions ?? []).map((fact) => [fact.path, fact.label]),
                    )}
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger id="content-source-fact" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {product?.factOptions.map((fact) => (
                          <SelectItem key={fact.path} value={fact.path}>
                            {fact.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError errors={[form.formState.errors.factPath]} />
            </Field>
            <Field data-invalid={!!form.formState.errors.objective}>
              <FieldLabel htmlFor="content-objective">营销目标</FieldLabel>
              <Input id="content-objective" {...form.register("objective")} />
              <FieldError errors={[form.formState.errors.objective]} />
            </Field>
            <Field data-invalid={!!form.formState.errors.targetCustomer}>
              <FieldLabel htmlFor="target-customer">目标客户</FieldLabel>
              <Input id="target-customer" {...form.register("targetCustomer")} />
              <FieldError errors={[form.formState.errors.targetCustomer]} />
            </Field>
            <Button
              type="button"
              variant="outline"
              disabled={generating || saving}
              onClick={generate}
            >
              {generating ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <BotIcon data-icon="inline-start" />
              )}
              生成可编辑初稿
            </Button>
            <Field data-invalid={!!form.formState.errors.hook}>
              <FieldLabel htmlFor="content-hook">开场句</FieldLabel>
              <Textarea id="content-hook" rows={2} {...form.register("hook")} />
              <FieldError errors={[form.formState.errors.hook]} />
            </Field>
            <Field data-invalid={!!form.formState.errors.body}>
              <FieldLabel htmlFor="content-body">正文</FieldLabel>
              <Textarea id="content-body" rows={8} {...form.register("body")} />
              <FieldError errors={[form.formState.errors.body]} />
            </Field>
            <Field data-invalid={!!form.formState.errors.callToAction}>
              <FieldLabel htmlFor="content-cta">行动号召</FieldLabel>
              <Input id="content-cta" {...form.register("callToAction")} />
              <FieldError errors={[form.formState.errors.callToAction]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="content-hashtags">标签</FieldLabel>
              <Input id="content-hashtags" {...form.register("hashtags")} />
            </Field>
            <Field data-invalid={!!form.formState.errors.visualInstruction}>
              <FieldLabel htmlFor="visual-instruction">视觉说明</FieldLabel>
              <Textarea id="visual-instruction" rows={4} {...form.register("visualInstruction")} />
              <FieldDescription>不能推断尺寸、材料、结构或零件数量。</FieldDescription>
              <FieldError errors={[form.formState.errors.visualInstruction]} />
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3">
        <Button
          form={revising ? "revise-content" : "create-content"}
          type="submit"
          disabled={saving || generating}
        >
          {saving ? (
            <Spinner data-icon="inline-start" />
          ) : revising ? (
            <RotateCcwIcon data-icon="inline-start" />
          ) : (
            <PlusIcon data-icon="inline-start" />
          )}
          {revising ? "提交修订并送审" : "创建待审内容"}
        </Button>
        {saveState.status === "success" && saveState.contentId && !revising ? (
          <Button
            render={<Link href={workspaceRecordHref(projectId, "content", saveState.contentId)} />}
            variant="outline"
          >
            打开内容草稿
          </Button>
        ) : null}
        {aiState.message ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {aiState.message}
          </p>
        ) : null}
        {saveState.message ? (
          <p
            className={
              saveState.status === "error"
                ? "text-sm text-destructive"
                : "text-sm text-muted-foreground"
            }
            aria-live="polite"
          >
            {saveState.message}
          </p>
        ) : null}
      </CardFooter>
    </Card>
  );
}
