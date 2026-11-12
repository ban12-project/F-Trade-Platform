"use client";
import { FileSearchIcon, LinkIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { linkReadyProductToSalesProjectAction } from "@/lib/actions/workspace";
import type { ReadyProductContentSource } from "@/lib/content/store";
import type { WorkspaceProductReference } from "@/lib/workspace/types";
import { WorkspaceLink } from "./workspace-link";

export function ProductReferencePanel({
  projectId,
  available,
  linked,
}: {
  projectId: string;
  available: ReadyProductContentSource[];
  linked: WorkspaceProductReference[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(
    available.find((item) => !linked.some((reference) => reference.id === item.id))?.id ?? "",
  );
  const [message, setMessage] = useState("");
  const [pending, startLink] = useTransition();
  const candidates = available.filter(
    (item) => !linked.some((reference) => reference.id === item.id),
  );
  const effectiveSelectedId = candidates.some((item) => item.id === selectedId)
    ? selectedId
    : (candidates[0]?.id ?? "");
  function link() {
    if (!effectiveSelectedId) return;
    startLink(async () => {
      const result = await linkReadyProductToSalesProjectAction(projectId, effectiveSelectedId);
      setMessage(result.message);
      if (result.status === "success") router.refresh();
    });
  }
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">关联产品</Badge>
          <Badge variant="outline">已核实产品</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          选择已核实的产品供当前销售项目使用，产品参数由原项目统一维护。
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>添加已有产品</CardTitle>
          <CardDescription>选择已核实产品，作为当前客户报价的产品依据。</CardDescription>
        </CardHeader>
        <CardContent>
          {candidates.length ? (
            <Field>
              <FieldLabel htmlFor="sales-product-reference">已核实产品</FieldLabel>
              <Select
                items={Object.fromEntries(
                  candidates.map((item) => [item.id, `${item.internalSku} · ${item.productName}`]),
                )}
                value={effectiveSelectedId}
                onValueChange={(value) => value && setSelectedId(value)}
              >
                <SelectTrigger id="sales-product-reference" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {candidates.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.internalSku} · {item.productName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {linked.length ? "暂无其他可添加产品" : "尚无可添加的已核实产品"}
                </EmptyTitle>
                <EmptyDescription>
                  {linked.length
                    ? "已关联产品可继续用于报价。如需其他产品，请先在产品资料库完成资料核实，再回到这里关联。"
                    : "请先在产品资料库整理工厂来源并完成人工核实，再回到这里将已核实产品添加到当前项目。"}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <WorkspaceLink
                  href="/workspace/products"
                  className={buttonVariants({ variant: "outline" })}
                >
                  前往产品资料库
                </WorkspaceLink>
              </EmptyContent>
            </Empty>
          )}
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3">
          {candidates.length ? (
            <Button disabled={pending || !effectiveSelectedId} onClick={link}>
              <LinkIcon data-icon="inline-start" />
              添加到当前项目
            </Button>
          ) : null}
          {message ? (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {message}
            </p>
          ) : null}
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>已关联产品</CardTitle>
        </CardHeader>
        <CardContent>
          {linked.length ? (
            <div className="flex flex-col gap-2">
              {linked.map((item) => (
                <Card key={item.id} size="sm">
                  <CardHeader>
                    <CardTitle>{item.internalSku}</CardTitle>
                    <CardDescription>{item.productName}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileSearchIcon />
                </EmptyMedia>
                <EmptyTitle>尚未添加产品</EmptyTitle>
                <EmptyDescription>
                  RFQ 可先收集，但正式报价前必须由人工核对产品身份。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
