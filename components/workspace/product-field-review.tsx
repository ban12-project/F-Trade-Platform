"use client";

import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProductEvidencePreview } from "@/lib/product/evidence-preview";
import { productFactLabels } from "@/lib/product/fact-labels";
import { type ProductReviewFact, productFieldSources } from "@/lib/product/field-review";
import { ProductEvidenceSources } from "./product-evidence-preview";

export function ProductFieldReview({
  productName,
  facts,
  sources,
}: {
  productName: string;
  facts: ProductReviewFact[];
  sources: ProductEvidencePreview[];
}) {
  const id = useId();
  const [selectedPath, setSelectedPath] = useState(facts[0]?.path ?? "");
  const index = Math.max(
    0,
    facts.findIndex((fact) => fact.path === selectedPath),
  );
  const fact = facts[index];
  const verifiedCount = facts.filter((item) => Boolean(item.evidence)).length;
  const missingCount = facts.length - verifiedCount;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{productName}</CardTitle>
        <CardDescription>
          逐项核对产品信息与来源资料；点击总览中的任意字段即可查看当前值和对应来源。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        {fact ? (
          <>
            <section aria-label="产品字段总览" className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  共 {facts.length} 项字段 · 已关联来源 {verifiedCount} 项
                </p>
                <Badge variant={missingCount > 0 ? "destructive" : "secondary"}>
                  {missingCount > 0 ? `缺来源 ${missingCount} 项` : "来源完整"}
                </Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {facts.map((item) => {
                  const selected = item.path === fact.path;
                  const label = productFactLabels[item.path] ?? item.path;
                  return (
                    <button
                      key={item.path}
                      type="button"
                      aria-current={selected ? "true" : undefined}
                      onClick={() => setSelectedPath(item.path)}
                      className={`flex min-w-0 flex-col gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        selected ? "border-primary bg-muted/40" : "bg-background"
                      }`}
                    >
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{label}</span>
                        <Badge variant={item.evidence ? "outline" : "destructive"}>
                          {item.evidence ? "有来源" : "缺来源"}
                        </Badge>
                      </div>
                      <span className="truncate text-xs text-muted-foreground">
                        {item.value || "未提供"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
            <Field>
              <FieldLabel htmlFor={id}>核对字段</FieldLabel>
              <Select
                items={Object.fromEntries(
                  facts.map((item) => [item.path, productFactLabels[item.path] ?? item.path]),
                )}
                value={fact.path}
                onValueChange={(value) => {
                  if (value) setSelectedPath(value);
                }}
              >
                <SelectTrigger id={id} className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {facts.map((item) => (
                    <SelectItem key={item.path} value={item.path}>
                      {productFactLabels[item.path] ?? item.path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={index === 0}
                onClick={() => setSelectedPath(facts[index - 1].path)}
              >
                上一字段
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={index === facts.length - 1}
                onClick={() => setSelectedPath(facts[index + 1].path)}
              >
                下一字段
              </Button>
              <p role="status" className="text-sm text-muted-foreground">
                第 {index + 1} / {facts.length} 项：{productFactLabels[fact.path] ?? fact.path}
              </p>
            </div>
            <section aria-label="当前字段核对" className="flex min-w-0 flex-col gap-4">
              <dl className="grid min-w-0 gap-2 rounded-lg border p-4 text-sm">
                <dt className="font-medium">
                  {productFactLabels[fact.path] ?? fact.path} · 当前值
                </dt>
                <dd className="whitespace-pre-wrap break-words">{fact.value || "未提供"}</dd>
                <dt className="text-muted-foreground">保存的来源引用</dt>
                <dd className="break-all">{fact.evidence || "缺失：请补充该字段的来源资料。"}</dd>
              </dl>
              {fact.evidence ? (
                <ProductEvidenceSources sources={productFieldSources(sources, fact)} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  此字段尚未关联证据，不能以其他字段的来源代替。
                </p>
              )}
            </section>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">尚无可核对的产品字段。</p>
        )}
      </CardContent>
    </Card>
  );
}
