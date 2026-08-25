"use client";

import { useActionState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftIcon, CheckCircle2Icon, ShieldCheckIcon, XCircleIcon } from "lucide-react";
import Link from "next/link";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { decideProductCatalogReviewAction, initialProductActionState } from "@/lib/actions/products";
import { productReviewFormSchema } from "@/lib/form-schemas";
import type { ProductCatalogDetail } from "@/lib/products";

type ReviewValues = z.infer<typeof productReviewFormSchema>;

function valueOf(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" || typeof value === "number" ? String(value) : "未提供";
}

export function ProductReviewPanel({ product }: { product: ProductCatalogDetail }) {
  const [state, formAction, pending] = useActionState(decideProductCatalogReviewAction, initialProductActionState);
  const [, startTransition] = useTransition();
  const form = useForm<ReviewValues>({
    resolver: zodResolver(productReviewFormSchema),
    defaultValues: {
      productId: product.id,
      decision: "approved",
      evidenceRef: "",
      notes: "",
    },
  });
  const canDecide = product.state === "PRODUCT_REVIEW_REQUIRED" && product.approvalStatus === "pending";

  function onSubmit(values: ReviewValues) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(values)) formData.set(key, value);
    startTransition(() => formAction(formData));
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-3">
        <Button className="w-fit" size="sm" variant="ghost" render={<Link href="/console/products" />}>
          <ArrowLeftIcon data-icon="inline-start" />返回目录
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Gate 01</Badge>
          <Badge variant="outline">{product.state}</Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">审核产品草稿</h1>
        <p className="text-muted-foreground">批准只在每项产品事实都能由来源证据核对时可用；否则应退回修订。</p>
      </header>

      <Alert>
        <ShieldCheckIcon />
        <AlertTitle>人工决定是事实边界</AlertTitle>
        <AlertDescription>不要把目录视觉、AI 推断或缺失字段当作工程证据。审核证据必须是受控存储中的私有引用。</AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>{product.productName}</CardTitle>
          <CardDescription>{product.internalSku} · {product.productType}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>字段</TableHead><TableHead>当前值</TableHead><TableHead>初始证据</TableHead></TableRow></TableHeader>
            <TableBody>
              {(["product", "specifications", "commercial"] as const).flatMap((section) => Object.entries(product.draft[section] ?? {}).map(([field, value]) => {
                const path = `${section}.${field}`;
                return <TableRow key={path}><TableCell>{path}</TableCell><TableCell>{valueOf(value)}</TableCell><TableCell>{product.draft.field_evidence[path] ?? "缺失"}</TableCell></TableRow>;
              }))}
            </TableBody>
          </Table>
        </CardContent>
        <CardFooter>阻塞项：{product.blockingFields.length === 0 ? "无自动阻塞项；仍需人工核对每一事实。" : product.blockingFields.join("、")}</CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Gate 01 决定</CardTitle>
          <CardDescription>该动作会写入独立审批记录、不可变工作流事件与审计事件。</CardDescription>
        </CardHeader>
        <CardContent>
          {!canDecide ? (
            <Alert><AlertTitle>当前无待处理审核</AlertTitle><AlertDescription>此记录已经审核，或状态已不允许再次决定。</AlertDescription></Alert>
          ) : (
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <FieldGroup>
                <Field data-invalid={!!form.formState.errors.decision}>
                  <FieldLabel>决定</FieldLabel>
                  <Controller control={form.control} name="decision" render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full" aria-invalid={!!form.formState.errors.decision}><SelectValue /></SelectTrigger>
                      <SelectContent><SelectGroup><SelectItem value="approved">批准：进入 Product Ready</SelectItem><SelectItem value="rejected">退回：要求修订</SelectItem></SelectGroup></SelectContent>
                    </Select>
                  )} />
                  <FieldError errors={[form.formState.errors.decision]} />
                </Field>
                <Field data-invalid={!!form.formState.errors.evidenceRef}>
                  <FieldLabel htmlFor="review-evidence-ref">审核证据引用</FieldLabel>
                  <Input id="review-evidence-ref" aria-invalid={!!form.formState.errors.evidenceRef} {...form.register("evidenceRef")} />
                  <FieldDescription>必须是独立的私有审核证据，例如 evidence-review-001。</FieldDescription>
                  <FieldError errors={[form.formState.errors.evidenceRef]} />
                </Field>
                <Field data-invalid={!!form.formState.errors.notes}>
                  <FieldLabel htmlFor="review-notes">审核备注</FieldLabel>
                  <Textarea id="review-notes" aria-invalid={!!form.formState.errors.notes} {...form.register("notes")} />
                  <FieldError errors={[form.formState.errors.notes]} />
                </Field>
                <div className="flex justify-end">
                  <Button type="submit" disabled={pending} variant="outline">
                    {form.watch("decision") === "approved" ? <CheckCircle2Icon data-icon="inline-start" /> : <XCircleIcon data-icon="inline-start" />}
                    提交人工决定
                  </Button>
                </div>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>

      {state.status !== "idle" && <Alert variant={state.status === "error" ? "destructive" : "default"}><AlertTitle>{state.status === "success" ? "已记录" : "未能记录"}</AlertTitle><AlertDescription>{state.message}</AlertDescription></Alert>}
    </main>
  );
}
