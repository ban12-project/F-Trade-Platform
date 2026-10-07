"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2Icon, ShieldCheckIcon, XCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect } from "react";
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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import { Textarea } from "@/components/ui/textarea";
import { initialContentActionState } from "@/lib/action-states";
import { decideContentReviewAction } from "@/lib/actions/content";
import type { ContentCatalogDetail, ReadyProductContentSource } from "@/lib/content/store";
import { contentReviewFormSchema } from "@/lib/form-schemas";
import { productFactLabels } from "@/lib/product/fact-labels";
import { recordStateLabels } from "@/lib/workspace/library-model";
import { useWorkspaceDirty } from "./dirty-state";

const contentTypes = [
  ["product", "产品推广"],
  ["factory_capability", "工厂能力"],
  ["industry_knowledge", "行业知识"],
] as const;

import { ContentDraftForm } from "./content-draft-form";

type ReviewValues = z.infer<typeof contentReviewFormSchema>;

function stateLabel(state: string) {
  return recordStateLabels[state] ?? "状态待核对";
}

function contentTypeLabel(value: string) {
  return contentTypes.find(([key]) => key === value)?.[1] ?? value;
}

export function ContentReview({
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
                        value={field.value ?? null}
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
