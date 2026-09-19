"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  BotIcon,
  CheckCircle2Icon,
  CopyIcon,
  FilePenLineIcon,
  PlusIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  XCircleIcon,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type ReactNode,
  startTransition,
  useActionState,
  useEffect,
  useEffectEvent,
  useState,
} from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { initialContentActionState, initialContentAgentActionState } from "@/lib/action-states";
import {
  copyContentDraftToProjectAction,
  createContentDraftAction,
  decideContentReviewAction,
  reviseContentDraftAction,
} from "@/lib/actions/content";
import { generateContentDraftAction } from "@/lib/actions/content-agent";
import type {
  ContentCatalogDetail,
  ContentCatalogEntry,
  ContentCopyCandidate,
  ReadyProductContentSource,
} from "@/lib/content/store";
import { contentDraftFormSchema, contentReviewFormSchema } from "@/lib/form-schemas";
import { productFactLabels } from "@/lib/product/fact-labels";
import { workspaceCreateHref, workspaceRecordHref } from "@/lib/workspace/navigation";
import { useWorkspaceDirty, useWorkspaceDirtyState } from "./dirty-state";
import { WorkspaceLink as Link } from "./workspace-link";

const contentTypes = [
  ["product", "产品推广"],
  ["factory_capability", "工厂能力"],
  ["industry_knowledge", "行业知识"],
] as const;
type ContentValues = z.infer<typeof contentDraftFormSchema>;
type ReviewValues = z.infer<typeof contentReviewFormSchema>;

function stateLabel(state: string) {
  return (
    (
      {
        CONTENT_REVIEW_REQUIRED: "待人工审核",
        CONTENT_REVISION_REQUIRED: "待修订",
        CONTENT_APPROVED: "已批准",
        CONTENT_PUBLISHED: "已发布",
      } as Record<string, string>
    )[state] ?? state
  );
}
function contentTypeLabel(value: string) {
  return contentTypes.find(([key]) => key === value)?.[1] ?? value;
}

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

function ContentDraftForm({
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
  const [aiState, aiAction, generating] = useActionState(
    generateContentDraftAction,
    initialContentAgentActionState,
  );
  const form = useForm<ContentValues>({
    resolver: zodResolver(contentDraftFormSchema),
    defaultValues: detail ? valuesFromDetail(detail) : defaultValues(products),
  });
  useWorkspaceDirty(`content-draft-${detail?.id ?? "new"}`, form.formState.isDirty);
  const productId = form.watch("productId");
  const product = products.find((item) => item.id === productId);
  useEffect(() => {
    if (!aiState.draft) return;
    form.setValue("hook", aiState.draft.hook, { shouldDirty: true });
    form.setValue("body", aiState.draft.body, { shouldDirty: true });
    form.setValue("callToAction", aiState.draft.callToAction, { shouldDirty: true });
    form.setValue("hashtags", aiState.draft.hashtags.join(" "), { shouldDirty: true });
    form.setValue("visualInstruction", aiState.draft.visualInstruction, { shouldDirty: true });
  }, [aiState.draft, form]);
  const resetSavedDraft = useEffectEvent(() => {
    form.reset(revising ? form.getValues() : defaultValues(products));
  });
  useEffect(() => {
    // The Action revalidates the route. A new products array must not trigger
    // another refresh or reset a draft the user has started editing afterwards.
    if (saveState.status === "success") resetSavedDraft();
  }, [saveState]);
  function data(values: ContentValues) {
    const result = new FormData();
    result.set("projectId", projectId);
    if (detail) result.set("contentId", detail.id);
    for (const [key, value] of Object.entries(values)) result.set(key, value);
    return result;
  }
  function generate() {
    const values = form.getValues();
    const subset = contentDraftFormSchema
      .pick({
        productId: true,
        contentType: true,
        factPath: true,
        objective: true,
        targetCustomer: true,
      })
      .safeParse(values);
    if (!subset.success) {
      void form.trigger(["productId", "contentType", "factPath", "objective", "targetCustomer"]);
      return;
    }
    startTransition(() => aiAction(data(values)));
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
          onSubmit={form.handleSubmit((values) => startTransition(() => saveAction(data(values))))}
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
                        item.internalSku + " · " + item.productName,
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
            <Button type="button" variant="outline" disabled={generating} onClick={generate}>
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
          disabled={saving}
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

function ContentReview({
  projectId,
  detail,
  product,
  canReview,
}: {
  projectId: string;
  detail: ContentCatalogDetail;
  product: ReadyProductContentSource | undefined;
  canReview: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    decideContentReviewAction,
    initialContentActionState,
  );
  const form = useForm<ReviewValues>({
    resolver: zodResolver(contentReviewFormSchema),
    defaultValues: {
      contentId: detail.id,
      reviewedVersion: String(detail.version),
      approvalId: detail.approvalId ?? "",
      evidenceRef: "",
      notes: "",
    },
  });
  useWorkspaceDirty(`content-review-${detail.id}`, form.formState.isDirty);
  useEffect(() => {
    if (state.status === "success") {
      form.reset(form.getValues());
      router.refresh();
    }
  }, [form, router, state.status]);
  function submit(values: ReviewValues) {
    const data = new FormData();
    data.set("projectId", projectId);
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    startTransition(() => action(data));
  }
  const canDecide =
    canReview && detail.state === "CONTENT_REVIEW_REQUIRED" && detail.approvalStatus === "pending";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{stateLabel(detail.state)}</Badge>
        <Badge variant="outline">{contentTypeLabel(detail.contentType)}</Badge>
        <Badge variant="outline">第 {detail.version} 版</Badge>
      </div>
      {detail.state.endsWith("REVISION_REQUIRED") ? (
        <Alert>
          <AlertTitle>根据审核意见修订</AlertTitle>
          <AlertDescription>
            {detail.reviewNotes || "这条记录已退回，请核对来源后修改并重新送审。"}
          </AlertDescription>
        </Alert>
      ) : null}
      {detail.state === "CONTENT_REVISION_REQUIRED" && product ? (
        <ContentDraftForm projectId={projectId} products={[product]} detail={detail} />
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{detail.content.hook}</CardTitle>
          <CardDescription>{detail.productName}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="whitespace-pre-wrap text-sm leading-6">{detail.content.body}</p>
          <p className="text-sm">
            <span className="font-medium">CTA：</span>
            {detail.content.call_to_action}
          </p>
          <p className="text-sm">
            <span className="font-medium">视觉：</span>
            {detail.content.visual_instruction}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>事实</TableHead>
                <TableHead>值 / 证据</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.content.product_facts.map((fact) => (
                <TableRow key={fact.field}>
                  <TableCell className="whitespace-normal">
                    {productFactLabels[fact.field] ?? fact.field}
                  </TableCell>
                  <TableCell className="whitespace-normal break-words">
                    {fact.value}
                    <span className="mt-1 block font-mono text-xs text-muted-foreground">
                      {fact.evidence_ref}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {canDecide ? (
        <Card>
          <CardHeader>
            <CardTitle>内容审核决定</CardTitle>
            <CardDescription>
              审核版本 {detail.version}。批准不等于发布；请先明确选择。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form id="content-review" onSubmit={form.handleSubmit(submit)}>
              <FieldGroup>
                <Field data-invalid={!!form.formState.errors.decision}>
                  <FieldLabel htmlFor="content-review-decision">决定</FieldLabel>
                  <Controller
                    control={form.control}
                    name="decision"
                    render={({ field }) => (
                      <Select
                        items={{ approved: "批准营销内容", rejected: "退回营销内容" }}
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger
                          id="content-review-decision"
                          className="w-full"
                          aria-invalid={!!form.formState.errors.decision}
                        >
                          <SelectValue placeholder="请选择审核决定" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="approved">批准营销内容</SelectItem>
                            <SelectItem value="rejected">退回营销内容</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldError errors={[form.formState.errors.decision]} />
                </Field>
                <Field data-invalid={!!form.formState.errors.evidenceRef}>
                  <FieldLabel htmlFor="content-review-evidence">审核证据</FieldLabel>
                  <Input
                    id="content-review-evidence"
                    placeholder="evidence-content-review-001"
                    {...form.register("evidenceRef")}
                  />
                  <FieldError errors={[form.formState.errors.evidenceRef]} />
                </Field>
                <Field data-invalid={!!form.formState.errors.notes}>
                  <FieldLabel htmlFor="content-review-notes">
                    审核备注{form.watch("decision") === "rejected" ? "（必填）" : ""}
                  </FieldLabel>
                  <Textarea
                    id="content-review-notes"
                    aria-invalid={!!form.formState.errors.notes}
                    {...form.register("notes")}
                  />
                  <FieldError errors={[form.formState.errors.notes]} />
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-3">
            <Button
              form="content-review"
              type="submit"
              variant={form.watch("decision") === "rejected" ? "destructive" : "default"}
              disabled={pending || !form.watch("decision")}
            >
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : form.watch("decision") === "approved" ? (
                <CheckCircle2Icon data-icon="inline-start" />
              ) : (
                <XCircleIcon data-icon="inline-start" />
              )}
              {form.watch("decision") === "approved"
                ? "批准营销内容"
                : form.watch("decision") === "rejected"
                  ? "退回营销内容"
                  : "请先选择决定"}
            </Button>
            {state.message ? (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {state.message}
              </p>
            ) : null}
          </CardFooter>
        </Card>
      ) : detail.state === "CONTENT_REVIEW_REQUIRED" ? (
        <Alert>
          <ShieldCheckIcon />
          <AlertTitle>{canReview ? "审核请求需要核对" : "等待审核者检查内容"}</AlertTitle>
          <AlertDescription>
            {canReview
              ? "当前内容没有有效的待审请求，请核对记录状态。"
              : "由有内容审核权限的项目编辑者核对当前版本，批准后再确认发布。"}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function ContentCopy({
  projectId,
  candidates,
}: {
  projectId: string;
  candidates: ContentCopyCandidate[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(candidates[0]?.id ?? "");
  const [state, action, pending] = useActionState(
    copyContentDraftToProjectAction,
    initialContentActionState,
  );
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);
  function copy() {
    if (!selected) return;
    const data = new FormData();
    data.set("projectId", projectId);
    data.set("sourceContentId", selected);
    startTransition(() => action(data));
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>从其他项目复制</CardTitle>
        <CardDescription>创建独立待审草稿；后续修订和审核不会影响源项目。</CardDescription>
      </CardHeader>
      <CardContent>
        {candidates.length ? (
          <Field>
            <FieldLabel>源内容</FieldLabel>
            <Select
              items={Object.fromEntries(
                candidates.map((item) => [
                  item.id,
                  item.projectTitle + " · " + item.productName + " · " + item.hook,
                ]),
              )}
              value={selected}
              onValueChange={(value) => value && setSelected(value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {candidates.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.projectTitle} · {item.productName} · {item.hook}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        ) : (
          <p className="text-sm text-muted-foreground">其他项目暂无可复制内容。</p>
        )}
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3">
        <Button disabled={pending || !selected} onClick={copy}>
          <CopyIcon data-icon="inline-start" />
          复制为新草稿
        </Button>
        {state.status === "success" && state.contentId ? (
          <Button
            render={<Link href={workspaceRecordHref(projectId, "content", state.contentId)} />}
            variant="outline"
          >
            打开复制的内容草稿
          </Button>
        ) : null}
        {state.message ? (
          <p
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

export function ContentPanel({
  projectId,
  products,
  entries,
  copyCandidates,
  detail,
  canReview,
  mode = "create",
  children,
}: {
  projectId: string;
  products: ReadyProductContentSource[];
  entries: ContentCatalogEntry[];
  copyCandidates: ContentCopyCandidate[];
  detail: ContentCatalogDetail | null;
  canReview: boolean;
  mode?: "create" | "collection";
  children?: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { requestNavigation } = useWorkspaceDirtyState();
  const tab = searchParams.get("method") === "copy" ? "copy" : "create";
  function setTab(value: string) {
    const query = new URLSearchParams(searchParams.toString());
    query.set("method", value);
    requestNavigation(() => window.history.pushState(null, "", `${pathname}?${query}`));
  }
  function href(item: string) {
    if (pathname.startsWith("/workspace/")) return workspaceRecordHref(projectId, "content", item);
    const params = new URLSearchParams(searchParams.toString());
    params.set("panel", "content");
    params.set("item", item);
    return `${pathname}?${params}`;
  }
  if (detail)
    return (
      <div className="flex flex-col gap-6">
        <ContentReview
          key={`${detail.id}:${detail.version}:${detail.approvalId}`}
          projectId={projectId}
          detail={detail}
          product={products.find((item) => item.id === detail.productId)}
          canReview={canReview}
        />
        {children}
      </div>
    );
  if (mode === "collection" && entries.length)
    return (
      <Card>
        <CardHeader>
          <CardTitle>内容与发布</CardTitle>
          <CardDescription>选择一条内容查看草稿、审核和发布结果。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {entries.map((entry) => (
            <Button
              key={entry.id}
              render={<Link href={href(entry.id)} />}
              variant="outline"
              className="h-auto justify-start py-3 text-left"
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="break-words">{entry.hook}</span>
                <span className="text-xs text-muted-foreground">
                  {entry.productName} · {stateLabel(entry.state)}
                </span>
              </span>
            </Button>
          ))}
        </CardContent>
        <CardFooter>
          <Button render={<Link href={workspaceCreateHref(projectId, "content")} />}>
            制作图文内容
          </Button>
        </CardFooter>
      </Card>
    );
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">制作图文内容</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          选择已核实的产品事实，完成文案后提交人工审核。
        </p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full" aria-label="内容制作方式">
          <TabsTrigger value="create">从产品制作</TabsTrigger>
          <TabsTrigger value="copy">复制已有内容</TabsTrigger>
        </TabsList>
        <TabsContent value="create">
          <ContentDraftForm projectId={projectId} products={products} />
        </TabsContent>
        <TabsContent value="copy">
          <ContentCopy projectId={projectId} candidates={copyCandidates} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
